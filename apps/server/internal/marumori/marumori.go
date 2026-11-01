// Package marumori reads the Learner's knowledge state from the unofficial MaruMori
// public API (issue #5, docs/adr/0002). It is read-only and deliberately narrow: the
// upstream carries item content (meanings, definitions, readings, mnemonics, pitch,
// examples, personal notes) inside these payloads, and none of it is decoded or kept —
// only item identity and SRS progress, plus for grammar points the pattern itself,
// which is a Grammar Point's identity and what Catalogue Matching (issue #6) matches on.
// The API key is write-only: it appears in request
// headers and nowhere else, and every upstream string that could echo it is redacted.
//
// The endpoint set mirrors the community reference (gist.github.com/Eearslya/
// d233379c1743f32b4bada4afa542c208): /home, /known/kanji, /known/vocabulary,
// /srs/grammar-lessons and /srs/grammar-reviews. The kanji/vocabulary /srs/* endpoints
// are not called: they repeat the full item content, and the known lists already carry
// everything Sync needs. Study-list endpoints would write to the Learner's MaruMori
// account and are out of scope (ADR-0002: MaruMori is a source, not a target).
package marumori

import (
	"errors"
	"time"
)

// KnownDefaultBaseURL is MaruMori's public API (issue #5).
const KnownDefaultBaseURL = "https://public-api.marumori.io"

// KnownItem is one entry of a /known/* list. The Level filter (SRS level 1+ = Known)
// is applied by the caller, not here: level 0 entries are reported so Sync can count
// them as skipped.
type KnownItem struct {
	MaruMoriID string
	Text       string
	Level      int
}

// Home is the scalar progression state from /home. The level distributions, timeline
// and the of-the-day objects are dropped at decode time (ADR-0002).
type Home struct {
	TotalLearned          int     // counts.total
	TotalGrammarLearned   int     // counts.grammarTotal
	PendingLessons        int     // counts.lessons
	PendingReviews        int     // counts.reviews
	PendingGrammarLessons int     // counts.grammarLessons
	PendingGrammarReviews int     // counts.grammarReviews
	KanjiLearned          int     // stats.kanjiLearned
	VocabularyLearned     int     // stats.vocabularyLearned
	TotalGrammarDone      int     // stats.totalGrammarLessonsDone
	Accuracy              float64 // accuracy
	GrammarAccuracy       float64 // grammarAccurary (MaruMori's own spelling)
}

// GrammarObservation is one entry of /srs/grammar-lessons or /srs/grammar-reviews.
// Lesson-only entries have no progress object upstream, so Level is nil. The grammar
// point's explanation, gloss and examples are content and are dropped at decode time
// (ADR-0002). Pattern is the exception: a Grammar Point is identified by its pattern
// (GLOSSARY.md), so Catalogue Matching (issue #6) cannot decide whether the Learner
// knows the point without the pattern itself.
type GrammarObservation struct {
	MaruMoriID string
	// Pattern is the point's Japanese pattern: upstream `japanese`, or the older
	// `grammar` field. Empty when upstream sends neither.
	Pattern string
	// JLPTLevel is the point's JLPT Level as MaruMori states it ("N4"), empty when
	// upstream does not name one — grammar reviews do not today.
	JLPTLevel string
	Level     *int
	Suspended *bool
}

// Sentinel error kinds; match with errors.Is. They mirror internal/llm so callers can
// describe failures the same way.
var (
	ErrAuth             = errors.New("MaruMori rejected the API key")
	ErrEndpointNotFound = errors.New("MaruMori endpoint not found")
	ErrRateLimited      = errors.New("MaruMori is rate limiting")
	ErrTimeout          = errors.New("MaruMori did not answer in time")
	ErrUnreachable      = errors.New("cannot reach MaruMori")
	ErrBadRequest       = errors.New("MaruMori rejected the request")
	ErrBadResponse      = errors.New("MaruMori returned an unexpected response")
	ErrServer           = errors.New("MaruMori reported an error")
)

// Error is a failed call to MaruMori. Kind is one of the Err* sentinels (errors.Is
// works); Detail is a bounded, key-free excerpt of what MaruMori said.
type Error struct {
	Kind       error
	Status     int // HTTP status, 0 if none was received
	Detail     string
	RetryAfter time.Duration
}

func (e *Error) Error() string {
	if e.Detail == "" {
		return e.Kind.Error()
	}
	return e.Kind.Error() + ": " + e.Detail
}

func (e *Error) Unwrap() error { return e.Kind }

func (e *Error) retryable() bool {
	switch e.Kind {
	case ErrRateLimited, ErrServer, ErrTimeout, ErrUnreachable:
		return true
	}
	return false
}
