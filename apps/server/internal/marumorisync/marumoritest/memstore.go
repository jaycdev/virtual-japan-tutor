// Package marumoritest provides test doubles for marumorisync: an in-memory Store
// (mirroring aiprovider/aiprovidertest) and a canned Upstream. It is only for tests.
package marumoritest

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
)

type itemKey struct {
	kind marumorisync.Kind
	id   string
}

type knownRow struct {
	level         int
	text          *string
	kanjiLiteral  *string
	entSeq        *int64
	firstSyncedAt time.Time
	lastSeenAt    time.Time
	disappearedAt *time.Time
}

// MemStore is an in-memory marumorisync.Store. It enforces the same behavioural contract
// as the Postgres store (see store_contract_test.go), including the single-flight run
// limit and reaping a run older than marumorisync.StaleRunAfter.
type MemStore struct {
	mu       sync.Mutex
	settings map[uuid.UUID]marumorisync.Settings
	known    map[uuid.UUID]map[itemKey]*knownRow // per (user, kind, id)
	runs     map[uuid.UUID][]marumorisync.SyncRun
	history  map[uuid.UUID][]marumorisync.HistoryEntry
	grammar  map[uuid.UUID]map[string]marumori.GrammarObservation
	home     map[uuid.UUID]marumori.Home
}

// NewMemStore returns an empty MemStore.
func NewMemStore() *MemStore {
	return &MemStore{
		settings: map[uuid.UUID]marumorisync.Settings{},
		known:    map[uuid.UUID]map[itemKey]*knownRow{},
		runs:     map[uuid.UUID][]marumorisync.SyncRun{},
		history:  map[uuid.UUID][]marumorisync.HistoryEntry{},
		grammar:  map[uuid.UUID]map[string]marumori.GrammarObservation{},
		home:     map[uuid.UUID]marumori.Home{},
	}
}

func (m *MemStore) GetSettings(_ context.Context, userID uuid.UUID) (marumorisync.Settings, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	set, ok := m.settings[userID]
	if !ok {
		return marumorisync.Settings{}, marumorisync.ErrNoKey
	}
	return set, nil
}

func (m *MemStore) SetAPIKey(_ context.Context, userID uuid.UUID, encrypted string, at time.Time) (marumorisync.Settings, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	set, ok := m.settings[userID]
	if !ok {
		set = marumorisync.Settings{ConnectedAt: at}
	}
	set.APIKeyEncrypted = encrypted
	m.settings[userID] = set
	return set, nil
}

func (m *MemStore) DeleteAPIKey(_ context.Context, userID uuid.UUID) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.settings, userID)
	return nil
}

func (m *MemStore) UsersWithKeys(_ context.Context) ([]uuid.UUID, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []uuid.UUID
	for u := range m.settings {
		out = append(out, u)
	}
	return out, nil
}

func (m *MemStore) KnownLevels(_ context.Context, userID uuid.UUID) ([]marumorisync.KnownLevel, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []marumorisync.KnownLevel
	for k, row := range m.known[userID] {
		if row.disappearedAt != nil {
			continue
		}
		out = append(out, marumorisync.KnownLevel{Kind: k.kind, MaruMoriID: k.id, Level: row.level})
	}
	return out, nil
}

func (m *MemStore) KnowledgeTotals(_ context.Context, userID uuid.UUID) (marumorisync.Totals, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var tot marumorisync.Totals
	for k, row := range m.known[userID] {
		if row.disappearedAt != nil {
			continue
		}
		switch k.kind {
		case marumorisync.KindKanji:
			tot.Kanji++
		case marumorisync.KindVocabulary:
			tot.Vocabulary++
			if row.entSeq != nil {
				tot.VocabularyLinked++
			}
		}
		if tot.LastSyncAt == nil || row.lastSeenAt.After(*tot.LastSyncAt) {
			t := row.lastSeenAt
			tot.LastSyncAt = &t
		}
	}
	return tot, nil
}

func (m *MemStore) StartRun(_ context.Context, userID, runID uuid.UUID, startedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	staleBefore := startedAt.Add(-marumorisync.StaleRunAfter)
	for idx := range m.runs[userID] {
		r := &m.runs[userID][idx]
		if r.Status != marumorisync.RunRunning {
			continue
		}
		if !r.StartedAt.Before(staleBefore) {
			return marumorisync.ErrSyncRunning
		}
		// Abandoned by a crash or a cut-short request: close it as a failure rather
		// than let it block the Learner's next Sync.
		finished, message := startedAt, marumorisync.StaleRunMessage
		r.Status = marumorisync.RunFailed
		r.FinishedAt = &finished
		r.Error = &message
	}
	m.runs[userID] = append(m.runs[userID], marumorisync.SyncRun{ID: runID, Status: marumorisync.RunRunning, StartedAt: startedAt})
	return nil
}

