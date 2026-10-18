package app

import (
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
)

func infoMask(cfg Settings) int {
	mask := 0
	for _, key := range cfg.ListInfoVisible {
		switch key {
		case "link":
			mask |= 1
		case "media":
			if cfg.enabledMedia() {
				mask |= 16
			}
		case "details":
			mask |= 2
		case "metadata":
			mask |= 4
		case "recognition":
			mask |= 8
		}
	}
	return mask
}
func infoOrderSQL(q url.Values) (string, error) {
	mask := 15
	if q.Get("_infoMask") != "" {
		var e error
		mask, e = strconv.Atoi(q.Get("_infoMask"))
		if e != nil || mask < 0 || mask > 31 {
			return "", errors.New("Invalid Info action mask")
		}
	}
	dir := strings.ToUpper(q.Get("dir"))
	if dir == "" {
		dir = "ASC"
	}
	if dir != "ASC" && dir != "DESC" {
		return "", errors.New("Invalid sort direction")
	}
	constant := 0
	if mask&1 != 0 {
		constant++
	}
	if mask&16 != 0 {
		constant++
	}
	if mask&2 != 0 {
		constant++
	}
	count := "CAST(" + fmt.Sprint(constant) + " AS INTEGER)"
	if mask&4 != 0 {
		count += " + CASE WHEN f.conflict THEN 1 ELSE 0 END"
	}
	if mask&8 != 0 {
		count += " + CASE WHEN f.rule_conflict THEN 1 ELSE 0 END"
	}
	return "(" + count + ") " + dir + ",f.title COLLATE NOCASE ASC,f.id ASC", nil
}
