package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

func (c *ArrClient) muxRequest(ctx context.Context, method, route string, body, out any) error {
	allowed := method == "GET" && positiveTagPath(route, "command/")
	if method == "DELETE" && ((c.MuxKind == "radarr" && positiveTagPath(route, "moviefile/")) || (c.MuxKind == "sonarr" && positiveTagPath(route, "episodefile/"))) {
		allowed = true
	}
	if method == "POST" && route == "command" {
		b, _ := json.Marshal(body)
		var v struct {
			Name     string `json:"name"`
			MovieID  int    `json:"movieId"`
			SeriesID int    `json:"seriesId"`
		}
		var fields map[string]json.RawMessage
		json.Unmarshal(b, &fields)
		if len(fields) == 2 && json.Unmarshal(b, &v) == nil && ((c.MuxKind == "radarr" && v.Name == "RescanMovie" && v.MovieID > 0 && v.SeriesID == 0) || (c.MuxKind == "sonarr" && v.Name == "RescanSeries" && v.SeriesID > 0 && v.MovieID == 0)) {
			allowed = true
		}
	}
	if !allowed {
		return errors.New("Mux API endpoint or command is not allowed")
	}
	return muxHTTPRequest(ctx, c, strings.TrimRight(c.Base, "/")+"/api/v3/"+route, "X-Api-Key", method, body, out)
}
func muxHTTPRequest(ctx context.Context, c *ArrClient, url, keyHeader, method string, body, out any) error {
	var reader io.Reader
	if body != nil {
		b, e := json.Marshal(body)
		if e != nil {
			return e
		}
		reader = bytes.NewReader(b)
	}
	req, e := http.NewRequestWithContext(ctx, method, url, reader)
	if e != nil {
		return errors.New("Invalid service request")
	}
	req.Header.Set(keyHeader, c.Key)
	req.Header.Set("Content-Type", "application/json")
	res, e := c.HTTP.Do(req)
	if e != nil {
		return errors.New("Service request failed")
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("Service returned HTTP %d", res.StatusCode)
	}
	if out != nil {
		return decodeServiceJSON(res.Body, out, 1<<20)
	}
	return nil
}
func (m *MuxManager) deleteOriginal(ctx context.Context, j MuxJob, f File) error {
	cfg := m.s.Config().GetService(j.Service)
	if !cfg.Enabled {
		return errors.New("Library service is disabled")
	}
	kind := serviceKind(j.Service)
	route := "moviefile/"
	if kind == "sonarr" {
		route = "episodefile/"
	} else if kind != "radarr" {
		return errors.New("Invalid library service")
	}
	route += strconv.Itoa(j.FileID)
	client := NewArr(cfg)
	if e := arrFileUnchanged(ctx, client, j.FileID, f); e != nil {
		return e
	}
	if e := client.muxRequest(ctx, "DELETE", route, nil, nil); e != nil {
		muxLogLine(ctx, "Error: Original deletion failed: "+e.Error())
		return e
	}
	muxLogLine(ctx, "Original deleted through "+muxServiceName(j.Service))
	return nil
}

type fileRefreshProgressKey struct{}
type fileRefreshTimeout struct {
	message   string
	commandID int
}