func (m *MemStore) FinishRun(_ context.Context, userID, runID uuid.UUID, finishedAt time.Time, failure *string, counts *marumorisync.Counts) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	for idx := range m.runs[userID] {
		r := &m.runs[userID][idx]
		if r.ID != runID {
			continue
		}
		r.FinishedAt = &finishedAt
		r.Error = failure
		r.Counts = counts
		if failure == nil {
			r.Status = marumorisync.RunOK
		} else {
			r.Status = marumorisync.RunFailed
		}
		return nil
	}
	return errors.New("sync run not found")
}

func (m *MemStore) RecentRuns(_ context.Context, userID uuid.UUID, limit int) ([]marumorisync.SyncRun, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	runs := append([]marumorisync.SyncRun(nil), m.runs[userID]...)
	// newest first (insertion order is chronological)
	out := make([]marumorisync.SyncRun, 0, len(runs))
	for idx := len(runs) - 1; idx >= 0; idx-- {
		out = append(out, runs[idx])
	}
	if limit > 0 && len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (m *MemStore) LastSuccessfulRun(_ context.Context, userID uuid.UUID) (marumorisync.SyncRun, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var found marumorisync.SyncRun
	ok := false
	for _, r := range m.runs[userID] {
		if r.Status == marumorisync.RunOK {
			found, ok = r, true
		}
	}
	return found, ok, nil
}

func (m *MemStore) LastFailedRun(_ context.Context, userID uuid.UUID) (marumorisync.SyncRun, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var found marumorisync.SyncRun
	ok := false
	for _, r := range m.runs[userID] {
		if r.Status == marumorisync.RunFailed {
			found, ok = r, true
		}
	}
	return found, ok, nil
}

func (m *MemStore) ApplySync(_ context.Context, userID, runID uuid.UUID, batch marumorisync.SyncBatch) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.known[userID] == nil {
		m.known[userID] = map[itemKey]*knownRow{}
	}
	for _, it := range batch.Items {
		k := itemKey{it.Kind, it.MaruMoriID}
		row := m.known[userID][k]
		if row == nil {
			row = &knownRow{firstSyncedAt: batch.SyncedAt}
			m.known[userID][k] = row
		}
		row.level = it.Level
		row.text, row.kanjiLiteral, row.entSeq = it.Text, it.KanjiLiteral, it.EntSeq
		row.lastSeenAt = batch.SyncedAt
		row.disappearedAt = nil
	}
	for _, d := range batch.Disappeared {
		if row := m.known[userID][itemKey{d.Kind, d.MaruMoriID}]; row != nil {
			at := batch.SyncedAt
			row.disappearedAt = &at
		}
	}
	m.history[userID] = append(m.history[userID], batch.History...)
	if m.grammar[userID] == nil {
		m.grammar[userID] = map[string]marumori.GrammarObservation{}
	}
	for _, g := range batch.Grammar {
		m.grammar[userID][g.MaruMoriID] = g
	}
	if batch.Home != nil {
		m.home[userID] = *batch.Home
	}
	return nil
}

// --- inspection helpers for tests (the fake's "SELECT", not part of Store) ---

// HistoryRows returns every recorded history entry (fake stores one user's worth per
// test).
func (m *MemStore) HistoryRows() []marumorisync.HistoryEntry {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []marumorisync.HistoryEntry
	for _, h := range m.history {
		out = append(out, h...)
	}
	return out
}

// GrammarRows returns every stored grammar observation.
func (m *MemStore) GrammarRows() []marumori.GrammarObservation {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []marumori.GrammarObservation
	for _, byID := range m.grammar {
		for _, g := range byID {
			out = append(out, g)
		}
	}
	return out
}

// HomeRow returns the stored home snapshot.
func (m *MemStore) HomeRow() marumori.Home {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out marumori.Home
	for _, h := range m.home {
		out = h
	}
	return out
}

// KnownItemLink returns what one stored Known Item kept: its level, and exactly one of
// entSeq / literal / text, so tests can assert that only the allowed survived.
func (m *MemStore) KnownItemLink(userID uuid.UUID, kind marumorisync.Kind, id string) (level int, entSeq *int64, literal *string, text *string, ok bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	row := m.known[userID][itemKey{kind, id}]
	if row == nil {
		return 0, nil, nil, nil, false
	}
	return row.level, row.entSeq, row.kanjiLiteral, row.text, true
}
