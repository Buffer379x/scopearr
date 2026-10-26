package app

import "strings"

// A retained confirmation marker is effective only while its selected source
// still supplies a current value. Raw tracks remain available as detail evidence.
func hasActiveFieldConfirmation(f File, field string) bool {
	evidence, ok := f.Evidence[field]
	return ok && evidence.Confirmed != nil && strings.TrimSpace(evidenceSource(evidence, evidence.Confirmed.Source)) != ""
}
