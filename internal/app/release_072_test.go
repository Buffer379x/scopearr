package app

import (
	"context"
	"fmt"
	"net/url"
	"testing"
	"time"
)

func importedFixture(t *testing.T, service string) (*Store, *tagFixture, ServiceConfig) {
	s := testStore(t)
	f, h := newTagFixture(t, service)
	c := tagConfig(h)
	c.TagImport = true
	c.TagImportInterval = 5
	c.TagSync = TagGroups{Custom: true}
	c.TagSyncMode = "add"
	files := []File{sample(1, "One.1080p.x264.BluRay.mkv"), sample(2, "Two.1080p.x264.BluRay.mkv")}
	files[0].MediaID = 10
	files[1].MediaID = 20
	if service == "sonarr" {
		files[1].MediaID = 10
		files[0].Episodes = []Episode{{Number: 1}}
		files[1].Episodes = []Episode{{Number: 2}}
	}
	seedTags(t, s, service, c, files)
	return s, f, c
}
func customID(t *testing.T, s *Store, name string) int64 {
	t.Helper()
	tags, e := s.CustomTags(context.Background())
	if e != nil {
		t.Fatal(e)
	}
	for _, tag := range tags {
		if tag.Name == name {
			return tag.ID
		}
	}
	t.Fatalf("missing custom %s: %#v", name, tags)
	return 0
}
func customMatches(t *testing.T, s *Store, service string, id int64) int {
	t.Helper()
	out, e := s.Query(url.Values{"service": {service}, "custom": {fmt.Sprint(id)}}, "matches", false)
	if e != nil {
		t.Fatal(e)
	}
	return out.Total
}
func TestExternalTagsPullPendingRemovalAndReaddition(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	if customMatches(t, s, "radarr", id) != 1 {
		t.Fatal("not assigned")
	}
	if f.writes != 0 || f.creates != 0 {
		t.Fatal("import wrote upstream")
	}
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"1"}}, map[string]bool{fmt.Sprint(id): false}); e != nil {
		t.Fatal(e)
	}
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if customMatches(t, s, "radarr", id) != 0 {
		t.Fatal("pull undid deletion")
	}
	if _, waiting, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil || waiting {
		t.Fatal(waiting, e)
	}
	for _, n := range f.names(10) {
		if n == "favorite" {
			t.Fatal("remote removal not applied")
		}
	}
	f.mu.Lock()
	f.tags[44] = "favorite"
	f.media[10] = append(f.media[10], 44)
	f.mu.Unlock()
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if customMatches(t, s, "radarr", id) != 1 {
		t.Fatal("external readdition missing")
	}
}
func TestExternalAutoTagsAreProtectedAndRuleRemovalUnlocks(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	f.mu.Lock()
	f.auto = map[int][]int{4: {99}, 2: {100}}
	f.mu.Unlock()
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	tags, e := s.CustomTags(ctx)
	if e != nil {
		t.Fatal(e)
	}
	var found bool
	for _, tag := range tags {
		if tag.ID == id {
			found = tag.Protected && len(tag.Rules) == 1
		}
	}
	if !found {
		t.Fatal(tags)
	}
	out, e := s.Query(url.Values{"service": {"radarr"}, "custom": {fmt.Sprint(id)}}, "matches", false)
	if e != nil || len(out.Files) != 1 || len(out.Files[0].Custom[0].Rules) == 0 {
		t.Fatal("file rule information missing", out, e)
	}
	if _, e = s.ApplyCustom(ctx, url.Values{"service": {"radarr"}}, map[string]bool{fmt.Sprint(id): false}); e == nil {
		t.Fatal("protected assignment editable")
	}
	if e = s.DeleteCustomTag(ctx, id); e == nil {
		t.Fatal("protected tag deletable")
	}
	if _, e = s.SaveCustomTag(ctx, CustomTag{ID: id, Name: "renamed"}); e == nil {
		t.Fatal("protected name editable")
	}
	next := []CustomTag{}
	for _, tag := range tags {
		if tag.ID != id {
			next = append(next, tag)
		}
	}
	if _, e = s.SaveCustomTags(ctx, tags, next); e == nil {
		t.Fatal("batch bypass")
	}
	c.TagSync = TagGroups{Resolution: true, Codec: true}
	c.TagSyncMode = "replace"
	approveFixturePlan(t, s, "radarr", c)
	if _, _, e = s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	got := f.names(10)
	if !containsString(got, "favorite") || !containsString(got, "x264") {
		t.Fatal("auto tag altered", got)
	}
	f.mu.Lock()
	f.auto = nil
	f.mu.Unlock()
	if e = s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	tags, _ = s.CustomTags(ctx)
	for _, tag := range tags {
		if tag.ID == id && tag.Protected {
			t.Fatal("rule removal still locked")
		}
	}
	if customMatches(t, s, "radarr", id) != 1 {
		t.Fatal("rule removal erased assignment")
	}
}
func TestExternalSeriesOwnershipAndManualRemoteRemoval(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "sonarr")
	if e := s.ImportTags(ctx, "sonarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	favorite := customID(t, s, "favorite")
	if customMatches(t, s, "sonarr", favorite) != 2 {
		t.Fatal("series tag not inherited")
	}
	local, e := s.SaveCustomTag(ctx, CustomTag{Name: "local"})
	if e != nil {
		t.Fatal(e)
	}
	if _, e = s.ApplyCustom(ctx, url.Values{"service": {"sonarr"}, "fileId": {"1"}}, map[string]bool{fmt.Sprint(local.ID): true}); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ReconcileTags(ctx, "sonarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if customMatches(t, s, "sonarr", local.ID) != 1 {
		t.Fatal("outgoing series union fanned back to every file")
	}
	f.mu.Lock()
	for tid, name := range f.tags {
		if name == "local" {
			ids := []int{}
			for _, v := range f.media[10] {
				if v != tid {
					ids = append(ids, v)
				}
			}
			f.media[10] = ids
		}
	}
	f.mu.Unlock()
	if _, _, e = s.ReconcileTags(ctx, "sonarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if customMatches(t, s, "sonarr", local.ID) != 0 {
		t.Fatal("manual remote deletion echoed back")
	}
	if containsString(f.names(10), "local") {
		t.Fatal("remote tag restored")
	}
	// A successful library replacement must retain externally inherited tags.
	now := time.Now()
	files := []File{sample(1, "One.mkv"), sample(2, "Two.mkv")}
	for i := range files {
		files[i].MediaID = 10
	}
	if e = s.Replace("sonarr", files, SyncStatus{Source: tagEndpoint(c), LastSuccess: &now}); e != nil {
		t.Fatal(e)
	}
	if customMatches(t, s, "sonarr", favorite) != 2 {
		t.Fatal("library sync dropped external tags")
	}
}
func TestExternalFailedReadRetainsSnapshotAndRestartIntent(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	f.mu.Lock()
	f.failDetails = true
	f.mu.Unlock()
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e == nil {
		t.Fatal("failed read succeeded")
	}
	if customMatches(t, s, "radarr", id) != 1 {
		t.Fatal("failed read lost state")
	}
	f.mu.Lock()
	f.failDetails = false
	f.mu.Unlock()
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"1"}}, map[string]bool{fmt.Sprint(id): false}); e != nil {
		t.Fatal(e)
	}
	dir := s.Dir
	s.DB.Close()
	reopened, e := OpenStore(dir)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.DB.Close()
	if e = reopened.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if customMatches(t, reopened, "radarr", id) != 0 {
		t.Fatal("restart lost local intent")
	}
	if _, _, e = reopened.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
}

