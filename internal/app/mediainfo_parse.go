package app

import (
	"encoding/json"
	"errors"
	"path"
	"scopearr/internal/langdata"
	"strconv"
	"strings"
	"unicode/utf8"
)

const mediaInfoOutputLimit = 4 << 20
const mediaInfoResultLimit = 64 << 10

type mediaInfoTrack struct {
	Type   string            `json:"type"`
	Fields map[string]string `json:"fields"`
}

type mediaInfoResult struct {
	Video       *MediaVideo      `json:"video,omitempty"`
	AudioTracks []AudioTrack     `json:"audioTracks,omitempty"`
	Audio       string           `json:"audio,omitempty"`
	Language    string           `json:"language,omitempty"`
	HDR         string           `json:"hdr,omitempty"`
	Ambiguous   bool             `json:"ambiguous,omitempty"`
	Tracks      []mediaInfoTrack `json:"tracks,omitempty"`
}

func (r mediaInfoResult) metadata() embyMetadata {
	return embyMetadata{video: r.Video, tracks: r.AudioTracks, audio: r.Audio, language: r.Language, hdr: r.HDR, ambiguous: r.Ambiguous}
}

// Only explicitly approved display fields are persisted. CompleteName, @ref,
// source paths, arbitrary tags and the original JSON never enter the result.
var mediaInfoDisplayFields = []string{"FileName", "FileExtension", "Format", "Format_Version", "Format_Profile", "Format_Level", "Format_Commercial_IfAny", "Format_AdditionalFeatures", "CodecID", "Duration", "FileSize", "BitRate", "Width", "Height", "FrameRate", "ScanType", "BitDepth", "HDR_Format", "HDR_Format_Compatibility", "transfer_characteristics", "Channels", "ChannelLayout", "SamplingRate", "Language", "Default", "Forced", "Encoded_Library_Name"}

func mediaInfoText(track map[string]json.RawMessage, key string) string {
	raw := track[key]
	var s string
	if json.Unmarshal(raw, &s) != nil {
		var n json.Number
		if json.Unmarshal(raw, &n) != nil {
			return ""
		}
		s = n.String()
	}
	s = strings.TrimSpace(s)
	if len(s) > 512 {
		s = s[:512]
		for !utf8.ValidString(s) {
			s = s[:len(s)-1]
		}
	}
	return s
}
func mediaInfoInt(track map[string]json.RawMessage, key string) int {
	v, e := strconv.Atoi(mediaInfoText(track, key))
	if e != nil || v < 0 || v > 1000000 {
		return 0
	}
	return v
}

func parseMediaInfo(raw []byte) (mediaInfoResult, error) {
	var result mediaInfoResult
	if len(raw) == 0 || len(raw) > mediaInfoOutputLimit {
		return result, errors.New("Invalid or oversized MediaInfo output")
	}
	var doc struct {
		Media struct {
			Track []map[string]json.RawMessage `json:"track"`
		} `json:"media"`
	}
	if json.Unmarshal(raw, &doc) != nil || len(doc.Media.Track) == 0 || len(doc.Media.Track) > 256 {
		return result, errors.New("Invalid MediaInfo output")
	}
	var videos []map[string]json.RawMessage
	audioSet, languageSet := map[string]bool{}, map[string]bool{}
	for index, track := range doc.Media.Track {
		kind := mediaInfoText(track, "@type")
		if kind != "General" && kind != "Video" && kind != "Audio" && kind != "Text" {
			continue
		}
		display := mediaInfoTrack{Type: kind, Fields: map[string]string{}}
		for _, key := range mediaInfoDisplayFields {
			if value := mediaInfoText(track, key); value != "" {
				if key == "FileName" {
					value = path.Base(strings.ReplaceAll(value, "\\", "/"))
				}
				// Omit values containing directory separators; raw metadata can contain
				// embedded paths even in otherwise ordinary display fields.
				if mediaInfoContainsPath(value) {
					continue
				}
				display.Fields[key] = value
			}
		}
		result.Tracks = append(result.Tracks, display)
		switch kind {
		case "Video":
			videos = append(videos, track)
		case "Audio":
			codec := mediaInfoAudioCodec(track)
			channels := mediaInfoInt(track, "Channels")
			layout := mediaInfoText(track, "ChannelLayout")
			normalizedLayout := ""
			if strings.Contains(strings.ToUpper(layout), "LFE") && channels > 1 {
				normalizedLayout = strconv.Itoa(channels-1) + ".1"
			} else if channels == 2 && (layout == "L R" || strings.EqualFold(layout, "stereo")) {
				normalizedLayout = "2.0"
			} else if channels == 1 && (layout == "C" || strings.EqualFold(layout, "mono")) {
				normalizedLayout = "1.0"
			}
			language := normLanguage(langdata.Canonical(mediaInfoText(track, "Language")))
			result.AudioTracks = append(result.AudioTracks, AudioTrack{Index: index, Codec: codec, Language: language, Channels: channels, ChannelLayout: normalizedLayout, Default: strings.EqualFold(mediaInfoText(track, "Default"), "Yes")})
			if codec != "" {
				audioSet[codec] = true
			}
			if language != "" {
				languageSet[language] = true
			}
		}
	}
	if len(videos) > 0 {
		selected := videos[0]
		if len(videos) > 1 {
			defaults := 0
			for _, v := range videos {
				if strings.EqualFold(mediaInfoText(v, "Default"), "Yes") {
					selected = v
					defaults++
				}
			}
			result.Ambiguous = defaults != 1
		}
		if !result.Ambiguous {
			width, height := mediaInfoInt(selected, "Width"), mediaInfoInt(selected, "Height")
			if width == 0 || height == 0 {
				return mediaInfoResult{}, errors.New("Invalid MediaInfo video dimensions")
			}
			scan := strings.ToLower(mediaInfoText(selected, "ScanType"))
			video := &MediaVideo{Width: width, Height: height, Resolution: mediaResolution(width, height, scan == "interlaced" || scan == "mbaff" || scan == "paff"), Codec: mediaInfoVideoCodec(selected)}
			if depth := mediaInfoText(selected, "BitDepth"); depth == "8" || depth == "10" || depth == "12" {
				video.BitDepth = depth
			}
			result.Video = video
			result.HDR = mediaInfoHDR(selected)
		}
	}
	if result.Ambiguous {
		result.AudioTracks = nil
	} else {
		result.Audio = joinEmbyTraits(audioSet, " + ")
		result.Language = joinEmbyTraits(languageSet, ", ")
	}
	if len(result.Tracks) == 0 {
		return mediaInfoResult{}, errors.New("MediaInfo output has no usable tracks")
	}
	saved, e := json.Marshal(result)
	if e != nil || len(saved) > mediaInfoResultLimit {
		return mediaInfoResult{}, errors.New("Normalized MediaInfo result exceeds limit")
	}
	return result, nil
}

