// Package practicetest provides in-memory doubles for practice's Content and
// ResultWriter. Like masterytest it is only ever imported from tests.
package practicetest

import (
	"context"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
)

// Content is a fixture-backed practice.Content. Add* fixtures register item
// content; distractor pools are plain lists returned in order, so generated
// sessions are as deterministic as the generator itself.
type Content struct {
	Vocab   map[int64]practice.Word
	Kanji   map[string]practice.Word
	Clozes  map[int64]practice.ClozeContent
	Meaning []string // distractor pool for vocabulary and kanji recognition
	Spans   []string // distractor pool for cloze exercises

	Stretch map[uuid.UUID][]mastery.ItemKey // Boosting List stretch fixtures

	mu    sync.Mutex
	Calls []string // every lookup, in call order, for assertions
}

var _ practice.Content = (*Content)(nil)

func NewContent() *Content {
	return &Content{
		Vocab:   map[int64]practice.Word{},
		Kanji:   map[string]practice.Word{},
		Clozes:  map[int64]practice.ClozeContent{},
		Stretch: map[uuid.UUID][]mastery.ItemKey{},
	}
}

func (c *Content) AddVocab(entSeq int64, w practice.Word) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Vocab[entSeq] = w
}

func (c *Content) AddKanji(literal string, w practice.Word) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Kanji[literal] = w
}

func (c *Content) AddCloze(pointID int64, cl practice.ClozeContent) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Clozes[pointID] = cl
}

func (c *Content) note(name string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Calls = append(c.Calls, name)
}

func (c *Content) VocabWord(ctx context.Context, entSeq int64) (practice.Word, bool, error) {
	c.note("vocab:" + itoa(entSeq))
	c.mu.Lock()
	defer c.mu.Unlock()
	w, ok := c.Vocab[entSeq]
	return w, ok, nil
}

func (c *Content) KanjiWord(ctx context.Context, literal string) (practice.Word, bool, error) {
	c.note("kanji:" + literal)
	c.mu.Lock()
	defer c.mu.Unlock()
	w, ok := c.Kanji[literal]
	return w, ok, nil
}

func (c *Content) GrammarCloze(ctx context.Context, pointID int64) (practice.ClozeContent, bool, error) {
	c.note("cloze:" + itoa(pointID))
	c.mu.Lock()
	defer c.mu.Unlock()
	cl, ok := c.Clozes[pointID]
	return cl, ok, nil
}

func (c *Content) VocabDistractors(ctx context.Context, level string, exclude []int64, salt int64, limit int) ([]string, error) {
	c.note("vocab-distractors:" + level)
	return pool(c.Meaning, limit), nil
}

func (c *Content) KanjiDistractors(ctx context.Context, level string, exclude []string, salt int64, limit int) ([]string, error) {
	c.note("kanji-distractors:" + level)
	return pool(c.Meaning, limit), nil
}

func (c *Content) ClozeDistractors(ctx context.Context, level string, excludePoint int64, notText string, salt int64, limit int) ([]string, error) {
	c.note("cloze-distractors:" + level)
	return pool(c.Spans, limit), nil
}

// AddStretch queues Stretch Items for a user, in draw order.
func (c *Content) AddStretch(userID uuid.UUID, keys ...mastery.ItemKey) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.Stretch[userID] = append(c.Stretch[userID], keys...)
}

// StretchItems draws queue order in the fixture; the real store rotates the
// pool by salt, which the unit tests do not model.
func (c *Content) StretchItems(ctx context.Context, userID uuid.UUID, salt int64, limit int) ([]mastery.ItemKey, error) {
	c.note("stretch")
	c.mu.Lock()
	defer c.mu.Unlock()
	return pool2(c.Stretch[userID], limit), nil
}

func pool2(list []mastery.ItemKey, limit int) []mastery.ItemKey {
	if len(list) < limit {
		return append([]mastery.ItemKey(nil), list...)
	}
	return append([]mastery.ItemKey(nil), list[:limit]...)
}

func pool(list []string, limit int) []string {
	if len(list) < limit {
		return append([]string(nil), list...)
	}
	return append([]string(nil), list[:limit]...)
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

// Results collects what a session wrote to the Practice Record. Wrap a
// masterytest.MemStore (see MemWriter) when the done-when assertion needs
// Mastery to actually move; Results serves plain call-log assertions.
type Results struct {
	mu      sync.Mutex
	Written []mastery.PracticeRecord
}

var _ practice.ResultWriter = (*Results)(nil)

func (r *Results) AppendResult(ctx context.Context, userID uuid.UUID, item mastery.ItemKey, correct bool, answeredAt time.Time) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.Written = append(r.Written, mastery.PracticeRecord{Key: item, Correct: correct, AnsweredAt: answeredAt})
	return nil
}
