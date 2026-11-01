// Package masterytest provides an in-memory test double for mastery.Store.
// Like knowngrammartest and marumoritest it is only ever imported from tests.
// The Store is read-only, so the double exposes direct fixture methods rather
// than write-side mirrors.
package masterytest

import (
	"context"
	"sort"
	"sync"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
)

// MemStore is a canned mastery.Store. Reads and writes are safe for concurrent
// use; exported maps let tests assert state directly.
type MemStore struct {
	mu sync.Mutex

	Items    map[uuid.UUID][]mastery.KnownItem
	Trends   map[uuid.UUID][]mastery.LevelTrend
	Practice map[uuid.UUID][]mastery.PracticeRecord
	Signals  map[uuid.UUID][]mastery.WeakSignalRecord
}

var _ mastery.Store = (*MemStore)(nil)

func NewMemStore() *MemStore {
	return &MemStore{
		Items:    map[uuid.UUID][]mastery.KnownItem{},
		Trends:   map[uuid.UUID][]mastery.LevelTrend{},
		Practice: map[uuid.UUID][]mastery.PracticeRecord{},
		Signals:  map[uuid.UUID][]mastery.WeakSignalRecord{},
	}
}

// AddKnownItem, AddTrend, AddPractice and AddSignal are fixtures for tests.
func (m *MemStore) AddKnownItem(userID uuid.UUID, it mastery.KnownItem) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Items[userID] = append(m.Items[userID], it)
}

func (m *MemStore) AddTrend(userID uuid.UUID, t mastery.LevelTrend) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Trends[userID] = append(m.Trends[userID], t)
}

func (m *MemStore) AddPractice(userID uuid.UUID, p mastery.PracticeRecord) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Practice[userID] = append(m.Practice[userID], p)
}

func (m *MemStore) AddSignal(userID uuid.UUID, w mastery.WeakSignalRecord) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Signals[userID] = append(m.Signals[userID], w)
}

func (m *MemStore) KnownItems(ctx context.Context, userID uuid.UUID) ([]mastery.KnownItem, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := append([]mastery.KnownItem(nil), m.Items[userID]...)
	// Deterministic, mirroring the Postgres store's ORDER BY (kind, marumori_id).
	sort.Slice(out, func(i, j int) bool {
		if out[i].Key.Kind != out[j].Key.Kind {
			return out[i].Key.Kind < out[j].Key.Kind
		}
		return out[i].Key.Ref < out[j].Key.Ref
	})
	return out, nil
}

func (m *MemStore) LevelTrends(ctx context.Context, userID uuid.UUID) ([]mastery.LevelTrend, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]mastery.LevelTrend(nil), m.Trends[userID]...), nil
}

func (m *MemStore) PracticeResults(ctx context.Context, userID uuid.UUID) ([]mastery.PracticeRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := append([]mastery.PracticeRecord(nil), m.Practice[userID]...)
	sort.Slice(out, func(i, j int) bool { return out[i].AnsweredAt.Before(out[j].AnsweredAt) })
	return out, nil
}

func (m *MemStore) WeakSignals(ctx context.Context, userID uuid.UUID) ([]mastery.WeakSignalRecord, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := append([]mastery.WeakSignalRecord(nil), m.Signals[userID]...)
	sort.Slice(out, func(i, j int) bool { return out[i].OccurredAt.Before(out[j].OccurredAt) })
	return out, nil
}
