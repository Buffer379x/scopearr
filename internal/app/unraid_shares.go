package app

import (
	"bufio"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type shareCachePolicy struct {
	UseCache      string `json:"useCache"`
	Pool          string `json:"pool,omitempty"`
	SecondaryPool string `json:"secondaryPool,omitempty"`
}
type shareCacheSettings map[string]shareCachePolicy

func readShareCache(u UnraidSettings) shareCacheSettings {
	if u.StateDir == "" {
		return nil
	}
	f, e := os.Open(filepath.Join(u.StateDir, "shares.ini"))
	if e != nil {
		return nil
	}
	defer f.Close()
	data, e := io.ReadAll(io.LimitReader(f, 1024*1024+1))
	if e != nil || len(data) > 1024*1024 {
		return nil
	}
	return parseShareCache(data)
}
func parseShareCache(data []byte) shareCacheSettings {
	out := shareCacheSettings{}
	name := ""
	scan := bufio.NewScanner(bytes.NewReader(data))
	scan.Buffer(make([]byte, 4096), 1024*1024)
	for scan.Scan() {
		line := strings.TrimSpace(scan.Text())
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") {
			continue
		}
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			name = strings.Trim(strings.TrimSpace(line[1:len(line)-1]), `"'`)
			continue
		}
		k, v, ok := strings.Cut(line, "=")
		if !ok || name == "" {
			continue
		}
		k = strings.TrimSpace(k)
		v = strings.Trim(strings.TrimSpace(v), `"'`)
		p := out[name]
		switch k {
		case "shareUseCache":
			switch strings.ToLower(v) {
			case "yes", "prefer", "only", "no":
				p.UseCache = strings.ToLower(v)
			default:
				p.UseCache = "unknown"
			}
		case "shareCachePool":
			p.Pool = v
		case "shareCachePool2":
			p.SecondaryPool = v
		default:
			continue
		}
		out[name] = p
	}
	if scan.Err() != nil {
		return nil
	}
	return out
}
func (s shareCacheSettings) policy(rel string) shareCachePolicy {
	share, _, _ := strings.Cut(rel, "/")
	p := s[share]
	if p.UseCache == "" {
		p.UseCache = "unknown"
	}
	return p
}

const shareCacheUnknown = "Share cache settings unknown; pool files are treated like files on any disk."
