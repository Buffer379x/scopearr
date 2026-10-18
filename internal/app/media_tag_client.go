package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
)

// Metadata reads and the narrowly allowlisted mutations are intentionally kept
// separate from the GET-only enrichment client. Never call refresh/scan routes.
type mediaTagClient struct {
	transport *ArrClient
	kind      string
	base      string
	serverID  string
}

type mediaTagDocument struct {
	Raw    map[string]json.RawMessage
	Tags   map[string]string
	TagIDs map[string]string
	Item   embyItem
	Title  string
	Stamp  string
}

func newMediaTagClient(c ServiceConfig) *mediaTagClient {
	base := strings.TrimRight(c.URL, "/")
	kind := serviceKind(c.ID)
	if kind == "" {
		kind = c.Type
	}
	if kind == "emby" && !strings.HasSuffix(strings.ToLower(base), "/emby") {
		base += "/emby"
	}
	return &mediaTagClient{transport: NewArr(c), kind: kind, base: base}
}

func mediaTagVersionSupported(kind, version string) bool {
	parts := strings.Split(version, ".")
	if len(parts) < 2 {
		return false
	}
	major, e1 := strconv.Atoi(parts[0])
	minor, e2 := strconv.Atoi(parts[1])
	if e1 != nil || e2 != nil {
		return false
	}
	if kind == "emby" {
		return major == 4 && minor >= 8 && minor <= 10
	}
	return kind == "jellyfin" && (major == 10 && (minor == 10 || minor == 11) || major == 12 && minor <= 2)
}

func (c *mediaTagClient) get(ctx context.Context, path string, q url.Values, out any) error {
	if path != "System/Info" && path != "Items" {
		return errors.New("Media tag read endpoint is not allowed")
	}
	u, e := url.Parse(c.base + "/" + path)
	if e != nil {
		return errors.New("Invalid media server address")
	}
	u.RawQuery = q.Encode()
	return c.transport.readJSON(ctx, u, "X-Emby-Token", out)
}

func (c *mediaTagClient) check(ctx context.Context) error {
	var info struct{ Id, Version string }
	if e := c.get(ctx, "System/Info", nil, &info); e != nil {
		return e
	}
	if !safeMediaID(info.Id) || !mediaTagVersionSupported(c.kind, info.Version) {
		return errors.New("This media server version has not been verified for safe tag updates")
	}
	c.serverID = info.Id
	return nil
}

const mediaTagFields = "Path,MediaSources,MediaStreams,Tags,Genres,Studios,People,ProviderIds,Overview,OriginalTitle,SortName,DateCreated,ProductionLocations,Settings,Taglines,CustomRating,SpecialEpisodeNumbers,Width,Height,AirTime"

func mediaRawField(raw map[string]json.RawMessage, field string) (json.RawMessage, bool) {
	for key, value := range raw {
		if strings.EqualFold(key, field) {
			return value, true
		}
	}
	return nil, false
}

