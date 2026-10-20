package app

import (
	"errors"
	"path/filepath"
	"regexp"
	"scopearr/internal/langdata"
	"strconv"
	"strings"
	"unicode"
	"unicode/utf8"
)

var muxLanguagePattern = regexp.MustCompile(`^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$`)

func muxLanguageValid(value string) bool {
	if len(value) > 63 || !muxLanguagePattern.MatchString(value) {
		return false
	}
	base := strings.Split(value, "-")[0]
	return strings.EqualFold(base, "und") || langdata.Canonical(base) != ""
}
func muxOutputName(name string) (string, error) {
	if strings.HasSuffix(strings.ToLower(name), ".mkv") {
		name = name[:len(name)-4]
	}
	if name == "" || len(name) > 200 || !utf8.ValidString(name) || strings.HasPrefix(name, ".") || strings.ContainsAny(name, "/\\") || strings.HasSuffix(strings.ToLower(name), ".partial") || strings.Contains(strings.ToLower(name), ".scopearr-backup") {
		return "", errors.New("Invalid output filename")
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return "", errors.New("Invalid output filename")
		}
	}
	return name, nil
}
func buildMuxArgs(src, tmp string, s MuxSource, spec MuxSpec) ([]string, error) {
	if !filepath.IsAbs(src) || !filepath.IsAbs(tmp) {
		return nil, errors.New("Absolute media paths are required")
	}
	if _, e := muxOutputName(spec.OutputName); e != nil {
		return nil, e
	}
	args := []string{"--ui-language", "en_US", "--gui-mode", "-o", tmp}
	kept := map[string][]string{}
	defaults := map[string]int{}
	video := false
	known := map[int]bool{}
	for _, t := range s.Tracks {
		known[t.ID] = true
		if t.Type == "video" {
			video = true
		}
		p, ok := spec.Tracks[t.ID]
		if !ok {
			return nil, errors.New("Track selection is incomplete")
		}
		if !p.Keep {
			continue
		}
		if t.Type != "video" && t.Type != "audio" && t.Type != "subtitles" {
			return nil, errors.New("Unsupported track type")
		}
		id := strconv.Itoa(t.ID)
		kept[t.Type] = append(kept[t.Type], id)
		if p.Default {
			defaults[t.Type]++
			if defaults[t.Type] > 1 {
				return nil, errors.New("Only one default track per type is allowed")
			}
		}
		if utf8.RuneCountInString(p.Name) > 256 || !utf8.ValidString(p.Name) {
			return nil, errors.New("Invalid track name")
		}
		for _, c := range p.Name {
			if unicode.IsControl(c) {
				return nil, errors.New("Invalid track name")
			}
		}
		if !muxLanguageValid(p.Language) {
			return nil, errors.New("Invalid track language")
		}
		if p.Language != t.Language {
			args = append(args, "--language", id+":"+p.Language)
		}
		if p.Name != t.Name {
			args = append(args, "--track-name", id+":"+p.Name)
		}
		flag := func(v bool) string {
			if v {
				return "1"
			}
			return "0"
		}
		if p.Default != t.Default {
			args = append(args, "--default-track-flag", id+":"+flag(p.Default))
		}
		if p.Forced != t.Forced {
			args = append(args, "--forced-display-flag", id+":"+flag(p.Forced))
		}
	}
	for id := range spec.Tracks {
		if !known[id] {
			return nil, errors.New("Unknown track")
		}
	}
	if len(kept) == 0 || video && len(kept["video"]) == 0 {
		return nil, errors.New("Keep at least one track and one video track when present")
	}
	for _, v := range []struct{ kind, yes, no string }{{"video", "--video-tracks", "--no-video"}, {"audio", "--audio-tracks", "--no-audio"}, {"subtitles", "--subtitle-tracks", "--no-subtitles"}} {
		if len(kept[v.kind]) == 0 {
			args = append(args, v.no)
		} else {
			args = append(args, v.yes, strings.Join(kept[v.kind], ","))
		}
	}
	if !spec.Chapters {
		args = append(args, "--no-chapters")
	}
	if !spec.Attachments {
		args = append(args, "--no-attachments")
	}
	return append(args, src), nil
}
