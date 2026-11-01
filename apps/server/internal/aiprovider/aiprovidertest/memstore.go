// Package aiprovidertest provides an in-memory aiprovider.Store for tests.
package aiprovidertest

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
)

// MemStore mirrors the Postgres store's behaviour (the store contract test runs against
// both, which keeps this fake honest).
type MemStore struct {
	mu          sync.Mutex
	providers   []owned // insertion order = oldest first
	assignments map[assignKey]uuid.UUID
}

type owned struct {
	user uuid.UUID
	rec  aiprovider.Record
}

type assignKey struct {
	user uuid.UUID
	task aiprovider.Task
}

func NewMemStore() *MemStore { return &MemStore{assignments: map[assignKey]uuid.UUID{}} }

// All returns every stored record regardless of owner, for assertions on what is persisted.
func (m *MemStore) All() []aiprovider.Record {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]aiprovider.Record, len(m.providers))
	for i, p := range m.providers {
		out[i] = p.rec
	}
	return out
}

func (m *MemStore) find(user, id uuid.UUID) int {
	for i, p := range m.providers {
		if p.user == user && p.rec.ID == id {
			return i
		}
	}
	return -1
}

func (m *MemStore) nameTaken(user uuid.UUID, name string, except uuid.UUID) bool {
	for _, p := range m.providers {
		if p.user == user && p.rec.ID != except && strings.EqualFold(p.rec.Name, name) {
			return true
		}
	}
	return false
}

func (m *MemStore) List(_ context.Context, user uuid.UUID) ([]aiprovider.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []aiprovider.Record
	for _, p := range m.providers {
		if p.user == user {
			out = append(out, p.rec)
		}
	}
	return out, nil
}

func (m *MemStore) Get(_ context.Context, user, id uuid.UUID) (aiprovider.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if i := m.find(user, id); i >= 0 {
		return m.providers[i].rec, nil
	}
	return aiprovider.Record{}, aiprovider.ErrNotFound
}

func (m *MemStore) Create(_ context.Context, user uuid.UUID, r aiprovider.Record) (aiprovider.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.create(user, r)
}

func (m *MemStore) create(user uuid.UUID, r aiprovider.Record) (aiprovider.Record, error) {
	if m.nameTaken(user, r.Name, uuid.Nil) {
		return aiprovider.Record{}, aiprovider.ErrNameTaken
	}
	now := time.Now()
	r.ID, r.CreatedAt, r.UpdatedAt = uuid.New(), now, now
	m.providers = append(m.providers, owned{user, r})
	return r, nil
}

func (m *MemStore) Update(_ context.Context, user uuid.UUID, r aiprovider.Record) (aiprovider.Record, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	i := m.find(user, r.ID)
	if i < 0 {
		return aiprovider.Record{}, aiprovider.ErrNotFound
	}
	if m.nameTaken(user, r.Name, r.ID) {
		return aiprovider.Record{}, aiprovider.ErrNameTaken
	}
	cur := m.providers[i].rec
	cur.Name, cur.BaseURL, cur.APIKeyEncrypted, cur.Model, cur.UpdatedAt = r.Name, r.BaseURL, r.APIKeyEncrypted, r.Model, time.Now()
	m.providers[i].rec = cur
	return cur, nil
}

func (m *MemStore) Delete(_ context.Context, user, id uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	i := m.find(user, id)
	if i < 0 {
		return aiprovider.ErrNotFound
	}
	for k, pid := range m.assignments {
		if k.user == user && pid == id {
			return aiprovider.ErrInUse
		}
	}
	m.providers = append(m.providers[:i], m.providers[i+1:]...)
	return nil
}

func (m *MemStore) Assignments(_ context.Context, user uuid.UUID) (map[aiprovider.Task]uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := map[aiprovider.Task]uuid.UUID{}
	for k, id := range m.assignments {
		if k.user == user {
			out[k.task] = id
		}
	}
	return out, nil
}

func (m *MemStore) Assign(_ context.Context, user uuid.UUID, task aiprovider.Task, providerID *uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if providerID == nil {
		delete(m.assignments, assignKey{user, task})
		return nil
	}
	if m.find(user, *providerID) < 0 {
		return aiprovider.ErrNotFound
	}
	m.assignments[assignKey{user, task}] = *providerID
	return nil
}

func (m *MemStore) CreateDefaultIfNone(_ context.Context, user uuid.UUID, r aiprovider.Record, tasks []aiprovider.Task) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for _, p := range m.providers {
		if p.user == user {
			return false, nil
		}
	}
	rec, err := m.create(user, r)
	if err != nil {
		return false, err
	}
	for _, t := range tasks {
		m.assignments[assignKey{user, t}] = rec.ID
	}
	return true, nil
}
