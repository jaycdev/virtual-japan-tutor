package practice

import (
	"context"
	"sync"
	"time"
)

// MemStore is the current SessionStore: sessions live in process memory and
// expire SessionTTL after they start. A session survives reloads of the web
// UI but not a server restart — acceptable for short-lived Practice Sessions,
// and a Postgres-backed store can replace it behind the interface later.
type MemStore struct {
	mu    sync.Mutex
	now   func() time.Time
	ttl   time.Duration
	cells map[string]memSession
}

type memSession struct {
	sess      *Session
	expiresAt time.Time
}

var _ SessionStore = (*MemStore)(nil)

// NewMemStore returns a store with the given TTL (0 → DefaultSessionTTL).
func NewMemStore(ttl time.Duration) *MemStore {
	if ttl <= 0 {
		ttl = DefaultSessionTTL
	}
	return &MemStore{now: time.Now, ttl: ttl, cells: map[string]memSession{}}
}

// WithClock overrides the expiry clock (tests).
func (m *MemStore) WithClock(now func() time.Time) *MemStore {
	m.now = now
	return m
}

func (m *MemStore) Put(ctx context.Context, sess *Session) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cells == nil {
		m.cells = map[string]memSession{}
	}
	now := m.now()
	// Lazy sweep: drop what expired, so a long-lived server does not grow.
	for id, cell := range m.cells {
		if !cell.expiresAt.After(now) {
			delete(m.cells, id)
		}
	}
	m.cells[sess.ID] = memSession{sess: sess.clone(), expiresAt: sess.CreatedAt.Add(m.ttl)}
	return nil
}

func (m *MemStore) Get(ctx context.Context, id string) (*Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	cell, ok := m.cells[id]
	if !ok {
		return nil, ErrSessionNotFound
	}
	if !cell.expiresAt.After(m.now()) {
		delete(m.cells, id)
		return nil, ErrSessionNotFound
	}
	return cell.sess.clone(), nil
}
