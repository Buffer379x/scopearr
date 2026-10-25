package app

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
)

// Emby supplements cached per-track metadata. No playback, probing or refresh endpoints exist here.
type EmbyClient struct {
	transport *ArrClient
	mappings  []pathMapping
	provider  string
	instance  string
	endpoint  string
}

func NewEmby(c ServiceConfig) *EmbyClient {
	mappings, _ := parsePathMappings(c.PathMappings)
	id := c.ID
	if id == "" {
		id = "emby"
	}
	return &EmbyClient{transport: NewArr(c), mappings: mappings, provider: "emby", instance: id, endpoint: tagEndpoint(c)}
}
func NewJellyfin(c ServiceConfig) *EmbyClient {
	client := NewEmby(c)
	client.provider = "jellyfin"
	if c.ID == "" {
		client.instance = "jellyfin"
	}
	return client
}
func (c *EmbyClient) label() string {
	if c.provider == "jellyfin" {
		return "Jellyfin"
	}
	return "Emby"
}
func (c *EmbyClient) get(ctx context.Context, endpoint string, q url.Values, out any) error {
	if endpoint != "System/Info" && endpoint != "Items" {
		return errors.New(strings.ReplaceAll("Emby endpoint is not allowed", "Emby", c.label()))
	}
	base := strings.TrimRight(c.transport.Base, "/")
	if c.provider != "jellyfin" && !strings.HasSuffix(strings.ToLower(base), "/emby") {
		base += "/emby"
	}
	u, err := url.Parse(base + "/" + endpoint)
	if err != nil {
		return errors.New(strings.ReplaceAll("Invalid Emby address", "Emby", c.label()))
	}
	u.RawQuery = q.Encode()
	return c.transport.readJSON(ctx, u, "X-Emby-Token", out)
}
func (c *EmbyClient) Test(ctx context.Context) (string, error) {
	var info struct{ Version string }
	err := c.get(ctx, "System/Info", nil, &info)
	return info.Version, err
}

type embyStream struct {
	Width                     int
	Height                    int
	BitDepth                  int
	IsInterlaced              bool
	CodecTag                  string
	Type                      string
	Index                     int
	Codec                     string
	Profile                   string
	Language                  string
	DisplayLanguage           string
	Channels                  int
	ChannelLayout             string
	Title                     string
	IsDefault                 bool
	IsExternal                bool
	ExtendedVideoType         string
	ExtendedVideoSubType      string
	VideoRangeType            string
	DvBlSignalCompatibilityId *int
	Hdr10PlusPresentFlag      bool
}
type embySource struct {
	Id           string
	Path         string
	Size         int64
	IsRemote     bool
	MediaStreams []embyStream
}
type embyItem struct {
	ServerId     string
	SeriesId     string
	Id           string
	Type         string
	Path         string
	Size         int64
	MediaStreams []embyStream
	MediaSources []embySource
}
type fileIdentity struct {
	name string
	size int64
}

func pathBasename(path string) string {
	parts := strings.Split(strings.ReplaceAll(path, "\\", "/"), "/")
	return parts[len(parts)-1]
}

