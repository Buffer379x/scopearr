package app

import (
	"fmt"
	"regexp"
	"strings"
	"time"
)

type TagGroups struct {
	Resolution bool `json:"resolution"`
	Codec      bool `json:"codec"`
	Source     bool `json:"source"`
	HDR        bool `json:"hdr"`
	BitDepth   bool `json:"bitDepth"`
	Audio      bool `json:"audio"`
	Channels   bool `json:"channels"`
	Language   bool `json:"language"`
	Custom     bool `json:"custom"`
}

func (g TagGroups) Active() bool { return g != (TagGroups{}) }
func dataConfig(c ServiceConfig) ServiceConfig {
	c.TagImport = false
	c.TagImportInterval = 0
	c.SyncStart = ""
	c.WebhookEnabled = false
	c.TagSync = TagGroups{}
	c.TagSyncMode = ""
	c.TagSyncDisable = ""
	return c
}

type ServiceConfig struct {
	TagImport         bool      `json:"tagImport"`
	TagImportInterval int       `json:"tagImportInterval"`
	SyncStart         string    `json:"syncStart"`
	WebhookEnabled    bool      `json:"webhookEnabled"`
	TagSyncMode       string    `json:"tagSyncMode,omitempty"`
	TagSyncDisable    string    `json:"tagSyncDisable,omitempty"`
	TagSync           TagGroups `json:"tagSync"`
	Enabled           bool      `json:"enabled"`
	URL               string    `json:"url"`
	APIKey            string    `json:"apiKey,omitempty"`
	HasKey            bool      `json:"hasKey"`
	ClearKey          bool      `json:"clearKey,omitempty"`
	PathMappings      string    `json:"pathMappings,omitempty"`
	Interval          int       `json:"interval"`
}
type Settings struct {
	GroupSD         *bool               `json:"groupSD,omitempty"`
	GroupSDLists    bool                `json:"groupSDLists"`
	PageSize        int                 `json:"pageSize"`
	SyncTimezone    string              `json:"syncTimezone"`
	Widgets         WidgetSettings      `json:"widgets"`
	ListInfoOrder   []string            `json:"listInfoOrder"`
	ListInfoVisible []string            `json:"listInfoVisible"`
	InterfaceTheme  string              `json:"interfaceTheme"`
	WarningColors   map[string]string   `json:"warningColors"`
	ColumnOrder     map[string][]string `json:"columnOrder"`
	VisibleColumns  map[string][]string `json:"visibleColumns"`
	TagColors       map[string]string   `json:"tagColors"`
	TagTextColors   map[string]string   `json:"tagTextColors"`
	HiddenTags      map[string]bool     `json:"hiddenTags"`
	Radarr          ServiceConfig       `json:"radarr"`
	Sonarr          ServiceConfig       `json:"sonarr"`
	Emby            ServiceConfig       `json:"emby"`
	Jellyfin        ServiceConfig       `json:"jellyfin"`
	SeasonMode      string              `json:"seasonMode"`
}
type Evidence struct {
	Rules    []string `json:"rules,omitempty"`
	Filename string   `json:"filename"`
	API      string   `json:"api"`
	Emby     string   `json:"emby,omitempty"`
	Origin   string   `json:"origin"`
	Conflict bool     `json:"conflict"`
}
type Episode struct {
	ID     int    `json:"id"`
	Number int    `json:"number"`
	Title  string `json:"title"`
	Year   int    `json:"year"`
}
type AudioTrack struct {
	Index         int    `json:"index"`
	Language      string `json:"language"`
	Codec         string `json:"codec"`
	Channels      int    `json:"channels"`
	ChannelLayout string `json:"channelLayout"`
	Title         string `json:"title"`
	Default       bool   `json:"default"`
}
type CustomTag struct {
	DisplayName string   `json:"displayName,omitempty"`
	Count       int      `json:"count"`
	Protected   bool     `json:"protected,omitempty"`
	Sources     []string `json:"sources,omitempty"`
	Rules       []string `json:"rules,omitempty"`
	LocalRule   bool     `json:"localRule,omitempty"`
	Manual      bool     `json:"manual,omitempty"`
	ID          int64    `json:"id"`
	Name        string   `json:"name"`
}
type MediaVideo struct {
	Width      int    `json:"width,omitempty"`
	Height     int    `json:"height,omitempty"`
	Resolution string `json:"resolution,omitempty"`
	Codec      string `json:"codec,omitempty"`
	BitDepth   string `json:"bitDepth,omitempty"`
}
type MediaLink struct {
	ItemID   string `json:"itemId"`
	ServerID string `json:"serverId"`
}
type MediaMatch struct {
	Link   *MediaLink   `json:"link,omitempty"`
	Video  *MediaVideo  `json:"video,omitempty"`
	Status string       `json:"status"`
	Tracks []AudioTrack `json:"tracks,omitempty"`
	HDR    string       `json:"hdr,omitempty"`
}
type MediaMatches struct {
	Emby     *MediaMatch `json:"emby,omitempty"`
	Jellyfin *MediaMatch `json:"jellyfin,omitempty"`
}

