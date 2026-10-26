package app

import "errors"

type MediaInfoSettings struct {
	Enabled bool   `json:"enabled"`
	Channel string `json:"channel"`
}

func normalizeMediaInfo(cfg *Settings) error {
	if cfg.MediaInfo.Channel == "" {
		cfg.MediaInfo.Channel = "stable"
	}
	if cfg.MediaInfo.Channel != "stable" && cfg.MediaInfo.Channel != "edge" {
		return errors.New("Invalid MediaInfo channel")
	}
	return nil
}
