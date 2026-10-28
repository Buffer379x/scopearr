package app

import (
	"bytes"
	"compress/gzip"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

type staticRepresentation struct {
	raw, gzip                   []byte
	etag, gzipETag, contentType string
}

// Embedded files have no modification time; fingerprints describe each exact
// representation, and index revalidation discovers new hashed assets on updates.
func staticHandler(files fs.FS) http.Handler {
	index := map[string]staticRepresentation{}
	if files != nil {
		_ = fs.WalkDir(files, ".", func(name string, entry fs.DirEntry, err error) error {
			if err != nil || entry.IsDir() {
				return nil
			}
			raw, e := fs.ReadFile(files, name)
			if e != nil {
				return nil
			}
			v := staticRepresentation{raw: raw, etag: fmt.Sprintf(`"%x"`, sha256.Sum256(raw)), contentType: mime.TypeByExtension(path.Ext(name))}
			if v.contentType == "" {
				v.contentType = http.DetectContentType(raw)
			}
			switch path.Ext(name) {
			case ".js", ".css", ".html", ".json", ".svg", ".txt", ".ico":
				var b bytes.Buffer
				z, _ := gzip.NewWriterLevel(&b, 6)
				_, _ = z.Write(raw)
				_ = z.Close()
				if b.Len() < len(raw) {
					v.gzip = b.Bytes()
					v.gzipETag = fmt.Sprintf(`"%x-gzip"`, sha256.Sum256(v.gzip))
				}
			}
			index[name] = v
			return nil
		})
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if r.URL.Path == "/index.html" {
			w.Header().Set("Location", "./")
			w.WriteHeader(http.StatusMovedPermanently)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		v, ok := index[name]
		if !ok {
			http.NotFound(w, r)
			return
		}
		switch {
		case name == "index.html":
			w.Header().Set("Cache-Control", "no-cache")
		case strings.HasPrefix(name, "assets/"):
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		default:
			w.Header().Set("Cache-Control", "public, max-age=86400")
		}
		raw, etag := v.raw, v.etag
		if v.gzip != nil {
			w.Header().Set("Vary", "Accept-Encoding")
			if acceptsGzip(r.Header.Get("Accept-Encoding")) {
				raw, etag = v.gzip, v.gzipETag
				w.Header().Set("Content-Encoding", "gzip")
			}
		}
		w.Header().Set("ETag", etag)
		w.Header().Set("Content-Type", v.contentType)
		http.ServeContent(w, r, name, time.Time{}, bytes.NewReader(raw))
	})
}

func acceptsGzip(header string) bool {
	wildcard := false
	for _, entry := range strings.Split(header, ",") {
		parts := strings.Split(entry, ";")
		coding := strings.TrimSpace(parts[0])
		q := 1.0
		for _, parameter := range parts[1:] {
			key, value, ok := strings.Cut(strings.TrimSpace(parameter), "=")
			if strings.EqualFold(key, "q") {
				var err error
				q, err = strconv.ParseFloat(value, 64)
				if !ok || err != nil || q < 0 || q > 1 {
					q = 0
				}
			}
		}
		if strings.EqualFold(coding, "gzip") {
			return q > 0
		}
		if coding == "*" {
			wildcard = q > 0
		}
	}
	return wildcard
}
