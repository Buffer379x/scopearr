package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// D30: Sonarr answers HTTP 500 for episodeFileIds that name a file it no
// longer has ("Expected query to return 19 rows but returned 8"); the delta
// then reloads the whole series, so the gone files leave the cache.
func TestSonarrDeltaFallsBackToTheSeriesWhenAFileIsGone(t *testing.T) {
	paths := []string{}
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.RequestURI())
		switch r.URL.Path {
		case "/api/v3/series/7":
			json.NewEncoder(w).Encode(map[string]any{"id": 7, "title": "Series"})
		case "/api/v3/episodefile":
			if r.URL.Query().Get("seriesId") == "7" {
				json.NewEncoder(w).Encode([]map[string]any{{"id": 9, "seriesId": 7, "seasonNumber": 1, "relativePath": "Episode.mkv"}})
				return
			}
			http.Error(w, "System.ApplicationException: Expected query to return 2 rows but returned 1", http.StatusInternalServerError)
		case "/api/v3/episode":
			json.NewEncoder(w).Encode([]map[string]any{{"id": 100, "episodeFileId": 9, "episodeNumber": 1, "airDate": "2020-01-01", "title": "Pilot"}})
		default:
			t.Fatal(r.URL.Path)
		}
	}))
	defer api.Close()
	scope := &DeltaScope{MediaID: 7, FileIDs: []int{9, 10}}
	files, e := NewArr(ServiceConfig{URL: api.URL}).FetchDelta(context.Background(), "sonarr", scope)
	if e != nil || len(files) != 1 || files[0].ID != 9 || !scope.All {
		t.Fatal(files, e, scope.All, paths)
	}
	last := ""
	for _, p := range paths {
		if p == "/api/v3/episodefile?seriesId=7" {
			last = p
		}
	}
	if last == "" {
		t.Fatal("the series was not reloaded", paths)
	}
}

// Other errors of the scoped request stay errors (a rejected key is no
// reason to reload a series).
func TestSonarrDeltaKeepsOtherErrors(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v3/series/7":
			json.NewEncoder(w).Encode(map[string]any{"id": 7, "title": "Series"})
		case "/api/v3/episodefile":
			if r.URL.Query().Get("seriesId") != "" {
				t.Error("the series must not be reloaded")
			}
			w.WriteHeader(http.StatusUnauthorized)
		default:
			t.Fatal(r.URL.Path)
		}
	}))
	defer api.Close()
	scope := &DeltaScope{MediaID: 7, FileIDs: []int{9}}
	if _, e := NewArr(ServiceConfig{URL: api.URL}).FetchDelta(context.Background(), "sonarr", scope); e == nil || e.Error() != "API key was rejected" || scope.All {
		t.Fatal(e, scope.All)
	}
}

func TestArrStatusErrorKeepsItsText(t *testing.T) {
	if got := (arrStatusError{502}).Error(); got != "Service returned HTTP 502" {
		t.Fatal(got)
	}
}