func (m *MediaMatches) get(provider string) *MediaMatch {
	if m == nil {
		return nil
	}
	if provider == "jellyfin" {
		return m.Jellyfin
	}
	return m.Emby
}
func (f *File) setMediaMatch(provider string, value MediaMatch) {
	if f.MediaServers == nil {
		f.MediaServers = &MediaMatches{}
	}
	if provider == "jellyfin" {
		if other := f.MediaServers.Emby; other != nil && other.Video != nil && value.Video != nil && *other.Video == *value.Video {
			value.Video = other.Video
		}
		if f.MediaServers.Emby != nil && trackInventory(f.MediaServers.Emby.Tracks) == trackInventory(value.Tracks) {
			value.Tracks = f.MediaServers.Emby.Tracks
		}
		f.MediaServers.Jellyfin = &value
	} else {
		f.MediaServers.Emby = &value
	}
}
func (m *MediaMatches) count() int {
	if m == nil {
		return 0
	}
	n := 0
	if m.Emby != nil {
		n++
	}
	if m.Jellyfin != nil {
		n++
	}
	return n
}

type File struct {
	MediaServers         *MediaMatches       `json:"mediaServers,omitempty"`
	MediaOrigin          string              `json:"mediaOrigin,omitempty"`
	SeasonOutlier        bool                `json:"seasonOutlier"`
	LanguageOutlier      bool                `json:"languageOutlier"`
	SeasonReasons        map[string]string   `json:"seasonReasons,omitempty"`
	InformationOnly      map[string][]string `json:"informationOnly,omitempty"`
	comparisonEngine     *RecognitionEngine
	Custom               []CustomTag           `json:"custom"`
	RecognizedCustom     []int64               `json:"recognizedCustom,omitempty"`
	APIInfo              *APIInfo              `json:"apiInfo,omitempty"`
	RecognitionRevision  string                `json:"recognitionRevision,omitempty"`
	RuleConflict         bool                  `json:"ruleConflict"`
	RecognitionConflicts []RecognitionConflict `json:"recognitionConflicts,omitempty"`
	ID                   int                   `json:"id"`
	Service              string                `json:"service"`
	MediaID              int                   `json:"mediaId"`
	TitleSlug            string                `json:"titleSlug,omitempty"`
	Title                string                `json:"title"`
	Series               string                `json:"series"`
	Season               int                   `json:"season"`
	Episodes             []Episode             `json:"episodes"`
	Years                []int                 `json:"years"`
	Filename             string                `json:"filename"`
	SourcePath           string                `json:"-"`
	Resolution           string                `json:"resolution"`
	Codec                string                `json:"codec"`
	Family               string                `json:"family"`
	Source               string                `json:"source"`
	Processing           string                `json:"processing"`
	HDR                  string                `json:"hdr"`
	BitDepth             string                `json:"bitDepth"`
	Audio                string                `json:"audio"`
	AudioStreamCount     int                   `json:"audioStreamCount"`
	AudioTracks          []AudioTrack          `json:"audioTracks,omitempty"`
	EmbyMatch            string                `json:"embyMatch,omitempty"`
	Channels             string                `json:"channels"`
	Language             string                `json:"language"`
	Size                 int64                 `json:"size"`
	Conflict             bool                  `json:"conflict"`
	Evidence             map[string]Evidence   `json:"evidence"`
	Matched              bool                  `json:"matched"`
	UnknownTraits        []string              `json:"unknownTraits,omitempty"`
	MetadataIncomplete   bool                  `json:"metadataIncomplete"`
}
type SyncStatus struct {
	Source      string     `json:"source,omitempty"`
	Running     bool       `json:"running"`
	Queued      bool       `json:"queued"`
	LastAttempt *time.Time `json:"lastAttempt"`
	LastSuccess *time.Time `json:"lastSuccess"`
	Error       string     `json:"error"`
	Count       int        `json:"count"`
}
type Preset struct {
	ID      int64  `json:"id"`
	Name    string `json:"name"`
	Service string `json:"service"`
	Query   string `json:"query"`
}

