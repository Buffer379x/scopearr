package app

import (
	"regexp"
	"scopearr/internal/langdata"
	"strconv"
	"strings"
)

var resolutionRE = regexp.MustCompile(`(?i)(?:^|[ ._\[\]()-])(480[pi]|576[pi]|720p|1080[pi]|1440p|2160p|4320p|4k|8k)(?:$|[ ._\[\]()-])`)
var dolbyRE = regexp.MustCompile(`(?i)(?:^|[ ._\[\]()-])(?:dv|dovi|dolby[ ._-]?vision)(?:$|[ ._\[\]()-])`)
var hdrRE = regexp.MustCompile(`(?i)(?:^|[ ._\[\]()-])hdr(?:$|[ ._\[\]()-])`)
var eacRE = regexp.MustCompile(`(?i)(?:^|[ ._\[\]()-])(?:ddp|dd\+|eac3|e-ac-3)(?:[ ._\[\]()-]|\d|$)`)

var languageMatchers = []struct {
	re    *regexp.Regexp
	label string
}{
	{regexp.MustCompile(`(?i)(?:^|[ ._\[\]()-])(?:german|deutsch)(?:$|[ ._\[\]()-])`), "Deutsch"},
	{regexp.MustCompile(`(?i)(?:^|[ ._\[\]()-])english(?:$|[ ._\[\]()-])`), "Englisch"},
	{regexp.MustCompile(`(?i)(?:^|[ ._\[\]()-])french(?:$|[ ._\[\]()-])`), "Französisch"},
	{regexp.MustCompile(`(?i)(?:^|[ ._\[\]()-])japanese(?:$|[ ._\[\]()-])`), "Japanisch"},
}

func match(re *regexp.Regexp, s string) string {
	m := re.FindStringSubmatch(s)
	if len(m) > 1 {
		return strings.ToLower(m[1])
	}
	return ""
}
func normResolution(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "4k" {
		return "2160p"
	}
	if s == "8k" {
		return "4320p"
	}
	return s
}
func normCodec(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	r := strings.NewReplacer(".", "", " ", "", "-", "", "_", "")
	s = r.Replace(s)
	switch s {
	case "avc", "h264", "avc1", "h264/avc", "avc/h264":
		return "AVC"
	case "hevc", "h265", "hev1", "hvc1", "h265/hevc", "hevc/h265":
		return "HEVC"
	case "x264":
		return "x264"
	case "x265":
		return "x265"
	case "av1":
		return "AV1"
	case "xvid":
		return "XviD"
	case "divx":
		return "DivX"
	case "vc1":
		return "VC-1"
	case "mpeg4":
		return "MPEG-4"
	case "mpeg2", "mpeg2video":
		return "MPEG-2"
	}
	return s
}
func family(s string) string {
	switch s {
	case "MPEG-4", "XviD", "DivX":
		return "MPEG-4 Part 2"
	case "AVC", "x264":
		return "H.264/AVC"
	case "HEVC", "x265":
		return "H.265/HEVC"
	}
	return s
}

type tokenMatcher struct {
	re    *regexp.Regexp
	label string
}