func mediaDocumentStamp(raw map[string]json.RawMessage) string {
	// Client/session/playback state is unrelated to the editable metadata snapshot.
	copy := map[string]json.RawMessage{}
	for k, v := range raw {
		if !strings.EqualFold(k, "UserData") && !strings.EqualFold(k, "ImageTags") && !strings.EqualFold(k, "BackdropImageTags") {
			copy[k] = v
		}
	}
	b, _ := json.Marshal(copy)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func parseMediaTagDocument(raw map[string]json.RawMessage, id string) (mediaTagDocument, error) {
	d := mediaTagDocument{Raw: raw, Tags: map[string]string{}, TagIDs: map[string]string{}}
	if raw == nil {
		return d, errors.New("Incomplete media item metadata")
	}
	seen := map[string]bool{}
	for key := range raw {
		k := strings.ToLower(key)
		if seen[k] {
			return d, errors.New("Ambiguous media item metadata")
		}
		seen[k] = true
	}
	b, e := json.Marshal(raw)
	if e != nil {
		return d, e
	}
	if e = json.Unmarshal(b, &d.Item); e != nil {
		return d, errors.New("Invalid media item metadata")
	}
	if d.Item.Id != id || d.Item.Type != "Movie" && d.Item.Type != "Episode" {
		return d, errors.New("Only exact movie and episode targets can receive tags")
	}
	if name, ok := mediaRawField(raw, "Name"); ok {
		_ = json.Unmarshal(name, &d.Title)
	}
	if d.Title == "" {
		return d, errors.New("Media item has no title")
	}
	add := func(name, tagID string) error {
		name = strings.TrimSpace(name)
		key := strings.ToLower(name)
		if name == "" || len(name) > 512 || strings.ContainsAny(name, "\x00\r\n") {
			return errors.New("Invalid media tag name")
		}
		if old, ok := d.Tags[key]; ok && old != name {
			return errors.New("Media tags differ only by letter case")
		}
		d.Tags[key], d.TagIDs[key] = name, tagID
		return nil
	}
	if tags, ok := mediaRawField(raw, "Tags"); ok && string(tags) != "null" {
		var values []string
		if e := json.Unmarshal(tags, &values); e != nil {
			return d, errors.New("Invalid media tag list")
		}
		for _, value := range values {
			if e := add(value, ""); e != nil {
				return d, e
			}
		}
	} else if _, ok := mediaRawField(raw, "TagItems"); !ok {
		return d, errors.New("Media item did not expose its current tags")
	}
	if tags, ok := mediaRawField(raw, "TagItems"); ok && string(tags) != "null" {
		var values []struct {
			Name string
			Id   json.RawMessage
		}
		if e := json.Unmarshal(tags, &values); e != nil {
			return d, errors.New("Invalid media tag identifiers")
		}
		for _, value := range values {
			var id string
			if len(value.Id) > 0 && string(value.Id) != "null" {
				if json.Unmarshal(value.Id, &id) != nil {
					var n json.Number
					if json.Unmarshal(value.Id, &n) != nil {
						return d, errors.New("Invalid media tag identifier")
					}
					id = n.String()
				}
			}
			if e := add(value.Name, id); e != nil {
				return d, e
			}
		}
	}
	if len(d.Tags) > 2048 {
		return d, errors.New("Media item has too many tags")
	}
	d.Stamp = mediaDocumentStamp(raw)
	return d, nil
}

func (c *mediaTagClient) readItems(ctx context.Context, ids []string) (map[string]mediaTagDocument, error) {
	if len(ids) == 0 || len(ids) > 100 || len(strings.Join(ids, ",")) > 5000 {
		return nil, errors.New("Invalid media metadata batch")
	}
	expected := map[string]bool{}
	for _, id := range ids {
		if !safeMediaID(id) || expected[id] {
			return nil, errors.New("Invalid or duplicate media item ID")
		}
		expected[id] = true
	}
	var page struct {
		Items            []map[string]json.RawMessage
		TotalRecordCount *int
	}
	q := url.Values{"Ids": {strings.Join(ids, ",")}, "Fields": {mediaTagFields}, "EnableImages": {"false"}, "EnableUserData": {"false"}, "EnableTotalRecordCount": {"true"}, "Limit": {strconv.Itoa(len(ids))}}
	if e := c.get(ctx, "Items", q, &page); e != nil {
		return nil, e
	}
	if page.Items == nil || page.TotalRecordCount == nil || *page.TotalRecordCount != len(page.Items) || len(page.Items) > len(ids) {
		return nil, errors.New("Incomplete media metadata batch")
	}
	out := map[string]mediaTagDocument{}
	for _, raw := range page.Items {
		value, ok := mediaRawField(raw, "Id")
		var id string
		if !ok || json.Unmarshal(value, &id) != nil || !expected[id] {
			return nil, errors.New("Media metadata batch contained an unexpected item")
		}
		if _, duplicate := out[id]; duplicate {
			return nil, errors.New("Media metadata batch contained duplicate items")
		}
		d, e := parseMediaTagDocument(raw, id)
		if e != nil {
			return nil, e
		}
		out[id] = d
	}
	return out, nil
}

func (c *mediaTagClient) readItem(ctx context.Context, id string) (mediaTagDocument, error) {
	items, e := c.readItems(ctx, []string{id})
	if e != nil {
		return mediaTagDocument{}, e
	}
	d, ok := items[id]
	if !ok {
		return mediaTagDocument{}, ErrArrNotFound
	}
	return d, nil
}

func (c *mediaTagClient) post(ctx context.Context, id, action string, body any) error {
	if !safeMediaID(id) || c.kind == "emby" && action != "Tags/Add" && action != "Tags/Delete" || c.kind == "jellyfin" && action != "" || c.kind != "emby" && c.kind != "jellyfin" {
		return errors.New("Media tag write endpoint is not allowed")
	}
	path := "/Items/" + id
	if action != "" {
		path += "/" + action
	}
	b, e := json.Marshal(body)
	if e != nil {
		return e
	}
	req, e := http.NewRequestWithContext(ctx, http.MethodPost, c.base+path, bytes.NewReader(b))
	if e != nil {
		return errors.New("Could not create media tag request")
	}
	req.Header.Set("X-Emby-Token", c.transport.Key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	res, e := c.transport.HTTP.Do(req)
	if e != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return errors.New("Media tag update failed; its result must be checked before retrying")
	}
	defer res.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(res.Body, 4096))
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("Media tag update returned HTTP %d", res.StatusCode)
	}
	return nil
}

func mediaTagNames(tags map[string]string) []string {
	out := make([]string, 0, len(tags))
	for _, v := range tags {
		out = append(out, v)
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i]) < strings.ToLower(out[j]) })
	return out
}

func mediaTagsEqual(a, b map[string]string) bool {
	if len(a) != len(b) {
		return false
	}
	for k := range a {
		if _, ok := b[k]; !ok {
			return false
		}
	}
	return true
}

