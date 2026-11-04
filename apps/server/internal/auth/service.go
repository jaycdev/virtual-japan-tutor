package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// Sentinel errors. The HTTP layer maps them to responses; callers match with errors.Is.
var (
	// ErrInvalidCredentials is returned for an unknown user and a wrong password alike.
	ErrInvalidCredentials = errors.New("invalid username or password")
	// ErrUnauthenticated means there is no valid session (missing, unknown, expired or logged out).
	ErrUnauthenticated = errors.New("unauthenticated")
	// ErrInvalidInput wraps validation failures when creating users.
	ErrInvalidInput = errors.New("invalid input")
	// ErrUsernameTaken is returned when a (case-insensitively) equal username exists.
	ErrUsernameTaken = errors.New("username already taken")
	// ErrNotFound is the Store's "no such row" error.
	ErrNotFound = errors.New("not found")
)

// LockedError is returned while a username is locked out after repeated failures.
type LockedError struct{ RetryAfter time.Duration }

func (e *LockedError) Error() string {
	return fmt.Sprintf("too many failed login attempts; retry in %s", e.RetryAfter.Round(time.Second))
}

// User is the authenticated principal. ID is what every domain table's user_id refers to.
type User struct {
	ID       uuid.UUID
	Username string
}

// Session is what Login hands to the client. Token is shown once; only its hash is stored.
type Session struct {
	Token     string
	ExpiresAt time.Time
	User      User
}

// Store persists users and sessions. Session keys are SHA-256 hashes of the bearer token.
type Store interface {
	// CreateUser inserts a user; ErrUsernameTaken on a case-insensitive duplicate.
	CreateUser(ctx context.Context, username, passwordHash string) (User, error)
	// CreateFirstUser inserts a user only if the users table is empty (race-safe).
	CreateFirstUser(ctx context.Context, username, passwordHash string) (user User, created bool, err error)
	// UserByUsername looks a user up case-insensitively; ErrNotFound if absent.
	UserByUsername(ctx context.Context, username string) (user User, passwordHash string, err error)
	CreateSession(ctx context.Context, tokenHash []byte, userID uuid.UUID, createdAt, expiresAt time.Time) error
	// SessionUser returns the owner of an unexpired session and records last use;
	// ErrNotFound if the session is unknown or expired at now.
	SessionUser(ctx context.Context, tokenHash []byte, now time.Time) (User, error)
	DeleteSession(ctx context.Context, tokenHash []byte) error
}

// Login brute-force protection defaults.
const (
	DefaultMaxFailures = 5
	DefaultLockBase    = 30 * time.Second
	DefaultLockMax     = 15 * time.Minute

	maxPasswordBytes = 1024
	minPasswordRunes = 10
	maxUsernameRunes = 64
	// DefaultMaxTracked bounds how many usernames the failure table remembers.
	DefaultMaxTracked = 10_000
)

// Options configures a Service. Zero values select defaults (TTL has none: it is required).
type Options struct {
	// TTL is how long a session lasts from login.
	TTL time.Duration
	// Now is the clock (default time.Now); tests inject their own.
	Now func() time.Time
	// MaxFailures consecutive failures lock a username out (default 5).
	MaxFailures int
	// MaxTracked caps how many usernames the failure table holds (default 10,000); when
	// full, the oldest entries (unlocked ones first) are evicted.
	MaxTracked int
	// LockBase is the first lockout; each further failure doubles it up to LockMax.
	LockBase, LockMax time.Duration
	// PasswordParams is the argon2id cost for new hashes. Any zero field selects the
	// production default for that field; tests set cheaper values. Stored hashes keep their own costs.
	PasswordParams PasswordParams
}

// Service implements login, session authentication and user creation.
type Service struct {
	store Store
	opts  Options

	dummyOnce sync.Once
	dummyHash string

	mu       sync.Mutex
	failures map[string]*failureState // in memory: resets on restart, per replica
}

type failureState struct {
	count       int
	lockedUntil time.Time
	last        time.Time
}

