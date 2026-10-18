package app

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
)

var ErrArrNotFound = errors.New("Service entry was not found")

type DeltaScope struct {
	MediaID int
	FileIDs []int
	All     bool
}

func deleteScopedFiles(ctx context.Context, tx *sql.Tx, service string, scope *DeltaScope) (sql.Result, error) {
	if scope == nil {
		return tx.ExecContext(ctx, "DELETE FROM files WHERE service=?", service)
	}
	if scope.MediaID <= 0 {
		return nil, errors.New("Invalid delta scope")
	}
	if scope.All {
		return tx.ExecContext(ctx, "DELETE FROM files WHERE service=? AND media_id=?", service, scope.MediaID)
	}
	args := []any{service, scope.MediaID}
	marks := []string{}
	for _, id := range scope.FileIDs {
		if id <= 0 {
			return nil, errors.New("Invalid file ID")
		}
		marks = append(marks, "?")
		args = append(args, id)
	}
	if len(marks) == 0 {
		return nil, errors.New("Empty delta scope")
	}
	return tx.ExecContext(ctx, "DELETE FROM files WHERE service=? AND media_id=? AND id IN ("+strings.Join(marks, ",")+")", args...)
}
func (c *ArrClient) FetchDelta(ctx context.Context, service string, scope *DeltaScope) ([]File, error) {
	if serviceKind(service) == "radarr" {
		var m struct {
			ID        int    `json:"id"`
			Title     string `json:"title"`
			Year      int    `json:"year"`
			TitleSlug string `json:"titleSlug"`
			TMDBID    int    `json:"tmdbId"`
		}
		e := c.get(ctx, "movie/"+strconv.Itoa(scope.MediaID), nil, &m)
		if errors.Is(e, ErrArrNotFound) {
			scope.All = true
			return []File{}, nil
		}
		if e != nil {
			return nil, e
		}
		if m.ID != scope.MediaID || m.Title == "" {
			return nil, errors.New("Invalid movie response")
		}
		scope.All = true
		var files []arrFile
		if e = c.get(ctx, "moviefile", url.Values{"movieId": {strconv.Itoa(m.ID)}}, &files); e != nil {
			return nil, e
		}
		out := []File{}
		seen := map[int]bool{}
		for _, a := range files {
			if a.ID <= 0 || seen[a.ID] || a.MovieID != m.ID || basename(a) == "" || a.Size < 0 {
				return nil, errors.New("Invalid movie file response")
			}
			seen[a.ID] = true
			f := File{ID: a.ID, Service: service, MediaID: m.ID, Title: m.Title, TitleSlug: movieSlug(m.TitleSlug, m.TMDBID), Years: []int{}, Episodes: []Episode{}, Filename: basename(a), SourcePath: a.Path, Size: a.Size}
			if m.Year > 0 {
				f.Years = []int{m.Year}
			}
			a.MediaInfo.Quality = a.Quality.Quality.Name
			Enrich(&f, a.MediaInfo)
			out = append(out, f)
		}
		return out, nil
	}
	var series struct {
		ID        int    `json:"id"`
		Title     string `json:"title"`
		TitleSlug string `json:"titleSlug"`
	}
	e := c.get(ctx, "series/"+strconv.Itoa(scope.MediaID), nil, &series)
	if errors.Is(e, ErrArrNotFound) {
		scope.All = true
		return []File{}, nil
	}
	if e != nil {
		return nil, e
	}
	if series.ID != scope.MediaID || series.Title == "" {
		return nil, errors.New("Invalid series response")
	}
	q := url.Values{}
	if scope.All {
		q.Set("seriesId", strconv.Itoa(scope.MediaID))
	} else {
		for _, id := range scope.FileIDs {
			q.Add("episodeFileIds", strconv.Itoa(id))
		}
	}
	var files []arrFile
	if e = c.get(ctx, "episodefile", q, &files); e != nil {
		return nil, e
	}
	allowed := map[int]bool{}
	for _, id := range scope.FileIDs {
		allowed[id] = true
	}
	seen, seenEpisodes := map[int]bool{}, map[int]bool{}
	out := []File{}
	// Two requests at most are in flight. Episode mappings are limited to one file.
	for _, a := range files {
		if a.ID <= 0 || seen[a.ID] || (!scope.All && !allowed[a.ID]) || (a.SeriesID != 0 && a.SeriesID != scope.MediaID) || basename(a) == "" || a.Size < 0 {
			return nil, errors.New("Invalid episode file response")
		}
		seen[a.ID] = true
		var episodes []arrEpisode
		if e = c.get(ctx, "episode", url.Values{"episodeFileId": {strconv.Itoa(a.ID)}}, &episodes); e != nil {
			return nil, e
		}
		byFile, err := episodeMappings(episodes, scope.MediaID, map[int]bool{a.ID: true}, seenEpisodes, true)
		if err != nil {
			return nil, err
		}
		out = append(out, seriesFile(a, series.ID, series.Title, series.TitleSlug, byFile[a.ID]))
	}
	return out, nil
}
func (s *Store) preserveDeltaEmby(ctx context.Context, service string, files []File, enabled bool) error {
	for i := range files {
		f := &files[i]
		var raw string
		err := s.DB.QueryRowContext(ctx, "SELECT data FROM files WHERE service=? AND id=?", service, f.ID).Scan(&raw)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		var old File
		if err == nil {
			if e := json.Unmarshal([]byte(raw), &old); e != nil {
				return e
			}
		}
		if enabled && old.ID == f.ID && old.Filename == f.Filename && old.Size == f.Size {
			f.EmbyMatch = old.EmbyMatch
			f.MediaServers = old.MediaServers
			f.MediaOrigin = old.MediaOrigin
			f.AudioTracks = old.AudioTracks
			e := f.Evidence["hdr"]
			e.Emby = old.Evidence["hdr"].Emby
			f.Evidence["hdr"] = e
			f.RecognitionRevision = ""
		} else if enabled {
			f.EmbyMatch = "pending"
		} else {
			f.EmbyMatch = "unconfigured"
		}
	}
	return nil
}
