package auth_test

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
)

// memStore is a test-only in-memory auth.Store. storeContract (store_contract_test.go)
// runs against it and against the Postgres store, which keeps the fake honest.
type memStore struct {
	mu       sync.Mutex
	users    map[uuid.UUID]memUser
	sessions map[string]memSession // keyed by string(tokenHash)
}

type memUser struct {
	auth.User
	hash string
}

type memSession struct {
	userID    uuid.UUID
	expiresAt time.Time
}

func newMemStore() *memStore {
	return &memStore{users: map[uuid.UUID]memUser{}, sessions: map[string]memSession{}}
}

func (m *memStore) usernameTaken(name string) bool {
	for _, u := range m.users {
		if strings.EqualFold(u.Username, name) {
			return true
		}
	}
	return false
}

func (m *memStore) CreateUser(_ context.Context, username, hash string) (auth.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.usernameTaken(username) {
		return auth.User{}, auth.ErrUsernameTaken
	}
	u := auth.User{ID: uuid.New(), Username: username}
	m.users[u.ID] = memUser{User: u, hash: hash}
	return u, nil
}

func (m *memStore) CreateFirstUser(_ context.Context, username, hash string) (auth.User, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.users) > 0 {
		return auth.User{}, false, nil
	}
	u := auth.User{ID: uuid.New(), Username: username}
	m.users[u.ID] = memUser{User: u, hash: hash}
	return u, true, nil
}

func (m *memStore) UserByUsername(_ context.Context, username string) (auth.User, string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, u := range m.users {
		if strings.EqualFold(u.Username, username) {
			return u.User, u.hash, nil
		}
	}
	return auth.User{}, "", auth.ErrNotFound
}

func (m *memStore) CreateSession(_ context.Context, tokenHash []byte, userID uuid.UUID, _ time.Time, expiresAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[string(tokenHash)] = memSession{userID: userID, expiresAt: expiresAt}
	return nil
}

func (m *memStore) SessionUser(_ context.Context, tokenHash []byte, now time.Time) (auth.User, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	s, ok := m.sessions[string(tokenHash)]
	if !ok || !now.Before(s.expiresAt) {
		return auth.User{}, auth.ErrNotFound
	}
	return m.users[s.userID].User, nil
}

func (m *memStore) DeleteSession(_ context.Context, tokenHash []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, string(tokenHash))
	return nil
}

// sessionKeys exposes what the store holds, so tests can assert raw tokens are never stored.
func (m *memStore) sessionKeys() [][]byte {
	m.mu.Lock()
	defer m.mu.Unlock()
	var keys [][]byte
	for k := range m.sessions {
		keys = append(keys, []byte(k))
	}
	return keys
}

// fakeClock is a controllable time source for expiry and lockout tests.
type fakeClock struct {
	mu sync.Mutex
	t  time.Time
}

func newFakeClock() *fakeClock {
	return &fakeClock{t: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)}
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.t = c.t.Add(d)
}
