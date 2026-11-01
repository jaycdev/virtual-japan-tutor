package grammar

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// Errors; match with errors.Is.
var (
	ErrPointNotFound = errors.New("grammar point not found")
)

// Filter narrows a catalogue search. Level is a JLPT level string ("N5"…) or
// empty for all levels; Query is matched case-insensitively against pattern,
// romaji and meaning. Limit/Offset page the results; stores clamp Limit into
// [1, MaxLimit] and treat a non-positive Limit as DefaultLimit.
type Filter struct {
	Level  string
	Query  string
	Limit  int
	Offset int
}

// Page-size bounds shared by every Store implementation.
const (
	DefaultLimit = 50
	MaxLimit     = 200
)

// ClampLimit normalises a requested page size.
func ClampLimit(n int) int {
	switch {
	case n <= 0:
		return DefaultLimit
	case n > MaxLimit:
		return MaxLimit
	default:
		return n
	}
}

// PointSummary is one row of a catalogue search.
type PointSummary struct {
	ID             int64
	Level          refdata.Level
	Number         int
	Pattern        string
	Romaji         string
	Meaning        string
	HasExplanation bool
	ExampleCount   int
}

// Content is a point's explanation state: nil Explanation means it has never
// been generated or written.
type Content struct {
	Explanation          *string
	ExplanationEdited    bool
	ExplanationUpdatedAt *time.Time
}

// Example is one stored example sentence. SpanStart/SpanEnd are rune offsets
// into SentenceJA and SentenceJA[SpanStart:SpanEnd] == SpanText (guaranteed by
// the Validator before storing).
type Example struct {
	ID             uuid.UUID
	GrammarPointID int64
	SentenceJA     string
	TranslationEN  string
	SpanStart      int
	SpanEnd        int
	SpanText       string
	Source         string // "ai" or "manual"
	LanguageCheck  string // which validation pipeline accepted it
	CreatedAt      time.Time
}

// Store persists the Grammar Catalogue and its generated content. Points are
// reference data (imported by internal/refdata); the content methods only ever
// add or replace derived content, never the catalogue rows themselves.
type Store interface {
	// Points returns matching points in catalogue order (level N5→N1, then
	// catalogue number, then ordinal) and the total count of matches.
	Points(ctx context.Context, f Filter) ([]PointSummary, int, error)
	// Point returns one catalogue entry; ErrPointNotFound if there is none.
	Point(ctx context.Context, id int64) (refdata.GrammarPoint, error)
	// Content returns a point's explanation state; ErrPointNotFound if absent.
	Content(ctx context.Context, id int64) (Content, error)
	// SetExplanation writes the explanation and stamps explanation_updated_at;
	// edited distinguishes a Learner's hand edit from generated text.
	SetExplanation(ctx context.Context, id int64, explanation string, edited bool) error
	// Examples returns a point's example sentences, oldest first.
	Examples(ctx context.Context, id int64) ([]Example, error)
	// AddExample inserts one validated candidate and reports whether a row was
	// added; the same sentence for the same point is a no-op (false, nil).
	// ErrPointNotFound when the grammar point does not exist.
	AddExample(ctx context.Context, id int64, c Candidate) (bool, error)
	// CountExamples returns how many examples a point has.
	CountExamples(ctx context.Context, id int64) (int, error)
}