func (c *EmbyClient) Enrich(ctx context.Context, service string, files []File) error {
	defer func() {
		for i := range files {
			if value := files[i].MediaServers.get(c.instance); value != nil {
				files[i].EmbyMatch = value.Status
			} else {
				files[i].setMediaMatch(c.instance, MediaMatch{Status: files[i].EmbyMatch})
			}
			resolveMediaServers(&files[i])
			updateCompleteness(&files[i])
		}
	}()
	if !serviceOK(service) {
		return errors.New("Invalid service")
	}
	// One-based indexes avoid an allocation and slice header for every unique
	// filename. Only genuinely duplicate local identities need an index slice.
	wanted := map[fileIdentity]int{}
	duplicateWanted := map[fileIdentity][]int{}
	for i := range files {
		files[i].EmbyMatch = "missing"

		if files[i].Size <= 0 {
			files[i].EmbyMatch = "missing_size"
			files[i].setMediaMatch(c.instance, MediaMatch{Status: "missing_size"})
			continue
		}
		key := fileIdentity{files[i].Filename, files[i].Size}
		if first, exists := wanted[key]; !exists {
			wanted[key] = i + 1
		} else if first != 0 {
			duplicateWanted[key] = []int{first - 1, i}
			wanted[key] = 0
		} else {
			duplicateWanted[key] = append(duplicateWanted[key], i)
		}
	}
	if len(wanted) == 0 {
		return nil
	}
	type candidate struct {
		pathHash  [32]byte
		signature [32]byte
		ambiguous bool
	}
	matches := map[fileIdentity]candidate{}
	pool := newMediaPool()
	itemType := "Movie"
	if serviceKind(service) == "sonarr" {
		itemType = "Episode"
	}
	start, expectedTotal := 0, -1
	seenItems := map[string]bool{}
	for {
		q := url.Values{"Recursive": {"true"}, "IncludeItemTypes": {itemType}, "Fields": {"Path,MediaSources,MediaStreams"}, "EnableTotalRecordCount": {"true"}, "EnableImages": {"false"}, "EnableUserData": {"false"}, "SortBy": {"SortName"}, "SortOrder": {"Ascending"}, "StartIndex": {strconv.Itoa(start)}, "Limit": {"250"}}
		var page struct {
			Items            []embyItem
			TotalRecordCount *int
		}
		if err := c.get(ctx, "Items", q, &page); err != nil {
			return err
		}
		if page.Items == nil || page.TotalRecordCount == nil || *page.TotalRecordCount < 0 {
			return errors.New(strings.ReplaceAll("Emby did not provide a complete page count", "Emby", c.label()))
		}
		total := *page.TotalRecordCount
		if expectedTotal < 0 {
			expectedTotal = total
		} else if total != expectedTotal {
			return errors.New(strings.ReplaceAll("Emby library changed during sync; sync again", "Emby", c.label()))
		}
		if len(page.Items) > 250 || start+len(page.Items) > total || (len(page.Items) == 0 && start < total) {
			return errors.New(strings.ReplaceAll("Incomplete Emby page", "Emby", c.label()))
		}
		for _, item := range page.Items {
			if item.Id == "" || seenItems[item.Id] {
				return errors.New(strings.ReplaceAll("Emby pages contain missing or duplicate IDs", "Emby", c.label()))
			}
			seenItems[item.Id] = true
			if item.Type != itemType {
				continue
			}
			sources := item.MediaSources
			// Item-level stream metadata belongs only to the exact item path, never another version.
			if len(sources) == 0 && item.Path != "" {
				sources = []embySource{{Path: item.Path, Size: item.Size, MediaStreams: item.MediaStreams}}
			}
			for _, source := range sources {
				if source.Size <= 0 && source.Path == item.Path {
					source.Size = item.Size
				}
				if source.IsRemote || source.Path == "" || source.Size <= 0 {
					continue
				}
				key := fileIdentity{pathBasename(source.Path), source.Size}
				position, ok := wanted[key]
				if !ok {
					continue
				}
				first := position - 1
				if position == 0 {
					first = duplicateWanted[key][0]
				}
				// A basename is a substring of the decoded full path. Reusing the
				// cached filename prevents map keys retaining the complete path.
				key.name = files[first].Filename
				if len(c.mappings) > 0 {
					matchesPath := false
					if position > 0 {
						matchesPath = mappedPathMatches(files[first].SourcePath, source.Path, c.mappings)
					} else {
						for _, index := range duplicateWanted[key] {
							matchesPath = matchesPath || mappedPathMatches(files[index].SourcePath, source.Path, c.mappings)
						}
					}
					if !matchesPath {
						continue
					}
				}
				if len(source.MediaStreams) == 0 && source.Path == item.Path {
					source.MediaStreams = item.MediaStreams
				}
				raw, err := json.Marshal(source.MediaStreams)
				if err != nil {
					return err
				}
				signature := sha256.Sum256(raw)
				pathHash := sha256.Sum256([]byte(strings.ReplaceAll(source.Path, "\\", "/")))
				if old, ok := matches[key]; ok {
					samePath := old.pathHash == pathHash
					if position > 0 {
						if matched := files[first].MediaServers.get(c.instance); matched != nil {
							if matched.Link != nil {
								nextLink := mediaLinkForItem(item, service)
								if nextLink == nil || *nextLink != *matched.Link {
									matched.Link = nil
								}
							}
							if matched.ItemID != item.Id || matched.SourceID != source.Id || matched.ItemType != item.Type || matched.ServerID != item.ServerId {
								matched.ItemID, matched.SourceID, matched.ItemType, matched.ServerID = "", "", "", ""
							}
						}
					}
					if old.ambiguous || !samePath || old.signature != signature {
						old.ambiguous = true
						matches[key] = old
					}
				} else {
					matches[key] = candidate{pathHash: pathHash, signature: signature}
					if position > 0 {
						// Retain normalized metadata once. A later duplicate can invalidate it;
						// pagination failures still discard the entire uncommitted snapshot.
						value := mediaMatchFromMetadata(parseEmbyMetadata(source.MediaStreams))
						// UI identity belongs to the uniquely matched file, not to its stream traits.
						value.Link = mediaLinkForItem(item, service)
						value.ItemID, value.SourceID, value.ItemType, value.ServerID = item.Id, source.Id, itemType, item.ServerId
						if value.SourceID == value.ItemID {
							value.SourceID = value.ItemID
						}
						value.Endpoint = c.endpoint
						files[first].setMediaMatch(c.instance, pool.intern(value))
					}
				}
			}
		}
		start += len(page.Items)
		if start == total {
			break
		}
		if err := ctx.Err(); err != nil {
			return err
		}
	}
	for key, position := range wanted {
		candidate, ok := matches[key]
		// Candidate fingerprints are no longer needed after duplicate validation.
		delete(matches, key)
		if position == 0 {
			for _, i := range duplicateWanted[key] {
				files[i].EmbyMatch = "ambiguous"
				files[i].setMediaMatch(c.instance, MediaMatch{Status: "ambiguous"})
			}
			continue
		}
		if ok && candidate.ambiguous {
			files[position-1].EmbyMatch = "ambiguous"
			files[position-1].setMediaMatch(c.instance, MediaMatch{Status: "ambiguous"})
			continue
		}
		if !ok {
			files[position-1].setMediaMatch(c.instance, MediaMatch{Status: "missing"})
		}
	}
	return nil
}

