package app

import (
	"errors"
	"fmt"
	"strings"
	"time"
)

type muxVerificationError struct{ message, detail string }

func (e *muxVerificationError) Error() string { return e.message }
func muxDuration(ns int64) string {
	s := ns / int64(time.Second)
	return fmt.Sprintf("%d:%02d:%02d", s/3600, s/60%60, s%60)
}
func muxTrackCounts(s MuxSource) string {
	counts := map[string]int{}
	for _, t := range s.Tracks {
		counts[t.Type]++
	}
	return fmt.Sprintf("video %d / audio %d / subtitles %d", counts["video"], counts["audio"], counts["subtitles"])
}
func verifyMux(source, output MuxSource, spec MuxSpec) error {
	if output.Size <= 0 || output.Container == "" {
		return errors.New("Output verification failed")
	}
	expected := source.DurationNS
	removed, known := false, true
	retained := int64(0)
	selected := MuxSource{}
	for _, t := range source.Tracks {
		if !spec.Tracks[t.ID].Keep {
			removed = true
			continue
		}
		selected.Tracks = append(selected.Tracks, t)
		if t.DurationNS <= 0 {
			known = false
		}
		retained = max(retained, t.DurationNS)
	}
	minimum := expected - int64(time.Second)
	if removed {
		if known && retained > 0 {
			minimum = retained - int64(time.Second)
		} else {
			minimum = expected - max(int64(time.Second), expected/50)
		}
	}
	if source.DurationNS > 0 && (output.DurationNS <= 0 || output.DurationNS < minimum || output.DurationNS > source.DurationNS+int64(time.Second)) {
		return &muxVerificationError{"Output duration differs from source", fmt.Sprintf("Output duration differs from source (source %s, output %s, allowed ≥ %s, ≤ %s)", muxDuration(source.DurationNS), muxDuration(output.DurationNS), muxDuration(max(0, minimum)), muxDuration(source.DurationNS+int64(time.Second)))}
	}
	if muxTrackCounts(selected) != muxTrackCounts(output) {
		return &muxVerificationError{"Output track count differs from selection", "Expected tracks " + muxTrackCounts(selected) + "; actual " + muxTrackCounts(output)}
	}
	return nil
}

func muxServiceName(service string) string {
	if strings.HasPrefix(service, "sonarr") {
		return "Sonarr"
	}
	return "Radarr"
}
