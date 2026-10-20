package app

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ArrClient struct {
	MuxKind string
	Base    string
	Key     string
	HTTP    *http.Client
}

func NewArr(c ServiceConfig) *ArrClient {
	return &ArrClient{serviceKind(c.ID), c.URL, c.APIKey, &http.Client{Timeout: 20 * time.Second, CheckRedirect: func(r *http.Request, via []*http.Request) error {
		return errors.New("Redirects are not allowed; use the direct service address")
	}}}
}
func ValidateConfig(c ServiceConfig) error {
	if c.TagImportInterval != -1 && c.TagImportInterval != 0 && c.TagImportInterval != 5 && c.TagImportInterval != 15 && c.TagImportInterval != 30 {
		return errors.New("Invalid tag check interval")
	}

	if c.SyncStart != "" {
		if _, err := time.Parse("15:04", c.SyncStart); err != nil {
			return errors.New("Invalid sync start time")
		}
	}
	if _, err := parsePathMappings(c.PathMappings); err != nil {
		return err
	}
	validInterval := map[int]bool{0: true, 15: true, 30: true, 60: true, 360: true, 1440: true}
	if !validInterval[c.Interval] {
		return errors.New("Invalid sync interval")
	}
	if !c.Enabled && c.URL == "" {
		return nil
	}
	u, e := url.Parse(c.URL)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("Service address must be an HTTP(S) URL without credentials, query or fragment")
	}
	if c.Enabled && c.APIKey == "" {
		return errors.New("API key is missing")
	}
	return nil
}
func (c *ArrClient) get(ctx context.Context, path string, q url.Values, out any) error {
	allowed := map[string]bool{"rootfolder": true, "system/status": true, "movie": true, "moviefile": true, "series": true, "episode": true, "episodefile": true, "diskspace": true, "tag": true, "tag/detail": true, "autotagging": true}
	if !allowed[path] && !positiveTagPath(path, "tag/detail/") && !positiveTagPath(path, "movie/") && !positiveTagPath(path, "series/") && !positiveTagPath(path, "moviefile/") && !positiveTagPath(path, "episodefile/") {
		return errors.New("API endpoint is not allowed")
	}
	u, e := url.Parse(strings.TrimRight(c.Base, "/") + "/api/v3/" + path)
	if e != nil {
		return errors.New("Invalid service address")
	}
	u.RawQuery = q.Encode()
	return c.readJSON(ctx, u, "X-Api-Key", out)
}

// Catalog and Emby reads share GET-only requests, timeouts, bounded retries and header authentication.
// Optional outbound tag mutations have a separate strict allowlist.
func (c *ArrClient) readJSON(ctx context.Context, u *url.URL, keyHeader string, out any) error {
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			timer := time.NewTimer(time.Duration(attempt) * 250 * time.Millisecond)
			select {
			case <-ctx.Done():
				timer.Stop()
				return ctx.Err()
			case <-timer.C:
			}
		}
		r, e := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
		if e != nil {
			return errors.New("Could not create request")
		}
		r.Header.Set(keyHeader, c.Key)
		r.Header.Set("Accept", "application/json")
		res, e := c.HTTP.Do(r)
		if e != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if attempt < 2 {
				continue
			}
			return errors.New("Service unreachable, timed out or TLS validation failed")
		}
		if res.StatusCode != http.StatusOK {
			res.Body.Close()
			if res.StatusCode >= http.StatusInternalServerError && attempt < 2 {
				continue
			}
			if res.StatusCode == http.StatusUnauthorized || res.StatusCode == http.StatusForbidden {
				return errors.New("API key was rejected")
			}
			if res.StatusCode == http.StatusNotFound {
				return ErrArrNotFound
			}
			return fmt.Errorf("Service returned HTTP %d", res.StatusCode)
		}
		e = decodeServiceJSON(res.Body, out, 64<<20)
		res.Body.Close()
		if e != nil {
			return errors.New("Invalid or oversized API response")
		}
		return nil
	}
	return errors.New("API request failed")
}

// Require a complete non-null object/list without holding a second response copy.
func decodeServiceJSON(body io.Reader, out any, max int64) error {
	limited := &io.LimitedReader{R: body, N: max + 1}
	reader := bufio.NewReader(limited)
	for {
		b, err := reader.ReadByte()
		if err != nil {
			return err
		}
		if b == ' ' || b == '\n' || b == '\r' || b == '\t' {
			continue
		}
		if b != '[' && b != '{' {
			return errors.New("API response must be a list or object")
		}
		if err = reader.UnreadByte(); err != nil {
			return err
		}
		break
	}
	decoder := json.NewDecoder(reader)
	if err := decoder.Decode(out); err != nil {
		return err
	}
	var extra struct{}
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("Incomplete or multipart API response")
	}
	if limited.N == 0 {
		return errors.New("API response exceeds the size limit")
	}
	return nil
}

func readPair(ctx context.Context, first, second func(context.Context) error) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	errs := make(chan error, 2)
	var wg sync.WaitGroup
	for _, read := range []func(context.Context) error{first, second} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			err := read(ctx)
			if err != nil {
				cancel()
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	var result error
	for err := range errs {
		if err != nil && (result == nil || errors.Is(result, context.Canceled)) {
			result = err
		}
	}
	return result
}
func (c *ArrClient) Test(ctx context.Context) (string, error) {
	var out struct {
		Version string `json:"version"`
	}
	e := c.get(ctx, "system/status", nil, &out)
	return out.Version, e
}