func TestExternalGlobalDeleteAndConflictReview(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	if e := s.DeleteCustomTag(ctx, id); e == nil {
		t.Fatal("linked tag deletion accepted")
	}
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"radarr"}}, map[string]bool{fmt.Sprint(id): false}); e != nil {
		t.Fatal(e)
	}
	if e := s.DeleteCustomTag(ctx, id); e != nil {
		t.Fatal(e)
	}
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if containsString(f.names(10), "favorite") {
		t.Fatal("global deletion not sent")
	}
	f.mu.Lock()
	for _, name := range f.tags {
		if name == "favorite" {
			t.Fatal("unused definition not removed")
		}
	}
	f.mu.Unlock()
	// A rename concurrent with a queued deletion pauses writes until reviewed.
	id = customID(t, s, "manual")
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"1"}}, map[string]bool{fmt.Sprint(id): false}); e != nil {
		t.Fatal(e)
	}
	f.mu.Lock()
	f.tags[1] = "manual-renamed"
	before := f.writes
	f.mu.Unlock()
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != ErrExternalConflict {
		t.Fatal("rename conflict missed", e)
	}
	if f.writes != before {
		t.Fatal("conflicting intent wrote")
	}
	conflicts, e := s.ExternalConflicts(ctx, "radarr")
	if e != nil || len(conflicts) != 1 {
		t.Fatal(conflicts, e)
	}
	if e = s.ResolveExternal(ctx, "radarr", c, 10, 1, false); e != nil {
		t.Fatal(e)
	}
	if _, _, e = s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if !containsString(f.names(10), "manual-renamed") {
		t.Fatal("remote resolution ignored")
	}
}
func TestExternalRuleAddedAfterLocalRemovalPreventsWrites(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"1"}}, map[string]bool{fmt.Sprint(id): false}); e != nil {
		t.Fatal(e)
	}
	f.mu.Lock()
	f.auto = map[int][]int{4: {42}}
	before := f.writes
	f.mu.Unlock()
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if f.writes != before || !containsString(f.names(10), "favorite") {
		t.Fatal("new auto-tag protection missed")
	}
	if customMatches(t, s, "radarr", id) != 1 {
		t.Fatal("protected remote assignment not restored")
	}
}