// Scope each pool to one provider snapshot. Shared values are immutable;
// bounded indexes avoid retaining an unbounded catalog of distinct traits.
type mediaPool struct {
	videos    map[MediaVideo]*MediaVideo
	tracks    map[[32]byte][]AudioTrack
	links     map[MediaLink]*MediaLink
	serverIDs map[string]string
}

func newMediaPool() *mediaPool {
	return &mediaPool{videos: map[MediaVideo]*MediaVideo{}, tracks: map[[32]byte][]AudioTrack{}, links: map[MediaLink]*MediaLink{}, serverIDs: map[string]string{}}
}
func (p *mediaPool) intern(value MediaMatch) MediaMatch {
	const maxEntries = 4096
	// Server identity repeats across the complete snapshot. Sharing it also in
	// UI links avoids retaining a decoded string for every individual episode.
	// Item/source IDs stay independent; only exact repeated server IDs intern.
	if value.ServerID != "" {
		if existing, ok := p.serverIDs[value.ServerID]; ok {
			value.ServerID = existing
		} else if len(p.serverIDs) < 64 {
			p.serverIDs[value.ServerID] = value.ServerID
		}
		if value.Link != nil && value.Link.ServerID == value.ServerID {
			value.Link.ServerID = value.ServerID
		}
	}
	if value.Link != nil {
		if existing, ok := p.links[*value.Link]; ok {
			value.Link = existing
		} else if len(p.links) < maxEntries {
			p.links[*value.Link] = value.Link
		}
	}
	if value.Video != nil {
		if existing, ok := p.videos[*value.Video]; ok {
			value.Video = existing
		} else if len(p.videos) < maxEntries {
			p.videos[*value.Video] = value.Video
		}
	}
	if len(value.Tracks) > 0 {
		raw, _ := json.Marshal(value.Tracks)
		key := sha256.Sum256(raw)
		if existing, ok := p.tracks[key]; ok && slices.Equal(existing, value.Tracks) {
			value.Tracks = existing
		} else if len(p.tracks) < maxEntries {
			p.tracks[key] = value.Tracks
		}
	}
	return value
}
func mediaMatchFromMetadata(metadata embyMetadata) MediaMatch {
	status := "matched"
	if metadata.ambiguous {
		return MediaMatch{Status: "ambiguous"}
	}
	if len(metadata.tracks) == 0 {
		status = "no_tracks"
	}
	return MediaMatch{Status: status, Tracks: metadata.tracks, HDR: metadata.hdr, Video: metadata.video}
}
func trackCodec(stream embyStream) string {
	codec := normAudio(stream.Codec)
	if strings.EqualFold(stream.Codec, "dts") {
		switch strings.ToLower(stream.Profile) {
		case "ma", "dts-hd ma", "dts-hd master audio":
			return "DTS-HD MA"
		case "hra", "dts-hd hra", "dts-hd high resolution audio":
			return "DTS-HD"
		}
	}
	return codec
}

