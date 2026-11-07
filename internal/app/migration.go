package app

import "encoding/json"

// Upgrade cached traits using only the filename and already saved API evidence.
// No service requests or media scans are needed, and all updates are atomic.
func (s *Store) upgradeMediaTraits() error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var last int64
	for {
		rows, err := tx.Query("SELECT rowid,data FROM files WHERE rowid>? ORDER BY rowid LIMIT 500", last)
		if err != nil {
			return err
		}
		type entry struct {
			id   int64
			file File
		}
		batch := []entry{}
		for rows.Next() {
			var id int64
			var raw string
			if err = rows.Scan(&id, &raw); err != nil {
				rows.Close()
				return err
			}
			var f File
			if err = json.Unmarshal([]byte(raw), &f); err != nil {
				rows.Close()
				return err
			}
			batch = append(batch, entry{id, f})
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if len(batch) == 0 {
			break
		}
		for _, item := range batch {
			f := item.file
			oldAPI := func(field, fallback string) string {
				if e, ok := f.Evidence[field]; ok {
					return e.API
				}
				return fallback
			}
			oldHDR := f.Evidence["hdr"]
			parsed := File{Filename: f.Filename}
			Enrich(&parsed, APIInfo{AudioCodec: oldAPI("audio", f.Audio), VideoDynamicRangeType: oldAPI("hdr", f.HDR), AudioLanguages: oldAPI("language", f.Language)})
			f.Audio, f.HDR, f.Language = parsed.Audio, parsed.HDR, parsed.Language
			if f.Evidence == nil {
				f.Evidence = map[string]Evidence{}
			}
			for _, field := range []string{"audio", "hdr", "language"} {
				f.Evidence[field] = parsed.Evidence[field]
			}
			if oldHDR.Emby != "" {
				f.HDR = hdrToken(f.HDR + " " + oldHDR.Emby)
				e := f.Evidence["hdr"]
				e.Emby = oldHDR.Emby
				e.Origin = "combined"
				f.Evidence["hdr"] = e
			}
			if len(f.AudioTracks) > 0 && f.EmbyMatch == "matched" {
				streams := []embyStream{}
				for _, track := range f.AudioTracks {
					streams = append(streams, embyStream{Type: "Audio", Index: track.Index, Language: track.Language, Codec: track.Codec, Channels: track.Channels, ChannelLayout: track.ChannelLayout, Title: track.Title, IsDefault: track.Default})
				}
				applyEmby(&f, streams)
			}
			updateCompleteness(&f)
			refreshEvidenceConflict(&f)
			data, err := json.Marshal(f)
			if err != nil {
				return err
			}
			if _, err = tx.Exec("UPDATE files SET audio=?,hdr=?,language=?,conflict=?,data=? WHERE rowid=?", f.Audio, f.HDR, f.Language, f.Conflict, string(data), item.id); err != nil {
				return err
			}
			last = item.id
		}
	}
	if _, err = tx.Exec("PRAGMA user_version=4"); err != nil {
		return err
	}
	return tx.Commit()
}
