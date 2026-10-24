package app

import (
	"errors"
	"net/http"
)

func (s *Server) passwordHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != "PUT" {
		failure(w, r, http.StatusMethodNotAllowed, errors.New("Endpoint or method not supported"))
		return
	}
	var in struct {
		Current  string `json:"current"`
		Password string `json:"password"`
	}
	if e := decode(w, r, &in); e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	var c credentials
	s.Store.Get("admin", &c)
	verifiedHash := s.Security.loginHash(c.Username, in.Current, remoteIP(r))
	if verifiedHash == "" {
		failure(w, r, http.StatusUnauthorized, errors.New("Current password is invalid"))
		return
	}
	if s.Demo {
		failure(w, r, http.StatusForbidden, errors.New("Demo password cannot be changed"))
		return
	}
	if e := s.Security.reset(in.Password, verifiedHash); e != nil {
		failure(w, r, http.StatusBadRequest, e)
		return
	}
	s.Store.Events.Info("auth", "", "Password changed", nil, c.Username)
	jsonOut(w, http.StatusOK, map[string]bool{"ok": true})
}
