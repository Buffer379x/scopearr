package app

import (
	"bufio"
	"bytes"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type UnraidState struct {
	Known   bool   `json:"known"`
	Mover   bool   `json:"mover"`
	Parity  bool   `json:"parity"`
	Warning string `json:"warning,omitempty"`
}

const unraidUnknownState = "Mover/parity state unknown"
const unraidNoState = "Mover and parity state unknown. Do not move files while the mover or a parity check runs."

// Unraid 7.3.3 was checked with actual mover and non-correcting parity runs.
// mdResyncAction remains "check P" even while idle; it is not an activity flag.
func parseUnraidState(data []byte) UnraidState {
	state := UnraidState{Warning: unraidUnknownState}
	values := map[string]string{}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 4096), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if strings.HasPrefix(line, "#") || strings.HasPrefix(line, ";") || strings.HasPrefix(line, "[") || line == "" {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		if key != "shareMoverActive" && key != "mdResync" && key != "mdResyncPos" {
			continue
		}
		if _, duplicate := values[key]; duplicate {
			return state
		}
		values[key] = strings.Trim(strings.TrimSpace(value), `"'`)
	}
	if scanner.Err() != nil {
		return state
	}
	moverKnown := true
	switch strings.ToLower(values["shareMoverActive"]) {
	case "yes", "true", "1":
		state.Mover = true
	case "no", "false", "0":
	default:
		moverKnown = false
	}
	resync, e1 := strconv.ParseUint(values["mdResync"], 10, 64)
	pos, e2 := strconv.ParseUint(values["mdResyncPos"], 10, 64)
	state.Parity = (e1 == nil && resync > 0) || (e2 == nil && pos > 0)
	state.Known = moverKnown && e1 == nil && e2 == nil
	if state.Known {
		state.Warning = ""
	}
	return state
}

func readUnraidState(u UnraidSettings) UnraidState {
	if u.StateDir == "" {
		return UnraidState{Warning: unraidNoState}
	}
	f, err := os.Open(filepath.Join(u.StateDir, "var.ini"))
	if err != nil {
		return UnraidState{Warning: unraidUnknownState}
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, 1024*1024+1))
	if err != nil || len(data) > 1024*1024 {
		return UnraidState{Warning: unraidUnknownState}
	}
	return parseUnraidState(data)
}