// Retain only normalized traits; raw stream structs are much larger than tracks.
// A separate raw-data fingerprint still detects conflicting duplicate sources.
type embyMetadata struct {
	video                *MediaVideo
	tracks               []AudioTrack
	audio, language, hdr string
	ambiguous            bool
}

func joinEmbyTraits(set map[string]bool, separator string) string {
	values := []string{}
	for v := range set {
		values = append(values, v)
	}
	sort.Strings(values)
	return strings.Join(values, separator)
}
func parseEmbyMetadata(streams []embyStream) embyMetadata {
	tracks := []AudioTrack{}
	codecs, languages, hdr := map[string]bool{}, map[string]bool{}, map[string]bool{}
	indices := map[int]bool{}
	var videos []embyStream
	for _, stream := range streams {
		if strings.EqualFold(stream.Type, "Audio") && !stream.IsExternal {
			if indices[stream.Index] {
				return embyMetadata{ambiguous: true}
			}
			indices[stream.Index] = true
			language := stream.Language
			if language == "" {
				language = stream.DisplayLanguage
			}
			language = normLanguage(language)
			codec := trackCodec(stream)
			tracks = append(tracks, AudioTrack{Index: stream.Index, Language: language, Codec: codec, Channels: stream.Channels, ChannelLayout: stream.ChannelLayout, Title: stream.Title, Default: stream.IsDefault})
			if codec != "" {
				codecs[codec] = true
			}
			if language != "" {
				languages[language] = true
			}
		}
		if strings.EqualFold(stream.Type, "Video") && !stream.IsExternal {
			videos = append(videos, stream)

		}
	}
	sort.Slice(tracks, func(i, j int) bool { return tracks[i].Index < tracks[j].Index })
	var video *MediaVideo
	if len(videos) > 0 {
		selected := videos[0]
		if len(videos) > 1 {
			defaults := 0
			for _, stream := range videos {
				if stream.IsDefault {
					selected = stream
					defaults++
				}
			}
			if defaults != 1 {
				return embyMetadata{ambiguous: true}
			}
		}
		addVideoHDR(selected, hdr)
		value := MediaVideo{Width: selected.Width, Height: selected.Height, Resolution: mediaResolution(selected.Width, selected.Height, selected.IsInterlaced), Codec: mediaVideoCodec(selected)}
		if selected.BitDepth > 0 {
			value.BitDepth = strconv.Itoa(selected.BitDepth)
		}
		if value != (MediaVideo{}) {
			video = &value
		}
	}
	return embyMetadata{video: video, tracks: tracks, audio: joinEmbyTraits(codecs, " + "), language: joinEmbyTraits(languages, ", "), hdr: joinEmbyTraits(hdr, " + ")}
}
func addVideoHDR(stream embyStream, hdr map[string]bool) {
	switch strings.ToLower(stream.VideoRangeType) {
	case "hdr10":
		hdr["HDR10"] = true
	case "hdr10plus":
		hdr["HDR10+"] = true
	case "hlg":
		hdr["HLG"] = true
	case "dovi":
		hdr["Dolby Vision"] = true
	case "doviwithhdr10":
		hdr["Dolby Vision"] = true
		hdr["HDR10"] = true
	case "doviwithhdr10plus":
		hdr["Dolby Vision"] = true
		hdr["HDR10+"] = true
	case "doviwithhlg":
		hdr["Dolby Vision"] = true
		hdr["HLG"] = true
	}
	if stream.Hdr10PlusPresentFlag {
		hdr["HDR10+"] = true
	}
	switch strings.ToLower(stream.ExtendedVideoType) {
	case "hdr10":
		hdr["HDR10"] = true
	case "hdr10plus":
		hdr["HDR10+"] = true
	case "hyperloggamma":
		hdr["HLG"] = true
	case "dolbyvision":
		hdr["Dolby Vision"] = true
	}
	// Only explicit base-layer subtype values are used, not a guessed DV profile fallback.
	switch strings.ToLower(stream.ExtendedVideoSubType) {
	case "hdr10":
		hdr["HDR10"] = true
	case "hdr10plus0":
		hdr["HDR10+"] = true
	case "hyperloggamma":
		hdr["HLG"] = true
	}
}
func mediaVideoCodec(stream embyStream) string {
	if strings.EqualFold(stream.Codec, "mpeg4") {
		switch strings.ToLower(strings.TrimSpace(stream.CodecTag)) {
		case "xvid":
			return "XviD"
		case "divx", "dx50":
			return "DivX"
		}
	}
	return normCodec(stream.Codec)
}
func mediaChannels(tracks []AudioTrack) string {
	values := map[string]bool{}
	for _, track := range tracks {
		if value := mediaChannelLayout(track); value != "" {
			values[value] = true
		}
	}
	return joinEmbyTraits(values, " + ")
}

