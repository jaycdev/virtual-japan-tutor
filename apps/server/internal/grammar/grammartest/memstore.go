// Package grammartest provides in-memory test doubles for internal/grammar.
package grammartest

import (
	"context"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// MemStore mirrors the Postgres store's behaviour (the store contract test runs
// against both, which keeps this fake honest). The catalogue points it serves
// are the ones passed to NewMemStore.
type MemStore struct {
	mu       sync.Mutex
	points   []refdata.GrammarPoint
	content  map[int64]grammar.Content
	examples map[int64][]grammar.Example
}

var _ grammar.Store = (*MemStore)(nil)

func NewMemStore(points ...refdata.GrammarPoint) *MemStore {
	return &MemStore{
		points:   append([]refdata.GrammarPoint(nil), points...),
		content:  map[int64]grammar.Content{},
		examples: map[int64][]grammar.Example{},
	}
}

// SetContent presets a point's explanation state (to seed stored content).
func (m *MemStore) SetContent(id int64, c grammar.Content) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.content[id] = c
}

func (m *MemStore) findPoint(id int64) (refdata.GrammarPoint, bool) {
	for _, p := range m.points {
		if p.ID == id {
			return p, true
		}
	}
	return refdata.GrammarPoint{}, false
}

// orderKey sorts like the Postgres query: level N5→N1 (refdata ranks N5 highest),
// then catalogue number, then ordinal.
func lessPoint(a, b refdata.GrammarPoint) bool {
	if a.Level.Rank() != b.Level.Rank() {
		return a.Level.Rank() > b.Level.Rank()
	}
	if a.Number != b.Number {
		return a.Number < b.Number
	}
	return a.Ordinal < b.Ordinal
}

func matches(p refdata.GrammarPoint, f grammar.Filter) bool {
	if f.Level != "" && string(p.Level) != f.Level {
		return false
	}
	if f.Query == "" {
		return true
	}
	q := strings.ToLower(f.Query)
	return strings.Contains(strings.ToLower(p.Pattern), q) ||
		strings.Contains(strings.ToLower(p.Romaji), q) ||
		strings.Contains(strings.ToLower(p.Meaning), q)
}

func (m *MemStore) Points(_ context.Context, f grammar.Filter) ([]grammar.PointSummary, int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	var hits []refdata.GrammarPoint
	for _, p := range m.points {
		if matches(p, f) {
			hits = append(hits, p)
		}
	}
	sort.SliceStable(hits, func(i, j int) bool { return lessPoint(hits[i], hits[j]) })

	limit, offset := grammar.ClampLimit(f.Limit), min(max(0, f.Offset), len(hits))
	page := hits[offset:]
	if len(page) > limit {
		page = page[:limit]
	}
	out := make([]grammar.PointSummary, 0, len(page))
	for _, p := range page {
		c := m.content[p.ID]
		out = append(out, grammar.PointSummary{
			ID:             p.ID,
			Level:          p.Level,
			Number:         p.Number,
			Pattern:        p.Pattern,
			Romaji:         p.Romaji,
			Meaning:        p.Meaning,
			HasExplanation: c.Explanation != nil,
			ExampleCount:   len(m.examples[p.ID]),
		})
	}
	return out, len(hits), nil
}

func (m *MemStore) Point(_ context.Context, id int64) (refdata.GrammarPoint, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.findPoint(id); ok {
		return p, nil
	}
	return refdata.GrammarPoint{}, grammar.ErrPointNotFound
}

func (m *MemStore) Content(_ context.Context, id int64) (grammar.Content, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.findPoint(id); !ok {
		return grammar.Content{}, grammar.ErrPointNotFound
	}
	return m.content[id], nil
}

func (m *MemStore) SetExplanation(_ context.Context, id int64, explanation string, edited bool) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.findPoint(id); !ok {
		return grammar.ErrPointNotFound
	}
	now := time.Now()
	c := m.content[id]
	c.Explanation = &explanation
	c.ExplanationEdited = edited
	c.ExplanationUpdatedAt = &now
	m.content[id] = c
	return nil
}

func (m *MemStore) Examples(_ context.Context, id int64) ([]grammar.Example, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.findPoint(id); !ok {
		return nil, grammar.ErrPointNotFound
	}
	return append([]grammar.Example(nil), m.examples[id]...), nil
}

func (m *MemStore) AddExample(_ context.Context, id int64, c grammar.Candidate) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.findPoint(id); !ok {
		return false, grammar.ErrPointNotFound
	}
	for _, e := range m.examples[id] {
		if e.SentenceJA == c.SentenceJA {
			return false, nil
		}
	}
	m.examples[id] = append(m.examples[id], grammar.Example{
		ID:             uuid.New(),
		GrammarPointID: id,
		SentenceJA:     c.SentenceJA,
		TranslationEN:  c.Translation,
		SpanStart:      c.SpanStart,
		SpanEnd:        c.SpanEnd,
		SpanText:       c.SpanText,
		Source:         "ai",
		LanguageCheck:  "jmdict_tokenised",
		CreatedAt:      time.Now(),
	})
	return true, nil
}

func (m *MemStore) CountExamples(_ context.Context, id int64) (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.findPoint(id); !ok {
		return 0, grammar.ErrPointNotFound
	}
	return len(m.examples[id]), nil
}
