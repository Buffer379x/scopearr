package app

// APIInfo contains immutable scalar values. EnrichWithRules replaces the
// pointer with a new value; reparsing and provider enrichment first copy it.
// Share equal snapshots between phases without sharing mutable evidence maps.
// The fixed bound also handles libraries with unusually varied metadata.
func shareSnapshotAPIInfo(files []File) int {
	const limit = 4096
	values := map[APIInfo]*APIInfo{}
	for i := range files {
		current := files[i].APIInfo
		if current == nil {
			continue
		}
		if existing, ok := values[*current]; ok {
			files[i].APIInfo = existing
		} else if len(values) < limit {
			values[*current] = current
		}
	}
	return len(values)
}
