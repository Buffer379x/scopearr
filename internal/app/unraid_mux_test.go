package app

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

type physicalMuxRunner130 struct {
	fakeMux120
	output string
	after  func()
}

func (r *physicalMuxRunner130) Mux(ctx context.Context, args []string, progress func(int)) ([]string, error) {
	for i, arg := range args {
		if arg == "-o" {
			r.output = args[i+1]
		}
	}
	warnings, e := r.fakeMux120.Mux(ctx, args, progress)
	if e == nil && r.after != nil {
		r.after()
	}
	return warnings, e
}
func TestMuxPhysicalExecution130(t *testing.T) {
	for _, mode := range []string{"same", "renamed", "same-work", "renamed-work", "pool", "fallback", "several", "changed"} {
		t.Run(mode, func(t *testing.T) {
			s, cfg := placementFixture130(t)
			disk := "disk6"
			if mode == "pool" {
				disk = "cache"
			}
			placementWrite130(t, cfg, disk, "Film.mkv", "original")
			physical := filepath.Join(cfg.Unraid.DiskRoot, disk, "movies/Film/Film.mkv")
			local := filepath.Join(cfg.Unraid.ShareRoot, "movies/Film/Film.mkv")
			if e := os.MkdirAll(filepath.Dir(local), 0755); e != nil {
				t.Fatal(e)
			}
			data, e := os.ReadFile(physical)
			if e != nil {
				t.Fatal(e)
			}
			if e = os.WriteFile(local, data, 0640); e != nil {
				t.Fatal(e)
			}
			info, e := os.Stat(physical)
			if e != nil {
				t.Fatal(e)
			}
			if e = os.Chtimes(local, info.ModTime(), info.ModTime()); e != nil {
				t.Fatal(e)
			}
			if mode == "fallback" {
				if e = os.Remove(physical); e != nil {
					t.Fatal(e)
				}
			}
			if mode == "several" {
				placementWrite130(t, cfg, "disk3", "Film.mkv", "original")
			}
			source, spec := muxFixture120()
			source.ModTime = info.ModTime()
			spec.OutputName = "Film"
			spec.DeleteOriginal = false
			if strings.HasPrefix(mode, "renamed") {
				spec.OutputName = "Result"
			}
			if strings.Contains(mode, "work") {
				cfg.Mux.WorkDir = muxTempDir120(t)
			}
			cfg.Mux.NotifyMedia = false
			arr := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == "POST" {
					io.WriteString(w, `{"id":3}`)
				} else {
					io.WriteString(w, `{"id":3,"status":"completed"}`)
				}
			}))
			defer arr.Close()
			cfg.Instances[0].URL = arr.URL
			s.settings = cfg
			f := sample(1, "Film.mkv")
			f.Service = "radarr"
			f.SourcePath = "/arr/movies/Film/Film.mkv"
			f.MediaID = 1
			f.Size = 8
			if e = s.Store.Replace("radarr", []File{f}, SyncStatus{}); e != nil {
				t.Fatal(e)
			}
			runner := &physicalMuxRunner130{fakeMux120: fakeMux120{source: source}}
			s.Mux.testRunner = runner
			if mode == "changed" {
				runner.after = func() {
					placementWrite130(t, cfg, "disk3", "Film.mkv", "original")
					if e := os.Remove(physical); e != nil {
						t.Fatal(e)
					}
				}
			}
			oldSpace, oldRename := muxSpace, muxRename
			t.Cleanup(func() { muxSpace, muxRename = oldSpace, oldRename })
			checkedPhysical := false
			muxSpace = func(path string) (uint64, error) {
				if path == filepath.Dir(physical) {
					checkedPhysical = true
				}
				return 10 << 30, nil
			}
			if strings.Contains(mode, "work") {
				muxRename = func(string, string) error { return syscall.EXDEV }
			}
			job := MuxJob{Service: "radarr", FileID: 1, MediaID: 1, Source: source, Spec: spec, Status: "running"}
			if e = s.Store.muxSave(&job); e != nil {
				t.Fatal(e)
			}
			e = s.Mux.execute(context.Background(), &job)
			if mode == "several" || mode == "changed" {
				if e == nil {
					t.Fatal("expected rejection")
				}
				if mode == "changed" && !strings.Contains(e.Error(), "changed before replacement") {
					t.Fatal(e)
				}
				return
			}
			if e != nil {
				t.Fatal(e)
			}
			destination := physical
			if mode == "fallback" {
				destination = local
			} else if job.Source.OutputDisk != disk || !checkedPhysical {
				t.Fatal(job.Source.OutputDisk, checkedPhysical)
			}
			final := filepath.Join(filepath.Dir(destination), spec.OutputName+".mkv")
			data, e = os.ReadFile(final)
			if e != nil || string(data) != "new-data" {
				t.Fatal(string(data), e)
			}
			if spec.OutputName == "Film" {
				data, e = os.ReadFile(filepath.Join(filepath.Dir(destination), job.BackupName))
				if e != nil || string(data) != "original" {
					t.Fatal("backup", string(data), e)
				}
			}
			if strings.Contains(mode, "work") {
				if !pathWithin(cfg.Mux.WorkDir, runner.output) {
					t.Fatal(runner.output)
				}
			} else if runner.output != muxTemp(destination, job) {
				t.Fatal(runner.output)
			}
			if _, e = os.Stat(muxTemp(destination, job)); !os.IsNotExist(e) {
				t.Fatal("partial remains", e)
			}
			log, e := os.ReadFile(s.Mux.logPath(job.ID))
			if e != nil {
				t.Fatal(e)
			}
			if strings.Contains(string(log), cfg.Unraid.DiskRoot) || strings.Contains(string(log), cfg.Unraid.ShareRoot) {
				t.Fatal("absolute path leaked", string(log))
			}
			saved, e := s.Store.muxJobs()
			if e != nil || len(saved) != 1 {
				t.Fatal(e)
			}
			raw, _ := json.Marshal(saved[0])
			if strings.Contains(string(raw), cfg.Unraid.DiskRoot) {
				t.Fatal("physical path leaked")
			}
		})
	}
}
