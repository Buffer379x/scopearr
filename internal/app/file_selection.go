package app

import (
	"encoding/json"
	"fmt"
	"net/url"
)

const fileSelectionLimit = 10000

type FileKey struct {
	Service  string `json:"service"`
	ID       int    `json:"id"`
	MediaID  int    `json:"mediaId,omitempty"`
	Filename string `json:"filename,omitempty"`
	Title    string `json:"title,omitempty"`
	Season   *int   `json:"season,omitempty"`
}

// Bind one bounded JSON value instead of thousands of SQL placeholders.
func explicitSelection(q url.Values, keys []FileKey) (url.Values, error) {
	if keys == nil {
		return q, nil
	}
	if len(keys) == 0 || len(keys) > fileSelectionLimit {
		return nil, fmt.Errorf("Select between 1 and 10000 files")
	}
	for _, k := range keys {
		if !serviceOK(k.Service) || k.ID <= 0 {
			return nil, fmt.Errorf("Invalid file selection")
		}
	}
	raw, e := json.Marshal(keys)
	if e != nil {
		return nil, e
	}
	return url.Values{"_files": {string(raw)}}, nil
}
