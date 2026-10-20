package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ReleaseStatus struct {
	Latest          string     `json:"latest"`
	CheckedAt       *time.Time `json:"checkedAt"`
	SuccessAt       *time.Time `json:"successAt"`
	Error           string     `json:"error"`
	UpdateAvailable bool       `json:"updateAvailable"`
	ETag            string     `json:"-"`
}
type Background struct {
	server    *Server
	mu        sync.Mutex
	refreshMu sync.Mutex
	release   ReleaseStatus
	storage   map[string]StorageSnapshot
	once      sync.Once
	wg        sync.WaitGroup
}

func NewBackground(s *Server) *Background {
	b := &Background{server: s, storage: map[string]StorageSnapshot{}}
	s.Store.Get("release-check", &b.release)
	for _, c := range s.Config().ArrInstances() {
		service := c.ID
		var snap StorageSnapshot
		s.Store.Get("storage:"+service, &snap)
		var persisted struct {
			Source string `json:"source"`
		}
		s.Store.Get("storage:"+service, &persisted)
		snap.Source = persisted.Source
		b.storage[service] = snap
	}
	return b
}
func (b *Background) ReleaseStatus() ReleaseStatus {
	b.mu.Lock()
	defer b.mu.Unlock()
	v := b.release
	v.UpdateAvailable = versionNewer(v.Latest, b.server.Version)
	return v
}
func (b *Background) Storage() map[string]StorageSnapshot {
	b.mu.Lock()
	defer b.mu.Unlock()
	out := map[string]StorageSnapshot{}
	for k, v := range b.storage {
		v.Disks = append([]DiskSpace{}, v.Disks...)
		out[k] = v
	}
	return out
}
func (b *Background) RefreshStorage(ctx context.Context, service string) error {
	b.refreshMu.Lock()
	defer b.refreshMu.Unlock()
	select {
	case b.server.Sync.gate <- struct{}{}:
		defer func() { <-b.server.Sync.gate }()
	case <-ctx.Done():
		return ctx.Err()
	}
	cfg := b.server.Config()
	c := cfg.GetService(service)
	if !c.Enabled {
		return errors.New("Service is not enabled")
	}
	now := time.Now().UTC()
	disks, e := fetchStorage(ctx, c)
	if ctx.Err() != nil {
		return ctx.Err()
	}
	current := b.server.Config()
	next := current.GetService(service)
	if tagEndpoint(c) != tagEndpoint(next) || !next.Enabled {
		return errors.New("Service settings changed during storage refresh")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	snap := b.storage[service]
	snap.CheckedAt = &now
	if e != nil {
		snap.Error = e.Error()
	} else {
		snap = StorageSnapshot{Disks: disks, CheckedAt: &now, SuccessAt: &now, Source: tagEndpoint(c)}
	}
	b.storage[service] = snap
	// Persist the source without exposing it in browser responses.
	if err := b.server.Store.Put("storage:"+service, map[string]any{"disks": snap.Disks, "checkedAt": snap.CheckedAt, "successAt": snap.SuccessAt, "error": snap.Error, "source": snap.Source}); err != nil {
		return err
	}
	return e
}
func versionParts(v string) ([3]int, bool) {
	out := [3]int{}
	parts := strings.Split(strings.TrimPrefix(v, "v"), ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, e := strconv.Atoi(p)
		if e != nil || n < 0 {
			return out, false
		}
		out[i] = n
	}
	return out, true
}
func versionNewer(latest, current string) bool {
	a, ok := versionParts(latest)
	b, ok2 := versionParts(current)
	if !ok || !ok2 {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return a[i] > b[i]
		}
	}
	return false
}
func (b *Background) CheckRelease(ctx context.Context) {
	old := b.ReleaseStatus()
	now := time.Now().UTC()
	status := old
	status.CheckedAt = &now
	client := &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("Release redirects are not allowed") }}
	req, _ := http.NewRequestWithContext(ctx, "GET", "https://api.github.com/repos/Buffer379x/scopearr/releases/latest", nil)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "Scopearr/"+b.server.Version)
	if old.ETag != "" {
		req.Header.Set("If-None-Match", old.ETag)
	}
	res, e := client.Do(req)
	if e != nil {
		status.Error = "Release check is unavailable"
	} else {
		defer res.Body.Close()
		if res.StatusCode == http.StatusNotModified && old.SuccessAt != nil {
			status.SuccessAt = &now
			status.Error = ""
		} else if res.StatusCode != http.StatusOK {
			status.Error = "Release check is unavailable"
		} else {
			var release struct {
				Tag        string `json:"tag_name"`
				Draft      bool   `json:"draft"`
				Prerelease bool   `json:"prerelease"`
			}
			body, err := io.ReadAll(io.LimitReader(res.Body, (512<<10)+1))
			if err != nil || len(body) > 512<<10 || json.Unmarshal(body, &release) != nil {
				status.Error = "Release check is unavailable"
			} else if _, ok := versionParts(release.Tag); !ok || release.Draft || release.Prerelease {
				status.Error = "Release check is unavailable"
			} else {
				status.Latest = strings.TrimPrefix(release.Tag, "v")
				status.SuccessAt = &now
				status.Error = ""
				status.ETag = res.Header.Get("ETag")
			}
		}
	}
	if ctx.Err() != nil {
		return
	}
	b.mu.Lock()
	b.release = status
	b.mu.Unlock()
	b.server.Store.Put("release-check", status)
}
func (s *Server) StartBackground(ctx context.Context) {
	s.Background.once.Do(func() {
		s.Background.wg.Add(1)
		go func() {
			defer s.Background.wg.Done()
			tick := time.NewTicker(time.Minute)
			defer tick.Stop()
			for {
				s.Background.step(ctx)
				select {
				case <-ctx.Done():
					return
				case <-tick.C:
				}
			}
		}()
		s.Webhooks.Start(ctx)
		s.Mux.Start(ctx)
	})
}
func (b *Background) step(ctx context.Context) {
	now := time.Now()
	r := b.ReleaseStatus()
	if r.CheckedAt == nil || now.Sub(*r.CheckedAt) >= 6*time.Hour {
		b.CheckRelease(ctx)
	}
	if b.server.Demo {
		return
	}
	cfg := b.server.Config()
	snap := b.Storage()
	for _, c := range cfg.ArrInstances() {
		service := c.ID
		v := snap[service]
		if c.Enabled && len(cfg.Widgets.Storage[service]) > 0 && (v.CheckedAt == nil || now.Sub(*v.CheckedAt) >= 15*time.Minute) {
			b.RefreshStorage(ctx, service)
		}
	}
}

func (s *Server) WaitBackground() { s.Mux.wg.Wait(); s.Webhooks.wg.Wait(); s.Background.wg.Wait() }
