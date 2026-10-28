package app

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"
)

// SeedDemo is explicit opt-in, refuses an existing real admin installation.
func SeedDemo(s *Store) error {
	var marker bool
	s.Get("demo", &marker)
	sec, e := NewSecurity(s)
	if e != nil {
		return e
	}
	if sec.Initialized() && !marker {
		return fmt.Errorf("Demo mode requires a separate, empty data directory")
	}
	if !sec.Initialized() {
		if e = sec.Setup("demo", "Scopearr-demo-2026", sec.setupToken); e != nil {
			return e
		}
		s.Put("demo", true)
	}
	s.demo = true
	discs := os.Getenv("SCOPEARR_DEMO_DISCS") == "true"
	if discs {
		config := s.Recognition()
		found := false
		for _, r := range config.Rules {
			found = found || r.ID == "demo-uhd-source"
		}
		if !found {
			config.Rules = append(config.Rules, RecognitionRule{ID: "demo-uhd-source", Name: "Demo UHD source", Field: "source", Match: "token", Pattern: "UHD", Value: "UHD", Mode: "direct", Priority: 100, Enabled: true})
			if _, e = s.SaveRecognition(context.Background(), config.Rules, config.Revision); e != nil {
				return e
			}
		}
	}
	now := time.Now().UTC()
	names := []string{"Arrival", "Blade Runner 2049", "Dune", "Dune: Part Two", "Everything Everywhere All at Once", "Interstellar", "Oppenheimer", "The Batman", "The Grand Budapest Hotel", "The Lord of the Rings: The Fellowship of the Ring", "The Matrix", "The Secret Life of Walter Mitty", "Whiplash", "Alien", "Annihilation", "Ex Machina", "Her", "Inception", "Knives Out", "Mad Max: Fury Road", "Parasite", "Past Lives", "Poor Things", "The Shawshank Redemption"}
	years := []int{2016, 2017, 2021, 2024, 2022, 2014, 2023, 2022, 2014, 2001, 1999, 2013, 2014, 1979, 2018, 2014, 2013, 2010, 2019, 2015, 2019, 2023, 2023, 1994}
	files := []File{}
	for i, n := range names {
		resolution := []string{"1080p", "2160p", "1080p", "2160p", "1080p", "720p"}[i%6]
		codec := []string{"x264", "x265", "x264", "HEVC", "x265", "x264"}[i%6]
		source := []string{"BluRay", "BluRay.Remux", "WEB-DL", "WEB-DL", "WEBRip", "BluRay"}[i%6]
		if discs {
			source = demoDiscSource(resolution)
			if i == 1 {
				source += ".Remux"
			}
		}
		hdr := ""
		if resolution == "2160p" {
			hdr = ".HDR10.10bit"
			if i == 1 {
				hdr = ".DV.HDR10.10bit"
			}
		}
		f := File{ID: i + 1, Service: "radarr", MediaID: i + 1, Title: n, Years: []int{years[i]}, Episodes: []Episode{}, Filename: fmt.Sprintf("%s.%d.%s.%s.%s%s.DTS.5.1.mkv", n, years[i], resolution, source, codec, hdr), Size: int64(3+i%10) * 1024 * 1024 * 1024}
		audioLanguages, streamCount := "English", 0
		if i == 0 || i == 1 {
			audioLanguages, streamCount = "German / English", 2
			f.Filename = f.Filename[:len(f.Filename)-4] + ".AC3.German.English.mkv"
		}
		Enrich(&f, APIInfo{AudioStreamCount: streamCount, Quality: source + "-" + resolution, VideoCodec: family(codec), AudioCodec: "DTS", AudioChannels: 5.1, AudioLanguages: audioLanguages})
		if i == 0 || i == 1 {
			streams := []embyStream{{Type: "Audio", Index: 1, Codec: "dts", Language: "ger", Channels: 6, ChannelLayout: "5.1", IsDefault: true}, {Type: "Audio", Index: 2, Codec: "ac3", Language: "eng", Channels: 6, ChannelLayout: "5.1"}}
			if i == 1 {
				streams = append(streams, embyStream{Type: "Video", Index: 0, ExtendedVideoType: "DolbyVision", ExtendedVideoSubType: "Hdr10"})
			}
			applyEmby(&f, streams)
		}
		files = append(files, f)
	}
	f := File{ID: 100, Service: "radarr", MediaID: 100, Title: "Tenet", Years: []int{2020}, Episodes: []Episode{}, Filename: "Tenet.2020.1080p.WEB-DL.x264.mkv", Size: 9 << 30}
	if discs {
		f.Filename = "Tenet.2020.1080p.BluRay.x264.mkv"
	}
	Enrich(&f, APIInfo{Quality: "Bluray-2160p", VideoCodec: "HEVC"})
	files = append(files, f)
	f = File{ID: 101, Service: "radarr", MediaID: 101, Title: "Perfect Days", Years: []int{2023}, Episodes: []Episode{}, Filename: "Perfect.Days.2023.mkv", Size: 4 << 30}
	if discs {
		f.Filename = strings.ReplaceAll(f.Filename, "WEBRip", "DVD")
		f.Filename = strings.ReplaceAll(f.Filename, "WEB-DL", "BluRay")
	}
	Enrich(&f, APIInfo{})
	files = append(files, f)
	if e = s.Replace("radarr", files, SyncStatus{LastAttempt: &now, LastSuccess: &now, Count: len(files)}); e != nil {
		return e
	}
	shows := []string{"Breaking Bad", "Severance", "The Bear", "Dark", "Better Call Saul"}
	files = []File{}
	id := 0
	for j, show := range shows {
		for season := 1; season <= 2; season++ {
			for ep := 1; ep <= 12; ep++ {
				id++
				r, c, src := "1080p", "x264", "WEB-DL"
				if ep%3 == 0 {
					r, c = "2160p", "x265"
				}
				if ep%4 == 0 {
					src = "BluRay"
				}
				if discs {
					src = demoDiscSource(r)
				}
				f := File{ID: id, Service: "sonarr", MediaID: j + 1, Series: show, Season: season, Title: fmt.Sprintf("E%02d · Episode %d", ep, ep), Episodes: []Episode{{ID: id, Number: ep, Title: fmt.Sprintf("Episode %d", ep), Year: 2010 + j + season}}, Years: []int{2010 + j + season}, Filename: fmt.Sprintf("%s.S%02dE%02d.%s.%s.%s.mkv", show, season, ep, r, src, c), Size: int64(1+ep%3) << 30}
				Enrich(&f, APIInfo{Quality: src + "-" + r, VideoCodec: family(c), AudioCodec: "E-AC-3", AudioChannels: 5.1, AudioLanguages: "English"})
				files = append(files, f)
			}
		}
	}
	f = File{ID: 1000, Service: "sonarr", MediaID: 1, Series: "Breaking Bad", Season: 0, Title: "E01 · Behind the scenes", Episodes: []Episode{{ID: 1000, Number: 1, Title: "Behind the scenes", Year: 2010}}, Years: []int{2010}, Filename: "Breaking.Bad.S00E01.720p.WEBRip.x264.mkv", Size: 1 << 30}
	if discs {
		f.Filename = strings.ReplaceAll(f.Filename, "WEBRip", "DVD")
		f.Filename = strings.ReplaceAll(f.Filename, "WEB-DL", "BluRay")
	}
	Enrich(&f, APIInfo{})
	files = append(files, f)
	f = File{ID: 1001, Service: "sonarr", MediaID: 1, Series: "Breaking Bad", Season: 3, Title: "E01 · One / E02 · Two", Episodes: []Episode{{ID: 1001, Number: 1, Title: "One", Year: 2011}, {ID: 1002, Number: 2, Title: "Two", Year: 2012}}, Years: []int{2011, 2012}, Filename: "Breaking.Bad.S03E01E02.1080p.WEB-DL.x264.mkv", Size: 2 << 30}
	if discs {
		f.Filename = strings.ReplaceAll(f.Filename, "WEBRip", "DVD")
		f.Filename = strings.ReplaceAll(f.Filename, "WEB-DL", "BluRay")
	}
	Enrich(&f, APIInfo{})
	files = append(files, f)
	return s.Replace("sonarr", files, SyncStatus{LastAttempt: &now, LastSuccess: &now, Count: len(files)})
}

func demoDiscSource(resolution string) string {
	switch resolution {
	case "2160p":
		return "UHD"
	case "720p":
		return "DVD"
	default:
		return "BluRay"
	}
}
