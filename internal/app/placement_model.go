package app

import (
	"os"
)

type PlacementFile struct {
	Disk  string `json:"disk"`
	Rel   string `json:"rel"`
	Size  int64  `json:"size"`
	Mtime int64  `json:"mtime"`
	Atime int64  `json:"atime"`
	Mode  uint32 `json:"mode"`
	UID   uint32 `json:"uid"`
	GID   uint32 `json:"gid"`
	Dir   bool   `json:"dir,omitempty"`
}

func (f PlacementFile) fileMode() os.FileMode { return os.FileMode(f.Mode) }

type PlacementDisk struct {
	Bytes int64 `json:"bytes"`
	Files int   `json:"files"`
	Dirs  int   `json:"dirs"`
}

type PlacementItem struct {
	// present lists the devices a share-first scan found the folder on;
	// skipInspect marks one-device and missing rows that need no walk.
	present     []string
	skipInspect bool
	ID          int64                    `json:"id"`
	Key         string                   `json:"itemKey"`
	Service     string                   `json:"service"`
	Instance    string                   `json:"instance"`
	MediaID     int                      `json:"mediaId"`
	Season      *int                     `json:"season"`
	Title       string                   `json:"title"`
	Rel         string                   `json:"rel"`
	ScanStatus  string                   `json:"scanStatus"`
	Kind        string                   `json:"kind"`
	Target      string                   `json:"target"`
	TotalBytes  int64                    `json:"totalBytes"`
	MoveBytes   int64                    `json:"moveBytes"`
	MoveFiles   int                      `json:"moveFiles"`
	Disks       map[string]PlacementDisk `json:"disks"`
	Files       []PlacementFile          `json:"files,omitempty"`
	Warnings    []string                 `json:"warnings"`
	JobStatus   string                   `json:"jobStatus"`
	QueuePos    *int64                   `json:"queuePos"`
	Progress    int                      `json:"progress"`
	BytesDone   int64                    `json:"bytesDone"`
	Message     string                   `json:"message"`
	UpdatedAt   string                   `json:"updatedAt"`
	FinishedAt  *string                  `json:"finishedAt"`
	Check       *PlacementCheck          `json:"check,omitempty"`
}

func (i PlacementItem) startable() bool {
	return (i.ScanStatus == "split" || i.ScanStatus == "empty_folders") && i.Target != "" && (i.JobStatus == "" || i.JobStatus == "failed")
}

// selectable also admits mover items, which start only when marked manually.
func (i PlacementItem) selectable() bool {
	return (i.startable() || i.ScanStatus == "waiting_for_mover" && i.Target != "" && (i.JobStatus == "" || i.JobStatus == "failed"))
}
func (i PlacementItem) rootOnly() bool { return i.Season != nil && *i.Season == -1 }

// Keep the original durable file plan for recovery/audit, but show the completed
// layout in list/detail responses instead of presenting old sources as pending.
func placementPresentation(item PlacementItem) PlacementItem {
	if item.JobStatus != "succeeded" {
		return item
	}
	files := 0
	for _, disk := range item.Disks {
		files += disk.Files
	}
	item.Disks = map[string]PlacementDisk{}
	if files > 0 {
		item.Disks[item.Target] = PlacementDisk{Bytes: item.TotalBytes, Files: files}
	}
	if item.Files != nil {
		current := make([]PlacementFile, 0, len(item.Files))
		for _, file := range item.Files {
			if !file.Dir {
				file.Disk = item.Target
				current = append(current, file)
			}
		}
		item.Files = current
	}
	return item
}

type PlacementCheck struct {
	Reachable  bool        `json:"reachable"`
	Writable   bool        `json:"writable"`
	FreeSpace  bool        `json:"freeSpace"`
	Unchanged  bool        `json:"unchanged"`
	NoConflict bool        `json:"noConflict"`
	Owner      bool        `json:"owner"`
	State      UnraidState `json:"state"`
}

type PlacementTargetSummary struct {
	Target     string           `json:"target"`
	Items      int              `json:"items"`
	SmallFiles int              `json:"smallFiles"`
	MediaFiles int              `json:"mediaFiles"`
	MoveBytes  int64            `json:"moveBytes"`
	Sources    map[string]int64 `json:"sources"`
}
type PlacementScan struct {
	// Roots is retained for snapshots written before 1.4.4; new scans report
	// Shares and RootFolders.
	Roots       []ScanRoot               `json:"roots"`
	Shares      []PlacementShare         `json:"shares"`
	RootFolders []PlacementRootFolder    `json:"rootFolders"`
	LastItemID  int64                    `json:"lastItemId,omitempty"`
	MappingHash string                   `json:"mappingHash,omitempty"`
	Running     bool                     `json:"running"`
	StartedAt   string                   `json:"startedAt"`
	FinishedAt  string                   `json:"finishedAt"`
	Duration    float64                  `json:"duration"`
	Checked     int                      `json:"checked"`
	Total       int                      `json:"total"`
	OK          int                      `json:"ok"`
	Several     int                      `json:"several"`
	SmallFiles  int                      `json:"smallFiles"`
	MoveBytes   int64                    `json:"moveBytes"`
	Unstartable int                      `json:"unstartable"`
	Disk        string                   `json:"disk"`
	Error       string                   `json:"error"`
	Counts      map[string]int           `json:"counts"`
	Targets     []PlacementTargetSummary `json:"targets"`
	Options     UnraidSettings           `json:"options"`
}