// NewService builds a Service over store.
func NewService(store Store, opts Options) *Service {
	if opts.Now == nil {
		opts.Now = time.Now
	}
	if opts.MaxFailures <= 0 {
		opts.MaxFailures = DefaultMaxFailures
	}
	if opts.MaxTracked <= 0 {
		opts.MaxTracked = DefaultMaxTracked
	}
	if opts.LockBase <= 0 {
		opts.LockBase = DefaultLockBase
	}
	if opts.LockMax <= 0 {
		opts.LockMax = DefaultLockMax
	}
	// Per field, so a partly filled value can never reach argon2 with a zero (it panics).
	if opts.PasswordParams.MemoryKiB == 0 {
		opts.PasswordParams.MemoryKiB = defaultPasswordParams.MemoryKiB
	}
	if opts.PasswordParams.Time == 0 {
		opts.PasswordParams.Time = defaultPasswordParams.Time
	}
	if opts.PasswordParams.Threads == 0 {
		opts.PasswordParams.Threads = defaultPasswordParams.Threads
	}
	return &Service{store: store, opts: opts, failures: map[string]*failureState{}}
}

// Login verifies the credentials and starts a session.
func (s *Service) Login(ctx context.Context, username, password string) (Session, error) {
	// One normalised name serves both the lookup and the lockout table, so every spelling
	// of an account ("Alice", " alice ") hits the same row and the same counter.
	key := nameKey(username)
	now := s.opts.Now()
	if wait := s.lockedFor(key, now); wait > 0 {
		return Session{}, &LockedError{RetryAfter: wait}
	}
	// Over-length passwords are refused before the user is looked up, so known and unknown
	// usernames take exactly the same path (no hash is computed for either).
	if len(password) > maxPasswordBytes {
		s.recordFailure(key, now)
		return Session{}, ErrInvalidCredentials
	}

	user, hash, err := s.store.UserByUsername(ctx, key)
	switch {
	case errors.Is(err, ErrNotFound):
		// Spend the same CPU as a real check so timing does not reveal the username.
		_, _ = VerifyPassword(password, s.dummy())
		s.recordFailure(key, now)
		return Session{}, ErrInvalidCredentials
	case err != nil:
		return Session{}, err
	}

	ok, err := VerifyPassword(password, hash)
	if err != nil {
		return Session{}, fmt.Errorf("verify password for user %s: %w", user.ID, err)
	}
	if !ok {
		s.recordFailure(key, now)
		return Session{}, ErrInvalidCredentials
	}
	s.clearFailures(key)

	token, tokenHash, err := newToken()
	if err != nil {
		return Session{}, err
	}
	expires := now.Add(s.opts.TTL)
	if err := s.store.CreateSession(ctx, tokenHash, user.ID, now, expires); err != nil {
		return Session{}, err
	}
	return Session{Token: token, ExpiresAt: expires, User: user}, nil
}

// Authenticate resolves a bearer token to an Identity, or ErrUnauthenticated.
func (s *Service) Authenticate(ctx context.Context, token string) (Identity, error) {
	if token == "" {
		return Identity{}, ErrUnauthenticated
	}
	hash := hashToken(token)
	user, err := s.store.SessionUser(ctx, hash, s.opts.Now())
	if errors.Is(err, ErrNotFound) {
		return Identity{}, ErrUnauthenticated
	}
	if err != nil {
		return Identity{}, err
	}
	return Identity{User: user, sessionKey: hash}, nil
}

// Logout deletes the session behind the Identity in ctx.
func (s *Service) Logout(ctx context.Context) error {
	id, ok := IdentityFrom(ctx)
	if !ok {
		return ErrUnauthenticated
	}
	return s.store.DeleteSession(ctx, id.sessionKey)
}

// CreateUser validates input, hashes the password and inserts the user.
func (s *Service) CreateUser(ctx context.Context, username, password string) (User, error) {
	if err := validateCredentials(username, password); err != nil {
		return User{}, err
	}
	hash, err := hashPassword(password, s.opts.PasswordParams)
	if err != nil {
		return User{}, err
	}
	return s.store.CreateUser(ctx, username, hash)
}

// Bootstrap creates the first account, but only if no user exists yet. It reports
// whether it created one. Safe to call on every boot and under concurrent replicas.
func (s *Service) Bootstrap(ctx context.Context, username, password string) (bool, error) {
	if err := validateCredentials(username, password); err != nil {
		return false, err
	}
	hash, err := hashPassword(password, s.opts.PasswordParams)
	if err != nil {
		return false, err
	}
	_, created, err := s.store.CreateFirstUser(ctx, username, hash)
	return created, err
}