var mediaChannelLayoutRE = regexp.MustCompile(`^(\d\.\d)(\(.+\))?$`)

// Count-only measurements cannot establish a speaker/LFE layout disagreement.
func mediaChannelsCompatible(measured, filename string) bool {
	count := func(value string) int {
		if strings.HasSuffix(value, " ch") {
			n, _ := strconv.Atoi(strings.TrimSuffix(value, " ch"))
			return n
		}
		if mediaChannelLayoutRE.MatchString(value) {
			parts := strings.SplitN(value, ".", 2)
			main, _ := strconv.Atoi(parts[0])
			lfe, _ := strconv.Atoi(parts[1])
			return main + lfe
		}
		return 0
	}
	for _, expected := range strings.Split(filename, " + ") {
		found := false
		for _, actual := range strings.Split(measured, " + ") {
			if actual == expected || ((strings.HasSuffix(actual, " ch") || strings.HasSuffix(expected, " ch")) && count(actual) > 0 && count(actual) == count(expected)) {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	return true
}

func mediaChannelLayout(track AudioTrack) string {
	layout := strings.ToLower(strings.TrimSpace(track.ChannelLayout))
	switch layout {
	case "mono":
		return "1.0"
	case "stereo":
		return "2.0"
	case "quad":
		return "4.0"
	}
	// Do not turn a channel count into an assumed speaker/LFE layout.
	if parts := mediaChannelLayoutRE.FindStringSubmatch(layout); parts != nil {
		return parts[1]
	}
	if track.Channels > 0 {
		return strconv.Itoa(track.Channels) + " ch"
	}
	return ""
}

// Cropped widescreen/scope encodes keep their tier.
var mediaResolutionTiers = []struct{ minWidth, minHeight, lines int }{
	{7600, 4200, 4320},
	{3800, 2000, 2160},
	{2500, 1400, 1440},
	{1900, 1000, 1080},
	{1260, 700, 720},
}

// Classify the coded raster, including cropped widescreen releases. Missing
// dimensions remain unknown; a codec never implies an encoder or source.
func mediaResolution(width, height int, interlaced bool) string {
	if width <= 0 || height <= 0 {
		return ""
	}
	lines := height
	for _, tier := range mediaResolutionTiers {
		if width >= tier.minWidth || height >= tier.minHeight {
			lines = tier.lines
			break
		}
	}
	suffix := "p"
	if interlaced {
		suffix = "i"
	}
	return strconv.Itoa(lines) + suffix
}
func applyMediaVideo(f *File, video *MediaVideo) {
	if video == nil {
		return
	}
	if f.Evidence == nil {
		f.Evidence = map[string]Evidence{}
	}
	set := func(field, value, current string) string {
		if value == "" {
			return current
		}
		e := f.Evidence[field]
		e.Emby = value
		different := func(other string) bool {
			if field == "codec" {
				return other != "" && family(other) != family(value)
			}
			if field == "resolution" && isSDResolution(video.Resolution) && len(other) > 1 {
				// Cropped SD pixels cannot distinguish the original 480/576-line
				// raster. Preserve its explicit label without a false conflict.
				lines := other[:len(other)-1]
				if ((lines == "480" && video.Height < 480) || lines == "576") && other[len(other)-1] == value[len(value)-1] {
					return false
				}
			}
			return other != "" && other != value
		}
		e.Conflict = different(e.Filename)
		if current == "" || e.Origin == "api" {
			current = value
			e.Origin = "emby"
		}
		f.Evidence[field] = e
		return current
	}
	f.Resolution = set("resolution", video.Resolution, f.Resolution)
	f.Codec = set("codec", video.Codec, f.Codec)
	f.Family = family(f.Codec)
	f.BitDepth = set("bitDepth", video.BitDepth, f.BitDepth)
}
func applyEmby(f *File, streams []embyStream) {
	applyEmbyMetadata(f, parseEmbyMetadata(streams))
}
func applyEmbyMetadata(f *File, metadata embyMetadata) {
	if metadata.ambiguous {
		f.EmbyMatch = "ambiguous"
		return
	}
	applyMediaVideo(f, metadata.video)
	if channels := mediaChannels(metadata.tracks); channels != "" {
		if f.Evidence == nil {
			f.Evidence = map[string]Evidence{}
		}
		e := f.Evidence["channels"]
		e.Emby = channels
		e.Conflict = e.Filename != "" && !mediaChannelsCompatible(channels, e.Filename)
		if f.Channels == "" || e.Origin == "api" {
			f.Channels = channels
			e.Origin = "emby"
		}
		f.Evidence["channels"] = e
	}
	tracks := metadata.tracks
	if len(tracks) == 0 {
		f.EmbyMatch = "no_tracks"
	} else {
		f.EmbyMatch = "matched"
	}
	f.AudioTracks = tracks
	if len(tracks) > 0 {
		f.AudioStreamCount = len(tracks)
	}
	if f.Evidence == nil {
		f.Evidence = map[string]Evidence{}
	}
	set := func(field, value, separator, fallback string) string {
		evidence := f.Evidence[field]
		evidence.Emby = value
		if value == "" {
			f.Evidence[field] = evidence
			return fallback
		}
		evidence.Origin = "emby"
		evidence.Conflict = evidence.Filename != "" && value != "" && !containsAllTraits(value, evidence.Filename, separator)
		if field == "audio" {
			engine := f.comparisonEngine
			if engine == nil {
				engine = defaultRecognitionEngine
			}
			evidence.Conflict = evidence.Filename != "" && !engine.containsAudio(value, evidence.Filename, evidence.Rules)
		}
		f.Evidence[field] = evidence
		return value
	}
	// Verified per-track metadata is more precise than flattened API or filename audio traits.
	f.Audio = set("audio", metadata.audio, " + ", f.Audio)
	f.Language = set("language", metadata.language, ", ", f.Language)
	if metadata.hdr != "" {
		// Preserve explicit filename/API HDR alongside verified Emby profiles.
		e := f.Evidence["hdr"]
		e.Emby = metadata.hdr
		e.Origin = "combined"
		f.Evidence["hdr"] = e
		profiles := map[string]bool{}
		for _, profile := range strings.Split(f.HDR+" + "+metadata.hdr, " + ") {
			if profile != "" {
				profiles[profile] = true
			}
		}
		f.HDR = joinEmbyTraits(profiles, " + ")
	}
	engine := f.comparisonEngine
	if engine == nil {
		engine = defaultRecognitionEngine
	}
	markAPIDifferences(f, engine)
	f.Conflict = false
	for _, e := range f.Evidence {
		f.Conflict = f.Conflict || e.Conflict
	}
	updateCompleteness(f)
}

func audioTrackSummary(tracks []AudioTrack, locale ...string) string {
	labelLanguage := "en"
	if len(locale) > 0 {
		labelLanguage = locale[0]
	}
	values := []string{}
	for _, t := range tracks {
		language, codec := t.Language, t.Codec
		if language == "" {
			language = localizedMessage(labelLanguage, "Unknown")
		}
		if codec == "" {
			codec = localizedMessage(labelLanguage, "Unknown")
		}
		channel := ""
		if t.ChannelLayout != "" {
			channel = " · " + t.ChannelLayout
		} else if t.Channels > 0 {
			channel = " · " + strings.ReplaceAll(localizedMessage(labelLanguage, "{count} channels"), "{count}", strconv.Itoa(t.Channels))
		}
		values = append(values, fmt.Sprintf("#%d %s → %s%s", t.Index, language, codec, channel))
	}
	return strings.Join(values, " | ")
}

func mediaLinkForItem(item embyItem, service string) *MediaLink {
	id := item.Id
	if serviceKind(service) == "sonarr" {
		id = item.SeriesId
	}
	if !safeMediaID(id) || !safeMediaID(item.ServerId) {
		return nil
	}
	return &MediaLink{ItemID: id, ServerID: item.ServerId}
}
