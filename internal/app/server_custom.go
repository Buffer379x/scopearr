package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"reflect"
	"strconv"
	"strings"
	"time"
	"unicode"
)

func (s *Server) customTagsBatchHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "PUT" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	var draft struct {
		Original []CustomTag     `json:"original"`
		Tags     []CustomTag     `json:"tags"`
		Files    []FileKey       `json:"files"`
		Query    string          `json:"query"`
		Changes  map[string]bool `json:"changes"`
	}
	if err := decodeLimit(w, r, &draft, 1024*1024); err != nil {
		failure(w, r, http.StatusBadRequest, err)
		return
	}
	if draft.Files != nil || draft.Changes != nil {
		s.applyCustomFiles(w, r, draft.Query, draft.Files, draft.Changes)
		return
	}
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	before, err := s.Store.CustomTags(r.Context())
	if err != nil {
		failure(w, r, 500, err)
		return
	}
	tags, err := s.Store.SaveCustomTags(r.Context(), draft.Original, draft.Tags)
	if err != nil {
		failure(w, r, http.StatusBadRequest, err)
		return
	}
	if err := s.refreshTagSettings(); err != nil {
		failure(w, r, http.StatusInternalServerError, errors.New("Could not load settings"))
		return
	}
	s.queueTagSync()
	s.logCustomTagChanges(before, tags)
	jsonOut(w, http.StatusOK, tags)
}

func (s *Server) customTagsHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		tags, err := s.Store.CustomTags(r.Context())
		if err != nil {
			failure(w, r, http.StatusInternalServerError, err)
		} else {
			jsonOut(w, http.StatusOK, tags)
		}
		return
	}
	var tag CustomTag
	if err := decodeLimit(w, r, &tag, 2048); err != nil {
		failure(w, r, http.StatusBadRequest, err)
		return
	}
	if r.Method != "POST" && r.Method != "PUT" && r.Method != "DELETE" {
		failure(w, r, 405, errors.New("Endpoint or method not supported"))
		return
	}
	s.settingsMu.Lock()
	defer s.settingsMu.Unlock()
	before, readErr := s.Store.CustomTags(r.Context())
	if readErr != nil {
		failure(w, r, 500, readErr)
		return
	}
	switch r.Method {
	case "POST", "PUT":
		out, err := s.Store.SaveCustomTag(r.Context(), tag)
		if err != nil {
			failure(w, r, http.StatusBadRequest, err)
		} else {
			s.queueTagSync()
			after, readErr := s.Store.CustomTags(r.Context())
			if readErr == nil {
				s.logCustomTagChanges(before, after)
			}
			jsonOut(w, http.StatusOK, out)
		}
		return
	case "DELETE":
		if tag.ID <= 0 {
			failure(w, r, http.StatusBadRequest, errors.New("Invalid custom tag"))
			return
		}
		if err := s.Store.DeleteCustomTag(r.Context(), tag.ID); err != nil {
			failure(w, r, http.StatusBadRequest, err)
		} else {
			if err := s.refreshTagSettings(); err != nil {
				failure(w, r, http.StatusInternalServerError, errors.New("Could not load settings"))
				return
			}
			s.queueTagSync()
			after, readErr := s.Store.CustomTags(r.Context())
			if readErr == nil {
				s.logCustomTagChanges(before, after)
			}
			jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
		}
		return
	}
	failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))

}

func (s *Server) customSelectionHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method == "GET" {
		out, err := s.Store.CustomSelection(r.Context(), r.URL.Query())
		if err != nil {
			failure(w, r, http.StatusBadRequest, err)
		} else {
			jsonOut(w, http.StatusOK, out)
		}
		return
	}
	if r.Method == "PUT" || r.Method == "POST" {
		var in struct {
			Query   string               `json:"query"`
			Files   []FileKey            `json:"files"`
			Changes map[string]bool      `json:"changes"`
			Create  []selectionTagCreate `json:"create"`
		}
		if err := decodeLimit(w, r, &in, 1024*1024); err != nil {
			failure(w, r, http.StatusBadRequest, err)
			return
		}
		if r.Method == "POST" {
			q, e := url.ParseQuery(in.Query)
			if e == nil {
				q, e = explicitSelection(q, in.Files)
			}
			if e != nil {
				failure(w, r, 400, e)
				return
			}
			out, e := s.Store.CustomSelection(r.Context(), q)
			if e != nil {
				failure(w, r, 400, e)
			} else {
				jsonOut(w, 200, out)
			}
		} else {
			s.settingsMu.Lock()
			defer s.settingsMu.Unlock()
			changes, created, err := s.createSelectionTags(r.Context(), in.Changes, in.Create)
			if err != nil {
				failure(w, r, http.StatusBadRequest, err)
				return
			}
			s.applyCustomFiles(w, r, in.Query, in.Files, changes, created)
		}

		return
	}
	failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))

}

