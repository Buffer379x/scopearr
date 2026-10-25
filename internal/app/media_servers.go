package app

import (
	"encoding/json"
	"fmt"
	"net/url"
	"sort"
	"strings"
)

func mediaProviderOK(provider string) bool {
	return serviceKind(provider) == "emby" || serviceKind(provider) == "jellyfin"
}
func invalidMediaConfig(c ServiceConfig) bool {
	return c.Interval != 0 || c.TagImport || c.TagImportInterval != 0 || c.SyncStart != "" || c.WebhookEnabled
}

// Reclassify cached dimensions without upstream reads. Snapshot matches and
// interned video values are immutable, so replace only changed entries.
func normalizeStoredMediaVideo(f *File) bool {
	changed := false
	f.MediaServers.each(func(id string, match *MediaMatch) {
		if match == nil || match.Video == nil || match.Video.Width <= 0 || match.Video.Height <= 0 {
			return
		}
		video := *match.Video
		video.Resolution = mediaResolution(video.Width, video.Height, strings.HasSuffix(video.Resolution, "i"))
		if video.Resolution == match.Video.Resolution {
			return
		}
		if !changed {
			matches := *f.MediaServers
			matches.Instances = append([]mediaMatchEntry(nil), matches.Instances...)
			f.MediaServers = &matches
			changed = true
		}
		updated := *match
		updated.Video = &video
		f.MediaServers.put(id, &updated)
	})
	return changed
}

// Provider identity and metadata remain separate. Never construct fictional
// language/codec pairings by combining disagreeing server track inventories.
func resolveMediaServers(f *File) {
	normalizeStoredMediaVideo(f)
	if f.MediaServers.count() == 0 {
		return
	}
	engine := f.comparisonEngine
	if engine == nil {
		engine = defaultRecognitionEngine
	}
	if f.APIInfo != nil {
		api := *f.APIInfo
		EnrichWithRules(f, api, engine)
	}
	f.AudioTracks = nil
	f.MediaOrigin = ""
	f.EmbyMatch = "missing"
	var selected *MediaMatch
	providers := []string{}
	statuses := map[string]bool{}
	keys := f.MediaServers.ids()
	sort.Strings(keys)
	for _, provider := range keys {
		value := f.MediaServers.get(provider)
		if value == nil {
			continue
		}
		statuses[value.Status] = true
		if value.Status != "matched" && value.Status != "no_tracks" {
			continue
		}
		if selected != nil && ((len(selected.Tracks) > 0 && len(value.Tracks) > 0 && trackInventory(selected.Tracks) != trackInventory(value.Tracks)) || mediaVideoConflict(selected.Video, value.Video)) {
			f.EmbyMatch = "conflicting"
			updateCompleteness(f)
			return
		}
		if selected == nil {
			copy := *value
			selected = &copy
		} else {
			selected.HDR = mergeHDR(selected.HDR, value.HDR)
			if len(selected.Tracks) == 0 {
				selected.Tracks = value.Tracks
			}
			selected.Video = mergeMediaVideo(selected.Video, value.Video)
		}
		providers = append(providers, provider)
	}
	if selected != nil {
		codecs, languages := map[string]bool{}, map[string]bool{}
		for _, track := range selected.Tracks {
			if track.Codec != "" {
				codecs[track.Codec] = true
			}
			if track.Language != "" {
				languages[track.Language] = true
			}
		}
		metadata := embyMetadata{video: selected.Video, tracks: selected.Tracks, audio: joinEmbyTraits(codecs, " + "), language: joinEmbyTraits(languages, ", "), hdr: selected.HDR}
		applyEmbyMetadata(f, metadata)
		f.MediaOrigin = strings.Join(providers, " + ")
		for field, e := range f.Evidence {
			if e.Origin == "emby" {
				e.Origin = "mediaServer"
				f.Evidence[field] = e
			}
		}
	} else {
		// Most actionable failure wins for the combined status; individual results
		// are still available in file details.
		for _, status := range []string{"unconfigured", "missing_size", "missing", "pending", "ambiguous"} {
			if statuses[status] {
				f.EmbyMatch = status
			}
		}
	}
	updateCompleteness(f)
}
func trackInventory(tracks []AudioTrack) string {
	values := []string{}
	for _, t := range tracks {
		raw, _ := json.Marshal([]any{t.Language, t.Codec, t.Channels})
		values = append(values, string(raw))
	}
	sort.Strings(values)
	return strings.Join(values, "|")
}

var mediaStateFilters = map[string]string{"mediaMatched": "matched", "mediaMissing": "missing", "mediaAmbiguous": "ambiguous", "mediaConflicting": "conflicting", "mediaNoTracks": "no_tracks", "mediaPending": "pending", "mediaUnconfigured": "unconfigured"}

func appendMediaFilters(q url.Values, w *[]string, a *[]any) error {
	positive, negative := []string{}, []string{}
	keys := []string{}
	for key := range mediaStateFilters {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		if v := q.Get(key); v != "" {
			if v != "true" && v != "false" {
				return fmt.Errorf("Invalid media server match filter")
			}
			states := []string{mediaStateFilters[key]}
			if key == "mediaMissing" {
				states = append(states, "missing_size")
			}
			if v == "true" {
				positive = append(positive, states...)
			} else {
				negative = append(negative, states...)
			}
		}
	}
	if len(positive) > 0 {
		*w = append(*w, "coalesce(nullif(f.emby_match,''),'unconfigured') IN ("+strings.TrimRight(strings.Repeat("?,", len(positive)), ",")+")")
		for _, v := range positive {
			*a = append(*a, v)
		}
	}
	if len(negative) > 0 {
		*w = append(*w, "coalesce(nullif(f.emby_match,''),'unconfigured') NOT IN ("+strings.TrimRight(strings.Repeat("?,", len(negative)), ",")+")")
		for _, v := range negative {
			*a = append(*a, v)
		}
	}
	return nil
}

// Compare only attributes reported by both providers. An absent stream inventory
// is incomplete data, not evidence of a different file.
func mediaVideoConflict(a, b *MediaVideo) bool {
	if a == nil || b == nil {
		return false
	}
	return (a.Resolution != "" && b.Resolution != "" && a.Resolution != b.Resolution) ||
		(a.Codec != "" && b.Codec != "" && family(a.Codec) != family(b.Codec)) ||
		(a.BitDepth != "" && b.BitDepth != "" && a.BitDepth != b.BitDepth)
}
func mergeMediaVideo(a, b *MediaVideo) *MediaVideo {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	merged := *a
	if merged.Width == 0 && merged.Height == 0 {
		merged.Width = b.Width
		merged.Height = b.Height
	}
	if merged.Resolution == "" {
		merged.Resolution = b.Resolution
	}
	if merged.Codec == "" {
		merged.Codec = b.Codec
	}
	if merged.BitDepth == "" {
		merged.BitDepth = b.BitDepth
	}
	if merged == *a {
		return a
	}
	return &merged
}