type quality struct {
	Quality struct {
		Name string `json:"name"`
	} `json:"quality"`
}
type arrFile struct {
	ID           int     `json:"id"`
	MovieID      int     `json:"movieId"`
	SeriesID     int     `json:"seriesId"`
	Season       int     `json:"seasonNumber"`
	RelativePath string  `json:"relativePath"`
	Path         string  `json:"path"`
	Size         int64   `json:"size"`
	Quality      quality `json:"quality"`
	MediaInfo    APIInfo `json:"mediaInfo"`
}

func basename(f arrFile) string {
	p := f.RelativePath
	if p == "" {
		p = f.Path
	}
	p = strings.ReplaceAll(p, "\\", "/")
	parts := strings.Split(p, "/")
	return parts[len(parts)-1]
}
func (c *ArrClient) Fetch(ctx context.Context, service string) ([]File, error) {
	if serviceKind(service) == "radarr" {
		return c.movies(ctx)
	}
	if serviceKind(service) == "sonarr" {
		return c.series(ctx)
	}
	return nil, errors.New("Invalid service")
}
func (c *ArrClient) movies(ctx context.Context) ([]File, error) {
	var movies []struct {
		ID        int    `json:"id"`
		Title     string `json:"title"`
		Year      int    `json:"year"`
		TitleSlug string `json:"titleSlug"`
		TMDBID    int    `json:"tmdbId"`
	}
	if e := c.get(ctx, "movie", url.Values{"excludeLocalCovers": {"true"}}, &movies); e != nil {
		return nil, e
	}
	index := map[int]struct {
		title string
		year  int
		slug  string
	}{}
	for _, m := range movies {
		if m.ID <= 0 || m.Title == "" {
			return nil, errors.New("Incomplete movie catalog")
		}
		if _, duplicate := index[m.ID]; duplicate {
			return nil, errors.New("Duplicate movie ID in catalog")
		}
		index[m.ID] = struct {
			title string
			year  int
			slug  string
		}{m.Title, m.Year, movieSlug(m.TitleSlug, m.TMDBID)}
	}
	out := make([]File, 0, len(movies))
	seenFiles := map[int]bool{}
	for start := 0; start < len(movies); start += 100 {
		end := start + 100
		if end > len(movies) {
			end = len(movies)
		}
		q := url.Values{}
		batch := map[int]bool{}
		for _, m := range movies[start:end] {
			batch[m.ID] = true
			q.Add("movieId", strconv.Itoa(m.ID))
		}
		var files []arrFile
		if e := c.get(ctx, "moviefile", q, &files); e != nil {
			return nil, e
		}
		for _, a := range files {
			if a.ID <= 0 || seenFiles[a.ID] || !batch[a.MovieID] || basename(a) == "" || a.Size < 0 {
				return nil, errors.New("Invalid or duplicate movie file")
			}
			seenFiles[a.ID] = true
			m, ok := index[a.MovieID]
			if !ok {
				return nil, errors.New("Movie mapping changed during sync; sync again")
			}
			f := File{ID: a.ID, Service: "radarr", MediaID: a.MovieID, TitleSlug: m.slug, Title: m.title, Filename: basename(a), SourcePath: a.Path, Size: a.Size, Years: []int{}, Episodes: []Episode{}}
			if m.year > 0 {
				f.Years = []int{m.year}
			}
			a.MediaInfo.Quality = a.Quality.Quality.Name
			Enrich(&f, a.MediaInfo)
			out = append(out, f)
		}
	}
	return out, nil
}
func (c *ArrClient) series(ctx context.Context) ([]File, error) {
	var series []struct {
		ID        int    `json:"id"`
		Title     string `json:"title"`
		TitleSlug string `json:"titleSlug"`
	}
	if e := c.get(ctx, "series", nil, &series); e != nil {
		return nil, e
	}
	out := []File{}
	seenSeries, seenFiles, seenEpisodes := map[int]bool{}, map[int]bool{}, map[int]bool{}
	for _, s := range series {
		if s.ID <= 0 || s.Title == "" || seenSeries[s.ID] {
			return nil, errors.New("Invalid series catalog")
		}
		seenSeries[s.ID] = true
		q := url.Values{"seriesId": {strconv.Itoa(s.ID)}}
		var files []arrFile
		var episodes []arrEpisode
		if e := readPair(ctx, func(ctx context.Context) error { return c.get(ctx, "episodefile", q, &files) }, func(ctx context.Context) error { return c.get(ctx, "episode", q, &episodes) }); e != nil {
			return nil, e
		}
		fileIDs := map[int]bool{}
		for _, a := range files {
			if a.ID <= 0 || seenFiles[a.ID] || fileIDs[a.ID] || (a.SeriesID != 0 && a.SeriesID != s.ID) || basename(a) == "" || a.Size < 0 {
				return nil, errors.New("Invalid or duplicate episode file")
			}
			fileIDs[a.ID] = true
		}
		byFile, err := episodeMappings(episodes, s.ID, fileIDs, seenEpisodes, false)
		if err != nil {
			return nil, err
		}
		for _, a := range files {
			seenFiles[a.ID] = true
			out = append(out, seriesFile(a, s.ID, s.Title, s.TitleSlug, byFile[a.ID]))
		}
	}
	return out, nil
}
