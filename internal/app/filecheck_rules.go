package app

import (
	"path"
	"path/filepath"
	"strings"
)

var fileCheckSubtitles = map[string]bool{".srt": true, ".ass": true, ".ssa": true, ".sub": true, ".idx": true, ".sup": true, ".vtt": true, ".smi": true}
var fileCheckImages = map[string]bool{".jpg": true, ".jpeg": true, ".png": true, ".webp": true, ".tbn": true, ".gif": true}
var fileCheckMetadata = map[string]bool{".nfo": true, ".xml": true, ".bif": true}

var fileCheckJunkFiles = map[string]bool{"thumbs.db": true, "desktop.ini": true, ".ds_store": true}
var fileCheckJunkDirs = map[string]bool{"@eadir": true, ".appledouble": true, ".@__thumb": true, "__macosx": true}

// Extras follow the Plex/Emby/Jellyfin conventions and are never orphaned or untracked.
var fileCheckExtrasDirs = map[string]bool{"extras": true, "featurettes": true, "behind the scenes": true, "deleted scenes": true, "interviews": true, "scenes": true, "shorts": true, "trailers": true, "other": true}
var fileCheckExtrasSuffixes = []string{"-trailer", "-featurette", "-behindthescenes", "-deleted", "-interview", "-scene", "-short", "-other"}

func fileCheckSidecar(ext string) bool {
	return fileCheckSubtitles[ext] || fileCheckImages[ext] || fileCheckMetadata[ext]
}

func fileCheckJunk(name string, dir bool) bool {
	lower := strings.ToLower(name)
	if dir {
		return fileCheckJunkDirs[lower]
	}
	return fileCheckJunkFiles[lower] || strings.HasPrefix(name, "._")
}

func fileCheckExtra(name string) bool {
	stem := strings.ToLower(strings.TrimSuffix(name, filepath.Ext(name)))
	for _, suffix := range fileCheckExtrasSuffixes {
		if strings.HasSuffix(stem, suffix) {
			return true
		}
	}
	return false
}

// Patterns ending in "/" match folders only; others match files and folders by name.
func fileCheckMatches(patterns []string, name string, dir bool) bool {
	lower := strings.ToLower(name)
	for _, pattern := range patterns {
		folder := strings.HasSuffix(pattern, "/")
		if folder && !dir {
			continue
		}
		if ok, _ := path.Match(strings.ToLower(strings.TrimSuffix(pattern, "/")), lower); ok {
			return true
		}
	}
	return false
}

// A companion matches when its name starts with a video stem followed by an end,
// ".", "-", "_" or space: "Film (2020).de.forced.srt", "Film (2020)-poster.jpg".
func fileCheckMatchesStem(name string, stems []string) bool {
	for _, stem := range stems {
		if !strings.HasPrefix(name, stem) {
			continue
		}
		rest := name[len(stem):]
		if rest == "" || strings.ContainsRune(".-_ ", rune(rest[0])) {
			return true
		}
	}
	return false
}

func fileCheckVideoStem(name string) string {
	return strings.TrimSuffix(name, filepath.Ext(name))
}