func DefaultSettings() Settings {
	groupSD := true
	return Settings{GroupSD: &groupSD, PageSize: 100, Widgets: defaultWidgets(), ListInfoOrder: defaultListInfoOrder(), ListInfoVisible: defaultListInfoOrder(), InterfaceTheme: "default", WarningColors: defaultWarningColors(), ColumnOrder: defaultColumnOrder(), VisibleColumns: defaultVisibleColumns(), TagColors: map[string]string{}, TagTextColors: map[string]string{}, HiddenTags: map[string]bool{}, Radarr: ServiceConfig{Interval: 60, TagImportInterval: 5}, Sonarr: ServiceConfig{Interval: 60, TagImportInterval: 5}, Emby: ServiceConfig{}, SeasonMode: "matches"}
}

func (s *Settings) Connections() []*ServiceConfig {
	return []*ServiceConfig{&s.Radarr, &s.Sonarr, &s.Emby, &s.Jellyfin}
}
func mergeConnection(in *ServiceConfig, old ServiceConfig) error {
	if in.ClearKey {
		if in.Enabled || in.APIKey != "" {
			return fmt.Errorf("Disable the service and clear the input to delete the API key")
		}
		in.APIKey = ""
	} else if in.APIKey == "" {
		in.APIKey = old.APIKey
	}
	in.ClearKey, in.HasKey = false, false
	return ValidateConfig(*in)
}

func defaultColumnOrder() map[string][]string {
	return map[string][]string{
		"radarr": {"info", "title", "year", "resolution", "codec", "source", "processing", "size", "hdr", "bitDepth", "audio", "channels", "custom"},
		"sonarr": {"info", "title", "year", "resolution", "codec", "source", "processing", "size", "hdr", "bitDepth", "audio", "channels", "custom"},
	}
}

func defaultVisibleColumns() map[string][]string {
	return map[string][]string{
		"radarr": {"info", "title", "year", "resolution", "codec", "source", "processing", "custom"},
		"sonarr": {"info", "title", "year", "resolution", "codec", "source", "processing", "custom"},
	}
}

// Missing selections preserve the original layout for existing installations.
func normalizeVisibleColumns(cfg *Settings) error {
	migrateAudioColumns(cfg)
	// Split processing out of Source while retaining each existing layout.
	for service, order := range cfg.ColumnOrder {
		if !containsColumn(order, "processing") && containsColumn(order, "source") {
			next := []string{}
			for _, column := range order {
				next = append(next, column)
				if column == "source" {
					next = append(next, "processing")
				}
			}
			cfg.ColumnOrder[service] = next
			if containsColumn(cfg.VisibleColumns[service], "source") {
				visible := []string{}
				for _, column := range cfg.VisibleColumns[service] {
					visible = append(visible, column)
					if column == "source" {
						visible = append(visible, "processing")
					}
				}
				cfg.VisibleColumns[service] = visible
			}
		}
	}
	if err := normalizeListInfo(cfg); err != nil {
		return err
	}
	for service, order := range cfg.ColumnOrder {
		if !containsColumn(order, "custom") {
			cfg.ColumnOrder[service] = append(order, "custom")
		}
	}
	if cfg.VisibleColumns == nil {
		cfg.VisibleColumns = defaultVisibleColumns()
	}
	allowed := map[string]bool{"title": true, "year": true, "resolution": true, "codec": true, "source": true, "processing": true, "size": true, "hdr": true, "bitDepth": true, "audio": true, "channels": true, "custom": true, "info": true}
	for service, columns := range cfg.VisibleColumns {
		if service != "radarr" && service != "sonarr" {
			return fmt.Errorf("Invalid service for column selection")
		}
		seen := map[string]bool{}
		for _, column := range columns {
			if !allowed[column] || seen[column] {
				return fmt.Errorf("Invalid column selection")
			}
			seen[column] = true
		}
		if !seen["title"] {
			return fmt.Errorf("Title or episode must remain visible")
		}
	}
	for service, columns := range defaultVisibleColumns() {
		if _, exists := cfg.VisibleColumns[service]; !exists {
			cfg.VisibleColumns[service] = columns
		}
	}
	if cfg.ColumnOrder == nil {
		cfg.ColumnOrder = defaultColumnOrder()
	}
	for service, columns := range cfg.ColumnOrder {
		if service != "radarr" && service != "sonarr" {
			return fmt.Errorf("Invalid service for column order")
		}
		if len(columns) != len(allowed) {
			return fmt.Errorf("Column order must include all columns")
		}
		seen := map[string]bool{}
		for _, column := range columns {
			if !allowed[column] || seen[column] {
				return fmt.Errorf("Invalid column order")
			}
			seen[column] = true
		}
	}
	for service, columns := range defaultColumnOrder() {
		if _, exists := cfg.ColumnOrder[service]; !exists {
			cfg.ColumnOrder[service] = columns
		}
	}
	return nil
}

var tagColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

func validateTagColors(colors map[string]string) error {
	if len(colors) > 512 {
		return fmt.Errorf("Too many tag colors")
	}
	for key, color := range colors {
		field, value, ok := strings.Cut(key, ":")
		valid := field == "resolution" || field == "codec" || field == "source" || field == "processing" || field == "hdr" || field == "audio" || field == "custom" || field == "bitDepth" || field == "channels" || field == "language"
		if !ok || !valid || value == "" || len(key) > 200 || !tagColorPattern.MatchString(color) {
			return fmt.Errorf("Invalid tag color")
		}
	}
	return nil
}

func normalizeTagTextColors(cfg *Settings) error {
	if cfg.HiddenTags == nil {
		cfg.HiddenTags = map[string]bool{}
	}
	if len(cfg.HiddenTags) > 2048 {
		return fmt.Errorf("Too many tag display settings")
	}
	for key, hidden := range cfg.HiddenTags {
		if err := validateTagColors(map[string]string{key: "#000000"}); err != nil {
			return fmt.Errorf("Invalid tag display setting")
		}
		if !hidden {
			delete(cfg.HiddenTags, key)
		}
	}
	if cfg.TagTextColors == nil {
		cfg.TagTextColors = map[string]string{}
	}
	if err := validateTagColors(cfg.TagTextColors); err != nil {
		return err
	}
	for _, color := range cfg.TagTextColors {
		if color != "#000000" && color != "#ffffff" {
			return fmt.Errorf("Tag text color must be black or white")
		}
	}
	return nil
}

func migrateAudioColumns(cfg *Settings) {
	for _, layout := range []map[string][]string{cfg.VisibleColumns, cfg.ColumnOrder} {
		for service, columns := range layout {
			if !containsColumn(columns, "language") {
				continue
			}
			next := []string{}
			for _, column := range columns {
				if column == "audio" {
					continue
				}
				if column == "language" {
					column = "audio"
				}
				next = append(next, column)
			}
			layout[service] = next
		}
	}
}
func containsColumn(columns []string, value string) bool {
	for _, column := range columns {
		if column == value {
			return true
		}
	}
	return false
}
func defaultWarningColors() map[string]string {
	return map[string]string{"metadata": "#d9a870", "recognition": "#b994f0"}
}
func normalizeWarningColors(cfg *Settings) error {
	if cfg.WarningColors == nil {
		cfg.WarningColors = defaultWarningColors()
	}
	for key, color := range cfg.WarningColors {
		if (key != "metadata" && key != "recognition") || !tagColorPattern.MatchString(color) {
			return fmt.Errorf("Invalid warning color")
		}
	}
	for key, color := range defaultWarningColors() {
		if cfg.WarningColors[key] == "" {
			cfg.WarningColors[key] = color
		}
	}
	return nil
}
