package app

import (
	"fmt"
	"reflect"
	"testing"
)

func TestSnapshotAPIInfoSharingIsBoundedAndExact110(t *testing.T) {
	files := make([]File, 5000)
	for i := range files {
		info := APIInfo{Quality: fmt.Sprint("quality-", i), VideoCodec: "AVC"}
		files[i].APIInfo = &info
	}
	if n := shareSnapshotAPIInfo(files); n != 4096 {
		t.Fatal("unbounded API metadata pool", n)
	}
	for i, f := range files {
		if f.APIInfo.Quality != fmt.Sprint("quality-", i) {
			t.Fatal("distinct metadata changed", i)
		}
	}
	same := APIInfo{Quality: "WEB-DL-1080p", VideoCodec: "AVC", AudioChannels: 5.1}
	a, b, other := same, same, same
	other.VideoBitDepth = 10
	files = []File{{APIInfo: &a}, {APIInfo: &b}, {APIInfo: &other}, {}}
	if n := shareSnapshotAPIInfo(files); n != 2 || files[0].APIInfo != files[1].APIInfo || files[0].APIInfo == files[2].APIInfo || files[3].APIInfo != nil {
		t.Fatal("incorrect snapshot sharing", n)
	}
}

func TestSharedSnapshotMetadataDetachesForEnrichment110(t *testing.T) {
	api := APIInfo{Quality: "WEB-DL-1080p", VideoCodec: "AVC", AudioCodec: "AC3", AudioLanguages: "German", VideoBitDepth: 8}
	files := []File{{Filename: "First.1080p.x264.mkv"}, {Filename: "Second.1080p.x264.mkv"}}
	for i := range files {
		Enrich(&files[i], api)
	}
	if shareSnapshotAPIInfo(files) != 1 || files[0].APIInfo != files[1].APIInfo {
		t.Fatal("fixture did not share immutable API snapshot")
	}
	shared := files[1].APIInfo
	secondEvidence := files[1].Evidence["codec"]
	files[0].setMediaMatch("emby-home", MediaMatch{Status: "matched", Video: &MediaVideo{Codec: "HEVC", Resolution: "2160p"}})
	resolveMediaServers(&files[0])
	if files[0].APIInfo == shared || *files[1].APIInfo != api || !reflect.DeepEqual(files[1].Evidence["codec"], secondEvidence) {
		t.Fatal("provider enrichment mutated another file")
	}
	changed := api
	changed.VideoCodec = "HEVC"
	changed.Quality = "BluRay-2160p"
	Enrich(&files[0], changed)
	if *files[0].APIInfo != changed || *files[1].APIInfo != api {
		t.Fatal("recognition update mutated shared API data")
	}
}
