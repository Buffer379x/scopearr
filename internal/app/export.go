package app

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func safeCell(s string) string {
	v := strings.TrimLeft(s, " \t\r\n")
	if strings.HasPrefix(v, "=") || strings.HasPrefix(v, "+") || strings.HasPrefix(v, "-") || strings.HasPrefix(v, "@") {
		return "'" + s
	}
	return s
}
func (s *Server) export(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	q.Set("_infoMask", strconv.Itoa(infoMask(s.Config())))
	q.Set("_pageSize", strconv.Itoa(s.Config().PageSize))
	filter, args, e := where(q)
	if e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	order, e := displayOrder(q)
	if e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	rows, e := s.Store.DB.QueryContext(r.Context(), "SELECT "+fileDataSQL+","+customJSON+" FROM files f WHERE "+filter+" ORDER BY "+order, args...)
	if e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	defer rows.Close()
	temporary, e := os.CreateTemp(s.Store.Dir, ".export-*.csv")
	if e != nil {
		failure(w, r, http.StatusInternalServerError, errors.New("Could not prepare export"))
		return
	}
	defer func() { temporary.Close(); os.Remove(temporary.Name()) }()
	if e = s.writeCSV(r.Context(), temporary, rows, requestLocale(r)); e != nil {
		failure(w, r, http.StatusInternalServerError, errors.New("Could not complete export"))
		return
	}
	if _, e = temporary.Seek(0, 0); e != nil {
		failure(w, r, http.StatusInternalServerError, errors.New("Could not read export"))
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="scopearr-`+r.URL.Query().Get("service")+`-`+time.Now().Format("2006-01-02")+`.csv"`)
	if _, e = io.Copy(w, temporary); e != nil {
		return
	}
}

func (s *Server) writeCSV(ctx context.Context, destination io.Writer, rows *sql.Rows, locale ...string) error {
	if _, e := destination.Write([]byte("\xef\xbb\xbf")); e != nil {
		return e
	}
	cw := csv.NewWriter(destination)
	cw.Comma = ';'
	instanceNames := map[string]string{}
	for _, connection := range s.Config().AllInstances() {
		instanceNames[connection.ID] = instanceLabel(connection)
	}
	headers := []string{"Title", "Series", "Season", "Years", "Filename", "Resolution", "Codec", "Codec family", "Source", "Processing", "HDR", "Bit depth", "Audio", "Channels", "Bytes", "Metadata disagreement", "Recognition conflicts", "Media server matching", "Technical outliers", "Language outliers", "Custom", "Instance ID", "Service instance"}
	if len(locale) > 0 {
		for i, header := range headers {
			headers[i] = localizedMessage(locale[0], header)
		}
	}
	cw.Write(headers)
	for rows.Next() {
		var raw, custom string
		if e := ctx.Err(); e != nil {
			return e
		}
		if e := rows.Scan(&raw, &custom); e != nil {
			return e
		}
		var f File
		if e := json.Unmarshal([]byte(raw), &f); e != nil {
			return e
		}
		if e := json.Unmarshal([]byte(custom), &f.Custom); e != nil {
			return e
		}
		var names []string
		for _, tag := range f.Custom {
			name := tag.Name
			if tag.DisplayName != "" {
				name = tag.DisplayName
			}
			names = append(names, name)
		}
		var years []string
		for _, y := range f.Years {
			years = append(years, strconv.Itoa(y))
		}
		instanceName := instanceNames[f.Service]
		if instanceName == "" {
			instanceName = f.Service
		}
		record := []string{f.Title, f.Series, strconv.Itoa(f.Season), strings.Join(years, ", "), f.Filename, f.Resolution, f.Codec, f.Family, f.Source, f.Processing, f.HDR, f.BitDepth, combinedAudioSummary(f, locale...), f.Channels, strconv.FormatInt(f.Size, 10), strconv.FormatBool(f.Conflict), strconv.FormatBool(f.RuleConflict), f.EmbyMatch, strconv.FormatBool(f.SeasonOutlier), strconv.FormatBool(f.LanguageOutlier), strings.Join(names, " · "), f.Service, instanceName}
		for i, v := range record {
			record[i] = safeCell(v)
		}
		if e := cw.Write(record); e != nil {
			return e
		}
	}
	if e := rows.Err(); e != nil {
		return e
	}
	cw.Flush()
	return cw.Error()
}

func combinedAudioSummary(f File, locale ...string) string {
	language := "en"
	if len(locale) > 0 {
		language = locale[0]
	}
	languages, codecs := f.Language, f.Audio
	summary := ""
	if len(f.AudioTracks) > 0 && !hasActiveFieldConfirmation(f, "audio") && !hasActiveFieldConfirmation(f, "language") && !hasActiveFieldConfirmation(f, "channels") {
		summary = audioTrackSummary(f.AudioTracks, locale...)
		knownLanguages, knownCodecs := map[string]bool{}, map[string]bool{}
		for _, track := range f.AudioTracks {
			knownLanguages[track.Language] = true
			knownCodecs[track.Codec] = true
		}
		extras := func(value, separator string, known map[string]bool) string {
			out := []string{}
			for _, v := range strings.Split(value, separator) {
				if v != "" && !known[v] {
					out = append(out, v)
				}
			}
			return strings.Join(out, separator)
		}
		languages = extras(languages, ", ", knownLanguages)
		codecs = extras(codecs, " + ", knownCodecs)
		if languages == "" && codecs == "" {
			return summary
		}
		summary += " | "
	}
	return summary + localizedMessage(language, "Languages:") + " " + languages + " | " + localizedMessage(language, "Codecs:") + " " + codecs + " | " + localizedMessage(language, "Track mapping unavailable")
}
