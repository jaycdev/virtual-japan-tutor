// Package knowngrammartest provides in-memory test doubles for
// knowngrammar.Store, mirroring how the package's Postgres store behaves. Like
// marumoritest and grammartest it is only ever imported from tests.
package knowngrammartest

import (
	"context"
	"sync"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// MemStore is a canned knowngrammar.Store. Reads and writes are safe for
// concurrent use; exported maps let tests assert state directly.
type MemStore struct {
	mu sync.Mutex

	Levels map[uuid.UUID]refdata.Level
	Known  map[uuid.UUID]map[int64]knowngrammar.KnownPoint
	Obs    map[uuid.UUID]map[string]knowngrammar.Observation
}

var _ knowngrammar.Store = (*MemStore)(nil)

func NewMemStore() *MemStore {
	return &MemStore{
		Levels: map[uuid.UUID]refdata.Level{},
		Known:  map[uuid.UUID]map[int64]knowngrammar.KnownPoint{},
		Obs:    map[uuid.UUID]map[string]knowngrammar.Observation{},
	}
}

func (m *MemStore) StartingLevel(ctx context.Context, userID uuid.UUID) (refdata.Level, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	level, ok := m.Levels[userID]
	return level, ok, nil
}

func (m *MemStore) SetStartingLevel(ctx context.Context, userID uuid.UUID, level refdata.Level) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Levels[userID] = level
	return nil
}

func (m *MemStore) ApplySeededPoints(ctx context.Context, userID uuid.UUID, pointIDs []int64) (knowngrammar.SeededDelta, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	known := m.knownFor(userID)
	want := make(map[int64]bool, len(pointIDs))
	var delta knowngrammar.SeededDelta
	for _, id := range pointIDs {
		want[id] = true
		if _, ok := known[id]; ok {
			delta.Kept++
			continue
		}
		known[id] = knowngrammar.KnownPoint{PointID: id, Source: knowngrammar.SourceSeeded, Mastery: knowngrammar.SeededMastery}
		delta.Added++
	}
	for id, p := range known {
		if !want[id] && p.Source == knowngrammar.SourceSeeded {
			delete(known, id)
			delta.Removed++
		}
	}
	return delta, nil
}

func (m *MemStore) SeededPoints(ctx context.Context, userID uuid.UUID) ([]int64, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []int64
	for id, p := range m.knownFor(userID) {
		if p.Source == knowngrammar.SourceSeeded {
			out = append(out, id)
		}
	}
	return out, nil
}

func (m *MemStore) UpsertObservedPoint(ctx context.Context, userID uuid.UUID, pointID int64) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	known := m.knownFor(userID)
	if p, ok := known[pointID]; ok {
		p.Source = knowngrammar.SourceObserved // Mastery is practice-owned: keep it.
		known[pointID] = p
		return nil
	}
	known[pointID] = knowngrammar.KnownPoint{PointID: pointID, Source: knowngrammar.SourceObserved, Mastery: knowngrammar.ObservedMastery}
	return nil
}

func (m *MemStore) KnownPoint(ctx context.Context, userID uuid.UUID, pointID int64) (knowngrammar.KnownPoint, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	p, ok := m.knownFor(userID)[pointID]
	return p, ok, nil
}

func (m *MemStore) PutObservation(ctx context.Context, userID uuid.UUID, o knowngrammar.Observation) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.obsFor(userID)[o.MaruMoriID] = o
	return nil
}

func (m *MemStore) Observations(ctx context.Context, userID uuid.UUID) ([]knowngrammar.Observation, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []knowngrammar.Observation
	for _, o := range m.obsFor(userID) {
		out = append(out, o)
	}
	return out, nil
}

func (m *MemStore) ResolveObservation(ctx context.Context, userID uuid.UUID, maruMoriID string, pointID int64, flagged bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.obsFor(userID)[maruMoriID]
	if !ok {
		return knowngrammar.ErrObservationNotFound
	}
	o.MatchedPoint, o.Flagged = pointID, flagged
	m.obsFor(userID)[maruMoriID] = o
	return nil
}

func (m *MemStore) knownFor(userID uuid.UUID) map[int64]knowngrammar.KnownPoint {
	if m.Known[userID] == nil {
		m.Known[userID] = map[int64]knowngrammar.KnownPoint{}
	}
	return m.Known[userID]
}

func (m *MemStore) obsFor(userID uuid.UUID) map[string]knowngrammar.Observation {
	if m.Obs[userID] == nil {
		m.Obs[userID] = map[string]knowngrammar.Observation{}
	}
	return m.Obs[userID]
}