func token(pattern string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)(?:^|[ ._\[\]()-])(?:` + pattern + `)(?:$|[ ._\[\]()-])`)
}

var sourceMatchers = []tokenMatcher{
	{token(`web[ ._-]?rip`), "WEBRip"}, {token(`web[ ._-]?dl`), "WEB-DL"},
	{token(`blu[ ._-]?ray`), "BluRay"}, {token(`bdrip`), "BDRip"}, {token(`brrip`), "BRRip"},
	{token(`hdtv`), "HDTV"}, {token(`dvdrip`), "DVDRip"}, {token(`dvd`), "DVD"},
}
var remuxRE = token(`remux`)

// Arr qualities are coarse categories. A more specific filename source in the
// same category refines it and is not an Arr difference.
var arrSourceCategory = map[string]string{"UHD": "BluRay", "BDRip": "BluRay", "BRRip": "BluRay", "DVDRip": "DVD"}

func sourceCompatible(filename, api string) bool {
	return filename == api || arrSourceCategory[filename] == api
}

func qualityParts(s string) (string, string, string) {
	source, processing := "", ""
	for _, m := range sourceMatchers {
		if m.re.MatchString(s) {
			source = m.label
			break
		}
	}
	if remuxRE.MatchString(s) {
		processing = "Remux"
	}
	return normResolution(match(resolutionRE, s)), source, processing
}

var hdr10PlusRE = token(`hdr10(?:\+|plus)`)
var hdr10RE = token(`hdr10`)
var hlgRE = token(`hlg`)

func hdrToken(s string) string {
	var values []string
	if dolbyRE.MatchString(s) {
		values = append(values, "Dolby Vision")
	}
	if hdr10PlusRE.MatchString(s) {
		values = append(values, "HDR10+")
	}
	if hdr10RE.MatchString(s) {
		values = append(values, "HDR10")
	}
	if hlgRE.MatchString(s) {
		values = append(values, "HLG")
	}
	if hdrRE.MatchString(s) && !hdr10PlusRE.MatchString(s) && !hdr10RE.MatchString(s) {
		values = append(values, "HDR")
	}
	return strings.Join(values, " + ")
}

var audioMatchers = []tokenMatcher{
	{token(`true[ ._-]?hd`), "TrueHD"}, {token(`dts[ ._-]?hd[ ._-]?ma`), "DTS-HD MA"},
	{token(`dts[ ._-]?hd`), "DTS-HD"}, {eacRE, "E-AC-3"},
	{token(`ac[ ._-]?3`), "AC-3"}, {token(`flac`), "FLAC"}, {token(`aac`), "AAC"},
	{token(`dts`), "DTS"}, {token(`opus`), "Opus"},
	{token(`lpcm`), "LPCM"}, {token(`pcm`), "PCM"}, {token(`mp3`), "MP3"}, {token(`alac`), "ALAC"},
}

func audioToken(s string) string {
	// Specific codecs consume their token before broader patterns run:
	// DTS-HD MA must not also become DTS-HD and DTS; E-AC-3 must not become AC-3.
	s = strings.NewReplacer("/", " ", ",", " ", ";", " ", "|", " ").Replace(s)
	var out []string
	for _, m := range audioMatchers {
		if m.re.MatchString(s) {
			out = append(out, m.label)
			for m.re.MatchString(s) {
				s = m.re.ReplaceAllString(s, " ")
			}
		}
	}
	return strings.Join(out, " + ")
}
func normAudio(s string) string {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "unknown", "n/a", "none":
		return ""
	}
	if v := audioToken(" " + s + " "); v != "" {
		return v
	}
	return strings.TrimSpace(s)
}
func normLanguage(s string) string {
	values := strings.FieldsFunc(s, func(r rune) bool { return r == '/' || r == ',' || r == ';' || r == '|' })
	out := []string{}
	seen := map[string]bool{}
	for _, v := range values {
		v = strings.TrimSpace(v)
		if langdata.IsUnknown(v) {
			v = ""
		} else if canonical := langdata.Canonical(v); canonical != "" {
			v = canonical
			if langdata.IsUnknown(v) {
				v = ""
			}
		}

		if v != "" && !seen[v] {
			out = append(out, v)
			seen[v] = true
		}
	}
	return strings.Join(out, ", ")
}

type APIInfo struct {
	Quality               string
	VideoCodec            string
	Resolution            string
	VideoBitDepth         int
	VideoDynamicRange     string
	VideoDynamicRangeType string
	AudioCodec            string
	AudioChannels         float64
	AudioLanguages        string
	AudioStreamCount      int
}

func Enrich(f *File, api APIInfo) { EnrichWithRules(f, api, defaultRecognitionEngine) }
func EnrichWithRules(f *File, api APIInfo, engine *RecognitionEngine) {
	f.comparisonEngine = engine
	f.APIInfo = &api
	result := engine.Recognize(f.Filename)
	f.InformationOnly = engine.informationOnly(f.Filename, result)
	f.RecognizedCustom = nil
	for _, v := range strings.Split(result.Values["custom"], " + ") {
		if id, err := strconv.ParseInt(v, 10, 64); err == nil && id > 0 {
			f.RecognizedCustom = append(f.RecognizedCustom, id)
		}
	}
	f.RecognitionRevision = engine.config.Revision
	f.RecognitionConflicts = result.Conflicts
	f.RuleConflict = len(result.Conflicts) > 0
	f.Evidence = map[string]Evidence{}
	f.Conflict = false
	r, s, p := result.Values["resolution"], result.Values["source"], result.Values["processing"]
	ar, as, ap := qualityParts(api.Quality)
	if api.Resolution != "" {
		if v := normResolution(match(resolutionRE, " "+api.Resolution+" ")); v != "" {
			ar = v
		}
	}
	set := func(k, n, a string) string {
		e := Evidence{Filename: n, API: a, Rules: result.Matches[k]}
		v := n
		if v != "" {
			e.Origin = result.Origins[k]
		} else if a != "" {
			v = a
			e.Origin = "api"
		} else {
			e.Origin = "unknown"
		}
		if k == "hdr" && n != "" && a != "" {
			// Profiles are additive. A filename naming DV must not hide an
			// explicitly reported HDR10 fallback from existing API metadata.
			v = mergeHDR(n, a)
			if v != n {
				e.Origin = "combined"
			}
		}
		f.Evidence[k] = e
		return v
	}
	f.Resolution = set("resolution", r, ar)
	f.Source = set("source", s, as)
	f.Processing = set("processing", p, ap)
	f.Codec = set("codec", result.Values["codec"], normCodec(api.VideoCodec))
	f.Family = family(f.Codec)
	ad := ""
	if api.VideoBitDepth > 0 {
		ad = strconv.Itoa(api.VideoBitDepth)
	}
	f.BitDepth = set("bitDepth", result.Values["bitDepth"], ad)
	f.HDR = set("hdr", result.Values["hdr"], hdrToken(api.VideoDynamicRange+" "+api.VideoDynamicRangeType))
	f.Audio = set("audio", result.Values["audio"], normAudio(api.AudioCodec))
	ac := ""
	if api.AudioChannels > 0 {
		ac = strconv.FormatFloat(api.AudioChannels, 'f', 1, 64)
	}
	f.Channels = set("channels", result.Values["channels"], ac)
	f.Language = set("language", result.Values["language"], normLanguage(api.AudioLanguages))
	if e := f.Evidence["language"]; e.Filename != "" && e.API != "" {
		f.Language = normLanguage(e.Filename + " / " + e.API)
		if f.Language != e.Filename {
			e.Origin = "combined"
		}
		f.Evidence["language"] = e
	}
	f.AudioStreamCount = api.AudioStreamCount
	markAPIDifferences(f, engine)
	updateCompleteness(f)
}

// equivalentValue reports whether two evidence values for field mean the same thing.
func equivalentValue(field, used, other string, engine *RecognitionEngine, rules []string) bool {
	switch field {
	case "codec":
		return family(used) == family(other)
	case "source":
		return sourceCompatible(used, other)
	case "audio":
		// Arr reports a primary codec, while the used value may contain several.
		if engine != nil {
			return engine.containsAudio(used, other, rules)
		}
		return containsAllTraits(used, other, " + ")
	case "language":
		return containsAllTraits(used, other, ", ")
	case "channels":
		return containsAllTraits(used, other, " + ")
	case "hdr":
		return true // HDR profiles are additive.
	default:
		return used == other
	}
}

func markAPIDifferences(f *File, engine *RecognitionEngine) {
	for _, field := range []struct{ name, used string }{
		{"resolution", f.Resolution}, {"codec", f.Codec}, {"source", f.Source},
		{"processing", f.Processing}, {"bitDepth", f.BitDepth}, {"hdr", f.HDR},
		{"audio", f.Audio}, {"channels", f.Channels}, {"language", f.Language},
	} {
		e, ok := f.Evidence[field.name]
		if !ok {
			continue
		}
		e.APIDiffers = e.API != "" && field.used != "" && !equivalentValue(field.name, field.used, e.API, engine, e.Rules)
		f.Evidence[field.name] = e
	}
}

func updateCompleteness(f *File) {
	f.UnknownTraits = nil
	for _, field := range []struct{ name, value string }{{"audio", f.Audio}, {"language", f.Language}} {
		unknown := field.value == ""
		if !hasActiveFieldConfirmation(*f, field.name) {
			for _, track := range f.AudioTracks {
				unknown = unknown || (field.name == "audio" && track.Codec == "") || (field.name == "language" && track.Language == "")
			}
		}
		if unknown {
			f.UnknownTraits = append(f.UnknownTraits, field.name)
		}
	}
	f.MetadataIncomplete = f.Resolution == "" || f.Codec == "" || f.Source == "" || len(f.UnknownTraits) > 0 || (f.EmbyMatch != "" && f.EmbyMatch != "matched")
}

func containsAllTraits(value, selected, separator string) bool {
	values := strings.Split(value, separator)
	for _, part := range strings.Split(selected, separator) {
		found := false
		for _, v := range values {
			found = found || v == part
		}
		if !found {
			return false
		}
	}
	return true
}

// Combine already normalized profiles without discarding user-defined HDR values.
func mergeHDR(values ...string) string {
	seen := map[string]bool{}
	out := []string{}
	for _, value := range values {
		for _, part := range strings.Split(value, " + ") {
			part = strings.TrimSpace(part)
			if part != "" && !seen[part] {
				seen[part] = true
				out = append(out, part)
			}
		}
	}
	return strings.Join(out, " + ")
}