func TestExternalDefinitionDeletedDuringPendingAddition(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "manual")
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"1"}}, map[string]bool{fmt.Sprint(id): true}); e != nil {
		t.Fatal(e)
	}
	f.mu.Lock()
	delete(f.tags, 1)
	for mid, ids := range f.media {
		next := []int{}
		for _, tid := range ids {
			if tid != 1 {
				next = append(next, tid)
			}
		}
		f.media[mid] = next
	}
	before := f.writes
	f.mu.Unlock()
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != ErrExternalConflict {
		t.Fatal(e)
	}
	if f.writes != before {
		t.Fatal("deleted definition recreated without review")
	}
	if e := s.ResolveExternal(ctx, "radarr", c, 10, 1, false); e != nil {
		t.Fatal(e)
	}
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if customMatches(t, s, "radarr", id) != 0 || containsString(f.names(10), "manual") {
		t.Fatal("remote deletion ignored")
	}
}
func TestExternalProtectionIsScopedToAssignmentService(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	f.mu.Lock()
	f.auto = map[int][]int{4: {99}}
	f.mu.Unlock()
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	other, h := newTagFixture(t, "sonarr")
	sc := tagConfig(h)
	sc.TagImport = true
	file := sample(3, "Episode.mkv")
	file.MediaID = 10
	seedTags(t, s, "sonarr", sc, []File{file})
	if e := s.ImportTags(ctx, "sonarr", sc, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"sonarr"}, "fileId": {"3"}}, map[string]bool{fmt.Sprint(id): false}); e != nil {
		t.Fatal("ordinary Sonarr assignment locked by Radarr", e)
	}
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"1"}}, map[string]bool{fmt.Sprint(id): false}); e == nil {
		t.Fatal("Radarr auto assignment editable")
	}
	if e := s.DeleteCustomTag(ctx, id); e == nil {
		t.Fatal("global definition deletable")
	}
	if !containsString(other.names(10), "favorite") {
		t.Fatal("read-only import wrote")
	}
}

