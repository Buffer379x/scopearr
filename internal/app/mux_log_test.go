package app

import (
	"context"
	"errors"
	"net/http"

	"os"
	"strings"
	"testing"
)

func TestMuxRedactionKeepsFormatAndSourceReferences(t *testing.T) {
	for _, tc := range []struct{ in, out string }{
		{"track 1: Using the output module for the format 'MPEG-1/2 Audio Layer II/III'.", "track 1: Using the output module for the format 'MPEG-1/2 Audio Layer II/III'."},
		{"track 0: Using the output module for the format 'AVC/H.264'.", "track 0: Using the output module for the format 'AVC/H.264'."},
		{"memory.cpp/safemalloc() called from file src/common/memory.h, line 203", "memory.cpp/safemalloc() called from file src/common/memory.h, line 203"},
		{"The file '/media/movies/X/.X.scopearr-9.partial' has been opened", "The file '.X.scopearr-9.partial' has been opened"},
		{"Error: cannot open /mnt/user/movies/x.mkv", "Error: cannot open x.mkv"},
		{`"C:/x/y.mkv"`, `"y.mkv"`}, {"/private/a.mkv", "a.mkv"}, {"file=(/media/a.mkv)", "file=(a.mkv)"},
	} {
		if got := redactMuxLine(tc.in, nil); got != tc.out {
			t.Errorf("%q -> %q want %q", tc.in, got, tc.out)
		}
	}
	if got := redactMuxLine("known /path with spaces/x.mkv", []string{"/path with spaces/x.mkv"}); got != "known x.mkv" {
		t.Fatal(got)
	}
}
func TestClassifyMuxFailure(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"malloc() returned nullptr for a size of 18446744072874029143 bytes.", "The source file appears to be damaged:"},
		{"NO SPACE LEFT ON DEVICE", "Not enough free space on the target disk."},
		{"Permission denied", "MKVToolNix cannot write the output file. Check permissions for UID 99 / GID 100."},
		{"could not be opened for reading", "MKVToolNix cannot read the source file format."},
		{"Not recognized", "MKVToolNix cannot read the source file format."},
		{"unknown error", "MKVToolNix failed"},
		{"Warning: contains 1224 bytes of invalid data", "MKVToolNix failed"},
	} {
		if got := classifyMuxFailure([]string{tc.in}); !strings.HasPrefix(got, tc.want) {
			t.Fatal(tc, got)
		}
	}
}

type damagedMux126 struct{ fakeMux120 }

func (r *damagedMux126) Mux(ctx context.Context, args []string, progress func(int)) ([]string, error) {
	muxLogLine(ctx, "memory.cpp/safemalloc() called from file src/common/memory.h, line 203: malloc() returned nullptr for a size of 18446744072874029143 bytes.")
	return []string{"Warning: contains 1224 bytes of invalid data before timestamp 00:01:39.6"}, errors.New("MKVToolNix failed")
}
func TestDamagedMuxFailurePreservesSource(t *testing.T) {
	s, j, src := muxQueue125(t, func(w http.ResponseWriter, r *http.Request) { t.Error("unexpected Arr call") })
	s.Mux.testRunner = &damagedMux126{fakeMux120{source: j.Source}}
	s.Mux.processOne(context.Background())
	got, e := s.Store.muxJob(j.ID)
	if e != nil || got.Status != "failed" || !strings.HasPrefix(got.Message, "The source file appears to be damaged:") {
		t.Fatal(got, e)
	}
	b, _ := os.ReadFile(src)
	if string(b) != "original" {
		t.Fatal("source changed")
	}
	b, _ = os.ReadFile(s.Mux.logPath(j.ID))
	if !strings.Contains(string(b), "Hint: The source file appears to be damaged:") || !strings.Contains(string(b), "invalid data") {
		t.Fatal(string(b))
	}
}