func jellyfinTagPayload(d mediaTagDocument, tags map[string]string) (map[string]json.RawMessage, error) {
	// The Jellyfin update route is broad, not PATCH. The requested fields must
	// include complete editor collections and locking values before any write.
	for _, field := range []string{"Id", "Name", "Type", "Tags", "Genres", "ProviderIds", "LockData"} {
		raw, ok := mediaRawField(d.Raw, field)
		if !ok || string(raw) == "null" {
			return nil, fmt.Errorf("Media metadata is incomplete for a safe tag update (%s)", field)
		}
	}
	var lock bool
	raw, _ := mediaRawField(d.Raw, "LockData")
	if json.Unmarshal(raw, &lock) != nil {
		return nil, errors.New("Invalid media metadata lock")
	}
	for _, field := range []string{"Genres"} {
		raw, _ := mediaRawField(d.Raw, field)
		var list []json.RawMessage
		if json.Unmarshal(raw, &list) != nil {
			return nil, errors.New("Invalid media metadata collection")
		}
	}
	raw, _ = mediaRawField(d.Raw, "ProviderIds")
	var providers map[string]string
	if json.Unmarshal(raw, &providers) != nil || providers == nil {
		return nil, errors.New("Invalid media provider identifiers")
	}
	out := map[string]json.RawMessage{}
	for k, v := range d.Raw {
		out[k] = v
	}
	for k := range out {
		// These controller branches mutate only non-null inputs. Omitting
		// unrelated collections preserves richer server-side objects (notably
		// cast SortOrder, which the update DTO otherwise discards).
		if strings.EqualFold(k, "Tags") || strings.EqualFold(k, "People") || strings.EqualFold(k, "Studios") || strings.EqualFold(k, "Taglines") || strings.EqualFold(k, "ProductionLocations") || strings.EqualFold(k, "LockedFields") || strings.EqualFold(k, "DateCreated") || strings.EqualFold(k, "AlbumArtists") || strings.EqualFold(k, "ArtistItems") {
			delete(out, k)
		}
	}
	out["Tags"], _ = json.Marshal(mediaTagNames(tags))
	return out, nil
}

func mediaMetadataUnchanged(before, after mediaTagDocument) bool {
	// Server-derived dates/ETags may advance after a metadata edit. Everything
	// explicitly writable by the supported movie/episode controllers is checked.
	fields := []string{"Id", "Name", "Type", "OriginalTitle", "OriginalLanguage", "ForcedSortName", "CriticRating", "CommunityRating", "IndexNumber", "ParentIndexNumber", "Overview", "Genres", "AirsAfterSeasonNumber", "AirsBeforeEpisodeNumber", "AirsBeforeSeasonNumber", "Taglines", "Studios", "DateCreated", "EndDate", "PremiereDate", "ProductionYear", "OfficialRating", "CustomRating", "ProductionLocations", "PreferredMetadataCountryCode", "PreferredMetadataLanguage", "AspectRatio", "LockData", "LockedFields", "ProviderIds", "Video3DFormat", "People"}
	for _, field := range fields {
		a, oka := mediaRawField(before.Raw, field)
		b, okb := mediaRawField(after.Raw, field)
		if !oka && (!okb || string(b) == "null") || !okb && string(a) == "null" {
			continue
		}
		var av, bv any
		if json.Unmarshal(a, &av) != nil || json.Unmarshal(b, &bv) != nil {
			return false
		}
		ar, _ := json.Marshal(av)
		br, _ := json.Marshal(bv)
		if !bytes.Equal(ar, br) {
			return false
		}
	}
	return true
}

func (c *mediaTagClient) update(ctx context.Context, before mediaTagDocument, wanted map[string]string) error {
	if mediaTagsEqual(before.Tags, wanted) {
		return nil
	}
	if c.kind == "jellyfin" {
		body, e := jellyfinTagPayload(before, wanted)
		if e != nil {
			return e
		}
		if e = c.post(ctx, before.Item.Id, "", body); e != nil {
			return e
		}
	} else {
		pairs := func(keys []string) []map[string]string {
			out := []map[string]string{}
			for _, key := range keys {
				pair := map[string]string{"Name": before.Tags[key]}
				if pair["Name"] == "" {
					pair["Name"] = wanted[key]
				}
				if id := before.TagIDs[key]; id != "" {
					pair["Id"] = id
				}
				out = append(out, pair)
			}
			return out
		}
		add, remove := []string{}, []string{}
		for k := range wanted {
			if _, ok := before.Tags[k]; !ok {
				add = append(add, k)
			}
		}
		for k := range before.Tags {
			if _, ok := wanted[k]; !ok {
				remove = append(remove, k)
			}
		}
		sort.Strings(add)
		sort.Strings(remove)
		if len(add) > 0 {
			if e := c.post(ctx, before.Item.Id, "Tags/Add", map[string]any{"Tags": pairs(add)}); e != nil {
				return e
			}
		}
		if len(remove) > 0 {
			if e := c.post(ctx, before.Item.Id, "Tags/Delete", map[string]any{"Tags": pairs(remove)}); e != nil {
				return e
			}
		}
	}
	after, e := c.readItem(ctx, before.Item.Id)
	if e != nil {
		return e
	}
	if !mediaTagsEqual(after.Tags, wanted) {
		return errors.New("Media tag update could not be verified")
	}
	if !mediaMetadataUnchanged(before, after) {
		return errors.New("Media metadata changed during the tag update; synchronization stopped")
	}
	return nil
}