func (e *fileRefreshTimeout) Error() string { return e.message }
func arrFileUnchanged(ctx context.Context, client *ArrClient, id int, f File) error {
	route := "moviefile/"
	if client.MuxKind == "sonarr" {
		route = "episodefile/"
	}
	var current struct {
		Path string `json:"path"`
		Size int64  `json:"size"`
	}
	if e := client.get(ctx, route+strconv.Itoa(id), nil, &current); e != nil {
		return errors.New("Could not verify the file in Radarr/Sonarr")
	}
	if current.Path != f.SourcePath || current.Size != f.Size {
		return errors.New("Original path or size changed in Radarr/Sonarr")
	}
	return nil
}
func (m *MuxManager) finishSync(ctx context.Context, j *MuxJob, f File) error {
	ctx = context.WithValue(ctx, fileRefreshProgressKey{}, func(message string) {
		j.Message = message
		if j.ID > 0 {
			m.saveProgress(j)
		}
	})
	newPath := path.Join(path.Dir(cleanMediaPath(f.SourcePath)), j.Spec.OutputName+".mkv")
	return m.refreshAfterFileChange(ctx, j.Service, j.MediaID, f.SourcePath, newPath)
}
func (m *MuxManager) refreshAfterFileChange(ctx context.Context, serviceID string, mediaID int, oldArrPath, newArrPath string) error {
	cfg := m.s.Config()
	c := cfg.GetService(serviceID)
	if !c.Enabled {
		return errors.New("Library service is disabled")
	}
	client := NewArr(c)
	body := map[string]any{"name": "RescanMovie", "movieId": mediaID}
	if serviceKind(serviceID) == "sonarr" {
		body = map[string]any{"name": "RescanSeries", "seriesId": mediaID}
	}
	timeout := 5 * time.Minute
	if m.testRescanTimeout > 0 {
		timeout = m.testRescanTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	service := muxServiceName(serviceID)
	var command struct {
		ID     int    `json:"id"`
		Status string `json:"status"`
	}
	timedOut := func() error {
		return &fileRefreshTimeout{message: service + " did not finish the rescan within 5 minutes. The new file is in place.", commandID: command.ID}
	}
	requestError := func(e error) error {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return timedOut()
		}
		return &muxVerificationError{"Library rescan failed", e.Error()}
	}

	if e := client.muxRequest(ctx, "POST", "command", body, &command); e != nil {
		return requestError(e)
	}
	if command.ID <= 0 {
		return errors.New("Invalid rescan command")
	}
	muxLogLine(ctx, fmt.Sprintf("%s rescan requested (command %d)", service, command.ID))
	previous := ""
	poll := 2 * time.Second
	if m.testRescanPoll > 0 {
		poll = m.testRescanPoll
	}
	for {
		if e := client.muxRequest(ctx, "GET", "command/"+strconv.Itoa(command.ID), nil, &command); e != nil {
			return requestError(e)
		}
		// Only allow known command states into the public message and redacted log.
		state := strings.ToLower(command.Status)
		switch state {
		case "queued", "started", "completed", "failed", "aborted":
		default:
			state = "queued"
		}
		if state != previous {
			muxLogLine(ctx, service+" rescan: "+state)
			if state == "queued" || state == "started" {
				if progress, ok := ctx.Value(fileRefreshProgressKey{}).(func(string)); ok {
					progress("Waiting for " + service + " rescan (" + state + ")")
				}
			}
			previous = state
		}
		if state == "completed" {
			break
		}
		if state == "failed" || state == "aborted" {
			return errors.New("Library rescan failed")
		}
		select {
		case <-ctx.Done():
			if errors.Is(ctx.Err(), context.DeadlineExceeded) {
				return timedOut()
			}
			return ctx.Err()
		case <-time.After(poll):
		}
	}
	if e := m.s.Webhooks.Enqueue(WebhookJob{Service: serviceID, MediaID: mediaID, All: true, Source: tagEndpoint(c), InternalMux: true}); e != nil {
		return e
	}
	muxLogLine(ctx, "Scopearr library sync queued")
	return m.notifyFileChange(ctx, cfg, serviceID, oldArrPath, newArrPath)
}
func (m *MuxManager) notifyFileChange(ctx context.Context, cfg Settings, serviceID, oldArrPath, newArrPath string) error {
	if cfg.Mux.NotifyMedia {
		for _, media := range cfg.MediaInstancesFor(serviceID) {
			client := newMediaTagClient(media)
			mapping, e := parsePathMappings(media.PathMappings)
			if e != nil {
				return e
			}
			convert := func(p string) string {
				p = cleanMediaPath(p)
				for _, m := range mapping {
					if pathWithin(m.arr, p) {
						return m.emby + strings.TrimPrefix(p, m.arr)
					}
				}
				return p
			}
			old := convert(oldArrPath)
			newPath := convert(newArrPath)
			updates := []map[string]string{{"Path": old, "UpdateType": "Deleted"}, {"Path": newPath, "UpdateType": "Created"}}
			if old == newPath {
				updates = []map[string]string{{"Path": newPath, "UpdateType": "Modified"}}
			}
			if e := muxHTTPRequest(ctx, client.transport, client.base+"/Library/Media/Updated", "X-Emby-Token", "POST", map[string]any{"Updates": updates}, nil); e != nil {
				return &muxVerificationError{"Media server notification failed", e.Error()}
			}
			name := "Emby"
			if media.Type == "jellyfin" {
				name = "Jellyfin"
			}
			muxLogLine(ctx, name+" notified")
		}
	}
	return nil
}
