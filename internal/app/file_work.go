package app

import (
	"context"
	"sync"
	"time"
)

// Queue locks are held only while claiming work. Ownership spans the complete
// file operation without holding a mutex across IO or Arr requests.
type fileWorkLock struct {
	mu    sync.Mutex
	owner string
}

func (f *fileWorkLock) try(owner string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.owner != "" {
		return false
	}
	f.owner = owner
	return true
}
func (f *fileWorkLock) release(owner string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.owner == owner {
		f.owner = ""
	}
}
func (f *fileWorkLock) current() string { f.mu.Lock(); defer f.mu.Unlock(); return f.owner }
func (f *fileWorkLock) acquire(ctx context.Context, owner string) bool {
	tick := time.NewTicker(50 * time.Millisecond)
	defer tick.Stop()
	for {
		if f.try(owner) {
			return true
		}
		select {
		case <-ctx.Done():
			return false
		case <-tick.C:
		}
	}
}
