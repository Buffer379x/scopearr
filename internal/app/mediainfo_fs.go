package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"syscall"
)

const mediaInfoFilesystemArg = "--scopearr-mediainfo-fs"
const mediaInfoFilesystemEnv = "SCOPEARR_MEDIAINFO_FS_HELPER"

// Filesystem syscalls on sleeping or unavailable mounts cannot be interrupted in
// a Go goroutine. Run the existing exact mapping/symlink checks and stat inside
// our own short-lived process instead. This private protocol is not a public CLI;
// both the exact argv and private environment marker are required. It works with
// the production executable and the Go test executable without special dispatch.
func init() {
	if len(os.Args) != 2 || os.Args[1] != mediaInfoFilesystemArg || os.Getenv(mediaInfoFilesystemEnv) != "1" {
		return
	}
	var request mediaInfoFilesystemRequest
	if e := json.NewDecoder(io.LimitReader(os.Stdin, 1<<20)).Decode(&request); e != nil {
		_ = json.NewEncoder(os.Stdout).Encode(mediaInfoFilesystemState{Error: "Invalid MediaInfo filesystem request"})
		os.Exit(0)
	}
	result := inspectMediaInfoFilesystem(request)
	_ = json.NewEncoder(os.Stdout).Encode(result)
	os.Exit(0)
}

type mediaInfoFilesystemRequest struct {
	Mappings string `json:"mappings"`
	Service  string `json:"service"`
	ArrPath  string `json:"arrPath"`
}
type mediaInfoFilesystemState struct {
	Local      string `json:"local,omitempty"`
	Size       int64  `json:"size"`
	Regular    bool   `json:"regular"`
	Device     uint64 `json:"device"`
	Inode      uint64 `json:"inode"`
	ModifiedNS int64  `json:"modifiedNs"`
	Error      string `json:"error,omitempty"`
}

func (s mediaInfoFilesystemState) sameFile(other mediaInfoFilesystemState) bool {
	return s.Local == other.Local && s.Device == other.Device && s.Inode == other.Inode && s.Size == other.Size && s.ModifiedNS == other.ModifiedNS && s.Regular == other.Regular
}
func inspectMediaInfoFilesystem(request mediaInfoFilesystemRequest) mediaInfoFilesystemState {
	local, e := resolveLocalPath(MuxSettings{Mappings: request.Mappings}, request.Service, request.ArrPath)
	if e != nil {
		return mediaInfoFilesystemState{Error: e.Error()}
	}
	info, e := os.Stat(local)
	if e != nil {
		return mediaInfoFilesystemState{Error: "Media file is not reachable or is not a regular file"}
	}
	identity, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return mediaInfoFilesystemState{Error: "Media file identity is unavailable"}
	}
	return mediaInfoFilesystemState{Local: local, Size: info.Size(), Regular: info.Mode().IsRegular(), Device: uint64(identity.Dev), Inode: uint64(identity.Ino), ModifiedNS: info.ModTime().UnixNano()}
}
func mediaInfoFilesystemCommand(ctx context.Context) *exec.Cmd {
	// /proc/self/exe avoids any filesystem lookup of the executable on a media
	// mount. Scopearr's supported production and Docker test platforms are Linux.
	return exec.CommandContext(ctx, "/proc/self/exe", mediaInfoFilesystemArg)
}
func (m *MediaInfoManager) probeFilesystem(ctx context.Context, cfg MuxSettings, f File) (mediaInfoFilesystemState, error) {
	var result mediaInfoFilesystemState
	request := mediaInfoFilesystemRequest{Mappings: cfg.Mappings, Service: f.Service, ArrPath: f.SourcePath}
	raw, e := json.Marshal(request)
	if e != nil || len(raw) > 1<<20 {
		return result, errors.New("Invalid MediaInfo filesystem request")
	}
	command := mediaInfoFilesystemCommand
	if m.testFSCommand != nil {
		command = m.testFSCommand
	}
	cmd := command(ctx)
	// The private helper has no background work; avoid the race runtime
	// adding its default one-second exit delay in race-instrumented builds.
	cmd.Env = []string{mediaInfoFilesystemEnv + "=1", "LANG=C.UTF-8", "LC_ALL=C.UTF-8", "GOMAXPROCS=1", "GOMEMLIMIT=32MiB", "GORACE=atexit_sleep_ms=0"}
	cmd.Stdin = bytes.NewReader(raw)
	output, e := runMediaInfoProcess(ctx, cmd, 64<<10)
	if e != nil {
		return result, e
	}
	if json.Unmarshal(output, &result) != nil {
		return result, errors.New("Invalid MediaInfo filesystem response")
	}
	if result.Error != "" {
		return mediaInfoFilesystemState{}, errors.New(result.Error)
	}
	if result.Local == "" {
		return result, errors.New("Invalid MediaInfo filesystem response")
	}
	return result, nil
}