// ValidateCredentials checks the same username/password rules CreateUser enforces,
// without touching the store (used to fail fast on bad bootstrap config).
func ValidateCredentials(username, password string) error {
	return validateCredentials(username, password)
}

func validateCredentials(username, password string) error {
	if n := utf8.RuneCountInString(username); n == 0 || n > maxUsernameRunes {
		return fmt.Errorf("%w: username must be 1-%d characters", ErrInvalidInput, maxUsernameRunes)
	}
	for _, r := range username {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return fmt.Errorf("%w: username must not contain whitespace or control characters", ErrInvalidInput)
		}
	}
	if utf8.RuneCountInString(password) < minPasswordRunes {
		return fmt.Errorf("%w: password must be at least %d characters", ErrInvalidInput, minPasswordRunes)
	}
	if len(password) > maxPasswordBytes {
		return fmt.Errorf("%w: password must be at most %d bytes", ErrInvalidInput, maxPasswordBytes)
	}
	return nil
}

func (s *Service) dummy() string {
	s.dummyOnce.Do(func() {
		var junk [16]byte
		_, _ = rand.Read(junk[:])
		s.dummyHash, _ = hashPassword(base64.RawStdEncoding.EncodeToString(junk[:]), s.opts.PasswordParams)
	})
	return s.dummyHash
}

func nameKey(username string) string { return strings.ToLower(strings.TrimSpace(username)) }

// lockedFor returns the remaining lockout for key, or 0.
func (s *Service) lockedFor(key string, now time.Time) time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.failures[key]
	if st == nil {
		return 0
	}
	if now.Before(st.lockedUntil) {
		return st.lockedUntil.Sub(now)
	}
	if now.Sub(st.last) > s.opts.LockMax { // quiet for long enough: forgive
		delete(s.failures, key)
	}
	return 0
}

// recordFailure counts a failure for key (known or not, so locking leaks nothing) and
// locks it out from MaxFailures on, doubling the lock per extra failure.
func (s *Service) recordFailure(key string, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := s.failures[key]
	if st == nil {
		s.makeRoom(now)
		st = &failureState{}
		s.failures[key] = st
	}
	st.count++
	st.last = now
	if st.count >= s.opts.MaxFailures {
		shift := min(st.count-s.opts.MaxFailures, 20)
		st.lockedUntil = now.Add(min(s.opts.LockBase<<shift, s.opts.LockMax))
	}
}

func (s *Service) clearFailures(key string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.failures, key)
}

func newToken() (token string, hash []byte, err error) {
	var raw [32]byte // 256 bits
	if _, err := rand.Read(raw[:]); err != nil {
		return "", nil, fmt.Errorf("auth: token: %w", err)
	}
	token = base64.RawURLEncoding.EncodeToString(raw[:])
	return token, hashToken(token), nil
}

func hashToken(token string) []byte {
	sum := sha256.Sum256([]byte(token))
	return sum[:]
}

// makeRoom frees a slot before a new name is tracked, so the table never exceeds MaxTracked
// (a flood of fresh usernames cannot grow memory). Stale entries go first, then the oldest
// unlocked entry, and only if every entry is locked the oldest of those. Caller holds s.mu.
func (s *Service) makeRoom(now time.Time) {
	if len(s.failures) < s.opts.MaxTracked {
		return
	}
	for k, st := range s.failures {
		if now.Sub(st.last) > s.opts.LockMax && !now.Before(st.lockedUntil) {
			delete(s.failures, k)
		}
	}
	for len(s.failures) >= s.opts.MaxTracked {
		var victim string
		var victimState *failureState
		victimLocked := false
		for k, st := range s.failures {
			locked := now.Before(st.lockedUntil)
			better := victimState == nil ||
				(victimLocked && !locked) || // unlocked entries are evicted before locked ones
				(victimLocked == locked && st.last.Before(victimState.last)) // then oldest first
			if better {
				victim, victimState, victimLocked = k, st, locked
			}
		}
		delete(s.failures, victim)
	}
}

// TrackedNames reports how many usernames currently have failure state (diagnostics, tests).
func (s *Service) TrackedNames() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.failures)
}
