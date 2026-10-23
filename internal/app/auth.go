package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/bcrypt"
)

type credentials struct {
	Username string `json:"username"`
	Hash     string `json:"hash"`
}
type attempt struct {
	Count int
	Until time.Time
}
type Security struct {
	store          *Store
	aead           cipher.AEAD
	setupToken     string
	mu             sync.Mutex
	attempts       map[string]attempt
	passwordChecks chan struct{}
}

func NewSecurity(s *Store) (*Security, error) {
	p := filepath.Join(s.Dir, "secret.key")
	key, e := os.ReadFile(p)
	if os.IsNotExist(e) {
		key = make([]byte, 32)
		if _, e = rand.Read(key); e != nil {
			return nil, e
		}
		e = os.WriteFile(p, key, 0600)
	}
	if e != nil {
		return nil, e
	}
	block, e := aes.NewCipher(key)
	if e != nil {
		return nil, e
	}
	a, e := cipher.NewGCM(block)
	if e != nil {
		return nil, e
	}
	sec := &Security{store: s, aead: a, attempts: map[string]attempt{}, passwordChecks: make(chan struct{}, 2)}
	if !sec.Initialized() {
		p := filepath.Join(s.Dir, "setup-token")
		t, e := os.ReadFile(p)
		if os.IsNotExist(e) {
			t = []byte(randomToken())
			e = os.WriteFile(p, t, 0600)
		}
		if e != nil {
			return nil, e
		}
		sec.setupToken = strings.TrimSpace(string(t))
	}
	return sec, nil
}
func randomToken() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func tokenHash(s string) string { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func (s *Security) Initialized() bool {
	var c credentials
	return s.store.Get("admin", &c) == nil && c.Hash != ""
}
func (s *Security) Seal(v string) string {
	if v == "" {
		return ""
	}
	n := make([]byte, s.aead.NonceSize())
	rand.Read(n)
	return "enc:" + base64.StdEncoding.EncodeToString(s.aead.Seal(n, n, []byte(v), []byte("scopearr-api-key-v1")))
}
func (s *Security) Open(v string) (string, error) {
	if v == "" {
		return "", nil
	}
	if !strings.HasPrefix(v, "enc:") {
		return "", fmt.Errorf("Invalid encrypted API key")
	}
	b, e := base64.StdEncoding.DecodeString(strings.TrimPrefix(v, "enc:"))
	if e != nil || len(b) < s.aead.NonceSize() {
		return "", fmt.Errorf("Could not decrypt API key")
	}
	n := s.aead.NonceSize()
	p, e := s.aead.Open(nil, b[:n], b[n:], []byte("scopearr-api-key-v1"))
	if e != nil {
		p, e = s.aead.Open(nil, b[:n], b[n:], []byte("arrscope-api-key-v1"))
	}
	return string(p), e
}
func validPassword(p string) bool { return len(p) >= 12 && len(p) <= 72 }
func (s *Security) Setup(user, password, token string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Initialized() {
		return fmt.Errorf("Already configured")
	}
	if s.setupToken == "" || subtle.ConstantTimeCompare([]byte(token), []byte(s.setupToken)) != 1 {
		return fmt.Errorf("Setup code is invalid")
	}
	if len(strings.TrimSpace(user)) < 2 || len(user) > 64 || !validPassword(password) {
		return fmt.Errorf("Username requires 2 characters; password requires 12–72 UTF-8 bytes")
	}
	h, e := bcrypt.GenerateFromPassword([]byte(password), 12)
	if e != nil {
		return e
	}
	c := credentials{strings.TrimSpace(user), string(h)}
	b, _ := json.Marshal(c)
	if _, e = s.store.DB.Exec("INSERT INTO kv(key,value) VALUES('admin',?)", string(b)); e != nil {
		return e
	}
	os.Remove(filepath.Join(s.store.Dir, "setup-token"))
	s.setupToken = ""
	return nil
}

// The verified hash guards session creation against a concurrent password reset,
// including reset-password in another process sharing the database.
func (s *Security) loginHash(user, password, ip string) string {
	select {
	case s.passwordChecks <- struct{}{}:
		defer func() { <-s.passwordChecks }()
	default:
		return ""
	}
	now := time.Now()
	s.mu.Lock()
	a := s.attempts[ip]
	if now.Before(a.Until) && a.Count >= 5 {
		s.mu.Unlock()
		return ""
	}
	if !now.Before(a.Until) {
		a = attempt{Until: now.Add(15 * time.Minute)}
	}
	if len(s.attempts) >= 10000 {
		for k, v := range s.attempts {
			if !now.Before(v.Until) {
				delete(s.attempts, k)
			}
		}
		if _, exists := s.attempts[ip]; !exists && len(s.attempts) >= 10000 {
			s.mu.Unlock()
			return ""
		}
	}
	// Reserve this attempt before releasing the lock so parallel failures
	// cannot exceed the per-address limit while bcrypt is running.
	a.Count++
	s.attempts[ip] = a
	s.mu.Unlock()
	var c credentials
	if s.store.Get("admin", &c) != nil || bcrypt.CompareHashAndPassword([]byte(c.Hash), []byte(password)) != nil || c.Username != user {
		return ""
	}
	s.mu.Lock()
	delete(s.attempts, ip)
	s.mu.Unlock()
	return c.Hash
}
func remoteIP(r *http.Request) string {
	h, _, e := net.SplitHostPort(r.RemoteAddr)
	if e != nil {
		return r.RemoteAddr
	}
	return h
}

const sessionWindow = 7 * 24 * time.Hour
const sessionMaximum = 30 * 24 * time.Hour

type sessionState struct {
	hash, csrf       string
	expires, created int64
	valid            bool
}

func (s *Security) readSession(r *http.Request) (sessionState, error) {
	c, e := r.Cookie("scopearr_session")
	if e != nil {
		return sessionState{}, nil
	}
	state := sessionState{hash: tokenHash(c.Value)}
	e = s.store.DB.QueryRowContext(r.Context(), "SELECT csrf,expires,created FROM sessions WHERE token=?", state.hash).Scan(&state.csrf, &state.expires, &state.created)
	if errors.Is(e, sql.ErrNoRows) {
		return sessionState{}, nil
	}
	if e != nil {
		return sessionState{}, e
	}
	if state.created == 0 {
		state.created = state.expires - int64((24*time.Hour)/time.Second)
	}
	now := time.Now().Unix()
	state.valid = now < state.expires && now < state.created+int64(sessionMaximum/time.Second)
	return state, nil
}
func (s *Security) Session(r *http.Request) (string, string, bool, error) {
	state, e := s.readSession(r)
	return state.hash, state.csrf, state.valid, e
}
func sessionCookie(w http.ResponseWriter, r *http.Request, token string, seconds int) {
	http.SetCookie(w, &http.Cookie{Name: "scopearr_session", Value: token, Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: r.TLS != nil || os.Getenv("SCOPEARR_HTTPS") == "true", MaxAge: seconds})
}
func (s *Security) renewSession(w http.ResponseWriter, r *http.Request, state sessionState) {
	now := time.Now().Unix()
	expires := min(now+int64(sessionWindow/time.Second), state.created+int64(sessionMaximum/time.Second))
	if !state.valid || state.expires >= now+int64((sessionWindow-time.Hour)/time.Second) || expires <= state.expires {
		return
	}
	// Compare the old expiry so concurrent requests renew only once. An unavailable
	// writer leaves the valid session and current request intact.
	result, e := s.store.DB.ExecContext(r.Context(), "UPDATE sessions SET expires=?,created=? WHERE token=? AND expires=?", expires, state.created, state.hash, state.expires)
	if e != nil {
		return
	}
	if n, e := result.RowsAffected(); e == nil && n == 1 {
		c, e := r.Cookie("scopearr_session")
		if e == nil {
			sessionCookie(w, r, c.Value, int(expires-now))
		}
	}
}

var errCredentialsChanged = errors.New("Credentials changed; sign in again")

func (s *Security) LoginSession(w http.ResponseWriter, r *http.Request, user, password, ip string) (bool, error) {
	hash := s.loginHash(user, password, ip)
	if hash == "" {
		return false, nil
	}
	err := s.createSession(w, r, hash)
	if errors.Is(err, errCredentialsChanged) {
		return false, nil
	}
	return err == nil, err
}
func (s *Security) CreateSession(w http.ResponseWriter, r *http.Request) error {
	var c credentials
	if err := s.store.Get("admin", &c); err != nil {
		return err
	}
	return s.createSession(w, r, c.Hash)
}
func (s *Security) createSession(w http.ResponseWriter, r *http.Request, verifiedHash string) error {
	token, csrf := randomToken(), randomToken()
	s.store.DB.Exec("DELETE FROM sessions WHERE expires<?", time.Now().Unix())
	result, e := s.store.DB.Exec("INSERT INTO sessions(token,csrf,expires,created) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM kv WHERE key='admin' AND json_extract(value,'$.hash')=?)", tokenHash(token), csrf, time.Now().Add(sessionWindow).Unix(), time.Now().Unix(), verifiedHash)
	if e != nil {
		return e
	}
	if n, err := result.RowsAffected(); err != nil {
		return err
	} else if n != 1 {
		return errCredentialsChanged
	}
	sessionCookie(w, r, token, int(sessionWindow/time.Second))
	return nil
}
func (s *Security) Reset(password string) error { return s.reset(password, "") }
func (s *Security) reset(password, verifiedHash string) error {
	if !validPassword(password) {
		return fmt.Errorf("Password must contain 12–72 UTF-8 bytes")
	}
	var c credentials
	if e := s.store.Get("admin", &c); e != nil {
		return e
	}
	h, e := bcrypt.GenerateFromPassword([]byte(password), 12)
	if e != nil {
		return e
	}
	c.Hash = string(h)
	tx, e := s.store.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	b, e := json.Marshal(c)
	if e != nil {
		return e
	}
	result, e := tx.Exec("UPDATE kv SET value=? WHERE key='admin' AND (?='' OR json_extract(value,'$.hash')=?)", string(b), verifiedHash, verifiedHash)
	if e != nil {
		return e
	}
	if n, err := result.RowsAffected(); err != nil {
		return err
	} else if n != 1 {
		return errCredentialsChanged
	}
	if _, e = tx.Exec("DELETE FROM sessions"); e != nil {
		return e
	}
	return tx.Commit()
}