func (s *Server) applyCustomFiles(w http.ResponseWriter, r *http.Request, query string, files []FileKey, changes map[string]bool, created ...bool) {
	q, err := url.ParseQuery(query)
	if err == nil {
		q, err = explicitSelection(q, files)
	}
	applyError := func(err error) {
		if len(created) > 0 && created[0] {
			err = fmt.Errorf("The tag was created, but could not be applied: %w", err)
		}
		failure(w, r, http.StatusBadRequest, err)
	}
	if err != nil {
		applyError(err)
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(190 * time.Second))
	ctx, cancel := context.WithTimeout(r.Context(), 180*time.Second)
	defer cancel()
	total, err := s.Store.ApplyCustom(ctx, q, changes)
	if err != nil {
		applyError(err)
	} else {
		s.queueTagSync()
		jsonOut(w, 200, map[string]int{"total": total})
	}
}

func (s *Server) logCustomTagChanges(before, after []CustomTag) {
	old := map[int64]CustomTag{}
	for _, tag := range before {
		old[tag.ID] = tag
	}
	changes := 0
	for _, tag := range after {
		previous, exists := old[tag.ID]
		if !exists || !reflect.DeepEqual(previous, tag) {
			changes++
		}
		delete(old, tag.ID)
	}
	changes += len(old)
	if changes > 0 {
		s.Store.Events.Info("settings", "", "Custom tags saved · {count} changes", map[string]any{"count": changes}, "")
	}
}

// selectionTagCreate carries client-local keys until the selected tags have IDs.
type selectionTagCreate struct {
	Key  string `json:"key"`
	Name string `json:"name"`
}

// The caller holds settingsMu, like the settings tag editor, so simultaneous
// submissions resolve the same case-insensitive name to the same stored tag.
func (s *Server) createSelectionTags(ctx context.Context, changes map[string]bool, create []selectionTagCreate) (map[string]bool, bool, error) {
	if len(create) > 128 {
		return nil, false, errors.New("At most 128 custom tags are allowed")
	}
	before, err := s.Store.CustomTags(ctx)
	if err != nil {
		return nil, false, err
	}
	byName := map[string]CustomTag{}
	for _, tag := range before {
		byName[strings.ToLower(tag.Name)] = tag
	}
	keys := map[string]string{}
	pendingNames := map[string]bool{}
	for _, tag := range create {
		index, err := strconv.Atoi(strings.TrimPrefix(tag.Key, "new:"))
		if !strings.HasPrefix(tag.Key, "new:") || err != nil || index < 1 || tag.Key != fmt.Sprintf("new:%d", index) {
			return nil, false, errors.New("Invalid custom tag")
		}
		if _, exists := keys[tag.Key]; exists {
			return nil, false, errors.New("Invalid custom tag")
		}
		name := strings.TrimSpace(tag.Name)
		if name == "" || len([]rune(name)) > 80 || strings.ContainsFunc(name, unicode.IsControl) {
			return nil, false, errors.New("Enter a tag name between 1 and 80 characters")
		}
		keys[tag.Key] = name
		if changes[tag.Key] && byName[strings.ToLower(name)].ID == 0 {
			pendingNames[strings.ToLower(name)] = true
		}
	}
	if len(before)+len(pendingNames) > 128 {
		return nil, false, errors.New("At most 128 custom tags are allowed")
	}
	resolved := make(map[string]bool, len(changes))
	// Validate every local key before creating anything or changing assignments.
	for key, on := range changes {
		if strings.HasPrefix(key, "new:") {
			if _, exists := keys[key]; !exists {
				return nil, false, errors.New("Invalid custom tag")
			}
		} else {
			resolved[key] = on
		}
	}
	created := false
	for _, local := range create {
		if !changes[local.Key] {
			continue
		}
		name := keys[local.Key]
		key := strings.ToLower(name)
		tag := byName[key]
		if tag.ID == 0 {
			tag, err = s.Store.SaveCustomTag(ctx, CustomTag{Name: name})
			if err != nil {
				return nil, created, err
			}
			byName[key] = tag
			created = true
		}
		resolved[strconv.FormatInt(tag.ID, 10)] = true
	}
	if created {
		after, err := s.Store.CustomTags(ctx)
		if err != nil {
			return nil, true, err
		}
		s.logCustomTagChanges(before, after)
		s.queueTagSync()
	}
	return resolved, created, nil
}