func mediaInfoVideoCodec(t map[string]json.RawMessage) string {
	format := strings.ToLower(mediaInfoText(t, "Format"))
	library := strings.ToLower(mediaInfoText(t, "Encoded_Library_Name"))
	switch format {
	case "avc":
		if library == "x264" {
			return "x264"
		}
		return "AVC"
	case "hevc":
		if library == "x265" {
			return "x265"
		}
		return "HEVC"
	case "av1":
		return "AV1"
	case "vc-1":
		return "VC-1"
	case "mpeg video":
		if strings.Contains(mediaInfoText(t, "Format_Version"), "2") {
			return "MPEG-2"
		}
	case "mpeg-4 visual":
		switch strings.ToUpper(mediaInfoText(t, "CodecID")) {
		case "XVID":
			return "XviD"
		case "DX50", "DIVX":
			return "DivX"
		}
	}
	return ""
}
func mediaInfoAudioCodec(t map[string]json.RawMessage) string {
	format := strings.ToUpper(mediaInfoText(t, "Format"))
	extra := strings.ToUpper(mediaInfoText(t, "Format_AdditionalFeatures") + " " + mediaInfoText(t, "Format_Commercial_IfAny"))
	switch format {
	case "DTS":
		if strings.Contains(extra, "XLL") || strings.Contains(extra, "MASTER AUDIO") {
			return "DTS-HD MA"
		}
		if strings.Contains(extra, "XBR") || strings.Contains(extra, "HIGH RESOLUTION") {
			return "DTS-HD"
		}
		return "DTS"
	case "MLP FBA", "TRUEHD":
		return "TrueHD"
	case "E-AC-3", "E-AC-3 JOC":
		return "E-AC-3"
	case "AC-3", "AAC", "FLAC", "OPUS", "PCM", "LPCM", "MP3", "ALAC":
		return normAudio(format)
	case "MPEG AUDIO":
		if strings.Contains(mediaInfoText(t, "Format_Profile"), "Layer 3") {
			return "MP3"
		}
	}
	return ""
}
func mediaInfoHDR(t map[string]json.RawMessage) string {
	format := strings.ToLower(mediaInfoText(t, "HDR_Format"))
	compatibility := strings.ToLower(mediaInfoText(t, "HDR_Format_Compatibility"))
	transfer := strings.ToLower(mediaInfoText(t, "transfer_characteristics"))
	hdr := map[string]bool{}
	if strings.Contains(format, "dolby vision") {
		hdr["Dolby Vision"] = true
	}
	if strings.Contains(format, "2094") || strings.Contains(format, "hdr10+") || strings.Contains(compatibility, "hdr10+") {
		hdr["HDR10+"] = true
	}
	if strings.Contains(format, "2086") || strings.Contains(strings.ReplaceAll(compatibility, "hdr10+", ""), "hdr10") || strings.Contains(strings.ReplaceAll(format, "hdr10+", ""), "hdr10") {
		hdr["HDR10"] = true
	}
	if strings.Contains(transfer, "hlg") || strings.Contains(transfer, "arib std-b67") {
		hdr["HLG"] = true
	}
	if len(hdr) == 0 && (strings.Contains(transfer, "2084") || transfer == "pq") {
		hdr["HDR"] = true
	}
	return joinEmbyTraits(hdr, " + ")
}

func mediaInfoContainsPath(value string) bool {
	if strings.Contains(value, "\\") || strings.Contains(value, ":/") {
		return true
	}
	for _, word := range strings.Fields(value) {
		if len(word) > 1 && strings.HasPrefix(word, "/") {
			return true
		}
	}
	return false
}
