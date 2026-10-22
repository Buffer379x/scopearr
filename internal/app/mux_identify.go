package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"time"
)

const muxIdentifySourceTimeout = 2 * time.Minute
const muxIdentifyOutputTimeout = 5 * time.Minute

type muxOutputCheckKey struct{}

var muxTrackDuration = regexp.MustCompile(`^(\d+):([0-5]\d):([0-5]\d(?:\.\d{1,9})?)$`)

func parseMuxDuration(value string) int64 {
	parts := muxTrackDuration.FindStringSubmatch(value)
	if parts == nil {
		return 0
	}
	d, e := time.ParseDuration(parts[1] + "h" + parts[2] + "m" + parts[3] + "s")
	if e != nil || d <= 0 {
		return 0
	}
	return int64(d)
}

type MuxTrack struct {
	DurationNS int64  `json:"durationNs,omitempty"`
	ID         int    `json:"id"`
	Type       string `json:"type"`
	Codec      string `json:"codec"`
	Language   string `json:"language"`
	Name       string `json:"name"`
	Default    bool   `json:"default"`
	Forced     bool   `json:"forced"`
	Channels   int    `json:"channels,omitempty"`
	Dimensions string `json:"dimensions,omitempty"`
	Enabled    bool   `json:"enabled"`
}
type MuxSource struct {
	OutputDisk  string     `json:"outputDisk,omitempty"`
	DiskPath    string     `json:"diskPath,omitempty"`
	DiskRoot    string     `json:"diskRoot,omitempty"`
	SharePath   string     `json:"sharePath,omitempty"`
	Container   string     `json:"container"`
	DurationNS  int64      `json:"durationNs"`
	Tracks      []MuxTrack `json:"tracks"`
	Chapters    int        `json:"chapters"`
	Attachments int        `json:"attachments"`
	Size        int64      `json:"size"`
	ModTime     time.Time  `json:"modTime"`
}
type MuxTrackSpec struct {
	Keep     bool   `json:"keep"`
	Language string `json:"language"`
	Name     string `json:"name"`
	Default  bool   `json:"default"`
	Forced   bool   `json:"forced"`
}
type MuxSpec struct {
	OutputName     string               `json:"outputName"`
	DeleteOriginal bool                 `json:"deleteOriginal"`
	Tracks         map[int]MuxTrackSpec `json:"tracks"`
	Chapters       bool                 `json:"chapters"`
	Attachments    bool                 `json:"attachments"`
}
type muxRunner interface {
	Identify(context.Context, string) (MuxSource, error)
	Mux(context.Context, []string, func(int)) ([]string, error)
	Version(context.Context) (string, error)
}

func parseMuxSource(b []byte) (MuxSource, error) {
	var d struct {
		Container struct {
			Type       string `json:"type"`
			Recognized bool   `json:"recognized"`
			Properties struct {
				Duration int64 `json:"duration"`
			} `json:"properties"`
		} `json:"container"`
		Tracks []struct {
			ID         int    `json:"id"`
			Type       string `json:"type"`
			Codec      string `json:"codec"`
			Properties struct {
				Duration   string `json:"tag_duration"`
				Language   string `json:"language"`
				IETF       string `json:"language_ietf"`
				Name       string `json:"track_name"`
				Default    bool   `json:"default_track"`
				Forced     bool   `json:"forced_track"`
				Enabled    bool   `json:"enabled_track"`
				Channels   int    `json:"audio_channels"`
				Dimensions string `json:"pixel_dimensions"`
			} `json:"properties"`
		} `json:"tracks"`
		Chapters []struct {
			Count int `json:"num_entries"`
		} `json:"chapters"`
		Attachments []json.RawMessage `json:"attachments"`
		Errors      []string          `json:"errors"`
	}
	if json.Unmarshal(b, &d) != nil || !d.Container.Recognized || len(d.Errors) > 0 {
		return MuxSource{}, errors.New("Unsupported or unreadable media file")
	}
	s := MuxSource{Container: d.Container.Type, DurationNS: d.Container.Properties.Duration, Tracks: []MuxTrack{}, Attachments: len(d.Attachments)}
	for _, c := range d.Chapters {
		s.Chapters += c.Count
	}
	for _, t := range d.Tracks {
		p := t.Properties
		lang := p.IETF
		if lang == "" {
			lang = p.Language
		}
		s.Tracks = append(s.Tracks, MuxTrack{ID: t.ID, Type: t.Type, Codec: t.Codec, Language: lang, Name: p.Name, Default: p.Default, Forced: p.Forced, Channels: p.Channels, Dimensions: p.Dimensions, Enabled: p.Enabled, DurationNS: parseMuxDuration(p.Duration)})
	}
	return s, nil
}
func (r *toolRunner) Identify(ctx context.Context, path string) (MuxSource, error) {
	timeout := muxIdentifySourceTimeout
	if output, _ := ctx.Value(muxOutputCheckKey{}).(bool); output {
		timeout = muxIdentifyOutputTimeout
	}
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	b, e := r.output(ctx, 8<<20, "--ui-language", "en_US", "-J", path)
	if e != nil {
		if output, _ := ctx.Value(muxOutputCheckKey{}).(bool); output && errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return MuxSource{}, errors.New("Output check timed out")
		}
		return MuxSource{}, errors.New("Media identification failed")
	}
	s, e := parseMuxSource(b)
	if e != nil {
		return s, e
	}
	info, e := os.Stat(path)
	if e != nil {
		return s, errors.New("Media file is not reachable")
	}
	s.Size = info.Size()
	s.ModTime = info.ModTime()
	return s, nil
}

func (m *MuxManager) identifyOutput(ctx context.Context, runner muxRunner, path string) (MuxSource, error) {
	timeout := muxIdentifyOutputTimeout
	if m.testOutputTimeout > 0 {
		timeout = m.testOutputTimeout
	}
	outputCtx, cancel := context.WithTimeout(context.WithValue(ctx, muxOutputCheckKey{}, true), timeout)
	defer cancel()
	output, e := runner.Identify(outputCtx, path)
	if errors.Is(outputCtx.Err(), context.DeadlineExceeded) {
		return MuxSource{}, errors.New("Output check timed out")
	}
	return output, e
}