func TestExternalEndpointChangeDetachesIdentities(t *testing.T) {
	ctx := context.Background()
	s, _, c := importedFixture(t, "radarr")
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"2"}}, map[string]bool{fmt.Sprint(id): true}); e != nil {
		t.Fatal(e)
	}
	old := DefaultSettings()
	old.Radarr = c
	next := old
	next.Radarr.URL = "http://different.example/radarr"
	next.Radarr.TagSync = TagGroups{}
	if e := s.saveSettingsWithAllTagPolicies(ctx, next, old, next, nil); e != nil {
		t.Fatal(e)
	}
	for _, table := range []string{"external_tag_defs", "external_tag_bindings", "external_tag_pending"} {
		var n int
		if e := s.DB.QueryRow("SELECT count(*) FROM " + table + " WHERE service='radarr'").Scan(&n); e != nil || n != 0 {
			t.Fatal(table, n, e)
		}
	}
	if customMatches(t, s, "radarr", id) != 1 {
		t.Fatal("independent local assignment lost")
	}
	if e := s.ImportTags(ctx, "radarr", next.Radarr, func() bool { return true }); e == nil {
		t.Fatal("new server mapped to old file IDs")
	}
}
func TestExternalConcurrentUndoDuringOwnWrite(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	q := url.Values{"service": {"radarr"}, "fileId": {"1"}}
	if _, e := s.ApplyCustom(ctx, q, map[string]bool{fmt.Sprint(id): false}); e != nil {
		t.Fatal(e)
	}
	// User undoes removal while the editor request is in flight.
	if _, e := s.ApplyCustom(ctx, q, map[string]bool{fmt.Sprint(id): true}); e != nil {
		t.Fatal(e)
	}
	f.mu.Lock()
	ids := []int{}
	for _, tid := range f.media[10] {
		if tid != 4 {
			ids = append(ids, tid)
		}
	}
	f.media[10] = ids
	f.mu.Unlock()
	if e := s.recordExternalWrite(ctx, "radarr", tagEndpoint(c), 10, []int{4}, false); e != nil {
		t.Fatal(e)
	}
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	conflicts, e := s.ExternalConflicts(ctx, "radarr")
	if e != nil || len(conflicts) != 0 {
		t.Fatal(conflicts, e)
	}
	if customMatches(t, s, "radarr", id) != 1 {
		t.Fatal("concurrent undo lost")
	}
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if !containsString(f.names(10), "favorite") {
		t.Fatal("undo not sent")
	}
}

func TestExternalIncompleteSnapshotCannotWriteOrEraseCache(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "favorite")
	for _, kind := range []string{"null catalog", "unreadable auto rules"} {
		f.mu.Lock()
		f.nullDetails = kind == "null catalog"
		f.failRules = kind == "unreadable auto rules"
		f.auto = map[int][]int{4: {99}}
		before := f.writes
		f.mu.Unlock()
		if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e == nil {
			t.Fatal(kind, "accepted")
		}
		if f.writes != before || customMatches(t, s, "radarr", id) != 1 {
			t.Fatal(kind, "modified existing state")
		}
	}
}

func TestExternalKeepLocalAfterDefinitionDeletionCompletesIntent(t *testing.T) {
	ctx := context.Background()
	s, f, c := importedFixture(t, "radarr")
	if e := s.ImportTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	id := customID(t, s, "manual")
	if _, e := s.ApplyCustom(ctx, url.Values{"service": {"radarr"}, "fileId": {"1"}}, map[string]bool{fmt.Sprint(id): true}); e != nil {
		t.Fatal(e)
	}
	f.mu.Lock()
	delete(f.tags, 1)
	for mid, ids := range f.media {
		next := []int{}
		for _, tid := range ids {
			if tid != 1 {
				next = append(next, tid)
			}
		}
		f.media[mid] = next
	}
	f.mu.Unlock()
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != ErrExternalConflict {
		t.Fatal(e)
	}
	if e := s.ResolveExternal(ctx, "radarr", c, 10, 1, true); e != nil {
		t.Fatal(e)
	}
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	var pending int
	if e := s.DB.QueryRow("SELECT count(*) FROM external_tag_pending").Scan(&pending); e != nil || pending != 0 {
		t.Fatal("obsolete ID kept a pending edit", pending, e)
	}
	if !containsString(f.names(10), "manual") {
		t.Fatal("local choice did not recreate assignment")
	}
	f.mu.Lock()
	for tid, name := range f.tags {
		if name == "manual" {
			ids := []int{}
			for _, v := range f.media[10] {
				if v != tid {
					ids = append(ids, v)
				}
			}
			f.media[10] = ids
		}
	}
	f.mu.Unlock()
	if _, _, e := s.ReconcileTags(ctx, "radarr", c, func() bool { return true }); e != nil {
		t.Fatal(e)
	}
	if customMatches(t, s, "radarr", id) != 0 || containsString(f.names(10), "manual") {
		t.Fatal("stale intent undid a later external removal")
	}
}
