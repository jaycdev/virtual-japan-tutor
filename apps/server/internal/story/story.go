// Package story generates Stories (issue #10): short Japanese passages built
// from a Learner's Focus Set and Known Items, passed through a deterministic
// validation gate before anything is stored, and served from the Story
// Library. It follows ADR 0002: the model's output is treated as untrusted
// data, the gate decides what is trustworthy, and the gate's outcome is kept
// either way — a Story that failed validation is stored with Validated false
// and never becomes the ready Story.
//
// Failed-Story policy: after all attempts fail the gate, the last candidate
// is still stored (its coverage numbers and attempt count included, so the
// failure is analysable) but is not marked ready; the previous ready Story,
// if any, stays. The library shows only validated Stories.
//
// Comprehension answers write Practice Records lightly: the first answer for
// a Story appends one practice_records row per Focus Set item the Story
// covers (correct = that answer's verdict), and stories.practiced_at marks
// the one-shot. practice_records itself stays the plain append-only log of
// ADR 0008 — story practice is an ordinary Exercise result for Mastery.
package story

import (
	"errors"
	"fmt"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// ErrNotFound is returned for unknown Stories and other users' Stories alike.
var ErrNotFound = errors.New("story: not found")

// Generation and gate bounds. MinCoverage and the Focus Set fraction are the
// issue's acceptance criteria (95% Known-word coverage, roughly half the
// Focus Set included); the character bounds keep the passage in the short
// range the prompt asks for.
const (
	MinChars     = 400
	MaxChars     = 1200
	MinSentences = 3
	MaxSentences = 8
	MinQuestions = 3
	MaxQuestions = 5
	// DefaultCoverage is the Known-word coverage the gate enforces.
	DefaultCoverage = 0.95
	// DefaultFocusFraction is the share of the Focus Set's vocabulary items
	// that must appear in the Story.
	DefaultFocusFraction = 0.5
	// DefaultMaxAttempts is total generation attempts, including the first:
	// the gate's feedback drives at most two retries.
	DefaultMaxAttempts = 3
	// DefaultSignificanceFraction: a Focus Set whose membership differs from
	// the last generation's snapshot by at least this share re-arms the
	// background generator.
	DefaultSignificanceFraction = 1.0 / 3.0
	// DefaultPromptKnownLimit caps how many Known Items the prompt lists;
	// truncation is safe because every listed word is genuinely Known.
	DefaultPromptKnownLimit = 600
)

// Rating is a Learner's verdict on a Story, steering genre choice later.
type Rating string

const (
	RatingUp   Rating = "up"
	RatingDown Rating = "down"
)

func (r Rating) Valid() bool { return r == RatingUp || r == RatingDown }

// Tag marks a token known or unknown to the Learner at generation time.
const (
	TagKnown   = "known"
	TagUnknown = "unknown"
)

// Story is a generated passage with everything attached to it. All offsets —
// token Start/End and span Start/End — are codepoint (rune) indexes into the
// sentence's Japanese text, the same convention as grammar_examples and the
// API contract; never UTF-16 indexes or byte offsets.
type Story struct {
	ID     uuid.UUID
	UserID uuid.UUID
	Genre  string
	Prompt string

	Text       string
	Sentences  []Sentence
	Questions  []Question
	VocabItems []VocabItem

	// Gate outcome for the final attempt, stored whether or not it passed.
	ContentWords int
	KnownWords   int
	FocusItems   int
	FocusHit     int
	Validated    bool
	Attempts     int

	// PracticedAt records when the first comprehension answer wrote Practice
	// Records for this Story; nil until then, at most once ever.
	PracticedAt *time.Time
	CreatedAt   time.Time
	ReadyAt     *time.Time
	// Rating is the Learner's own rating, when they gave one.
	Rating *Rating
}

type Sentence struct {
	ID     uuid.UUID
	Pos    int
	JA     string
	EN     string
	Tokens []Token
	Spans  []Span
}

// Token is one kagome morpheme of a sentence, tagged against the Learner's
// Known Items. Reading is the surface's kana reading (furigana material);
// Dictionary is the dictionary form; EntSeq links linked vocabulary.
type Token struct {
	Pos        int
	Surface    string
	Start      int
	End        int
	Reading    string
	Dictionary string
	EntSeq     *int64
	Tag        string
	SRSLevel   *int

	// content marks the morphemes the coverage gate counts (nouns, verbs,
	// adjectives, adverbs; see isContent). Set during materialisation,
	// never stored: the counts it produced are stored instead.
	content bool
}

// Span is a Grammar Span inside a sentence: runes [Start,End) realising one
// of the Focus Set's Grammar Points.
type Span struct {
	ID             uuid.UUID
	Start          int
	End            int
	GrammarPointID int64
}

// Question is one comprehension question. AnswerIndex is server-side only:
// the API view never reveals it before the Learner answers.
type Question struct {
	ID          uuid.UUID
	Pos         int
	PromptJA    string
	OptionsJA   []string
	AnswerIndex int
}

// VocabItem is one Vocabulary Item the Story covers: a sentence token that
// linked to a jmdict entry, and the Learner's relation to it at generation
// time. IsFocus marks the Focus Set items the Story covered — answering a
// comprehension question writes a Practice Record for exactly those.
type VocabItem struct {
	EntSeq  int64
	JA      string
	EN      string
	IsKnown bool
	IsFocus bool
}

// Validate checks the shape of a candidate: text and sentence bounds,
// question bounds, answer indexes in range, dense positions from zero, and
// every span inside its sentence's text as a rune range. It is the cheap
// half of the gate and never consults the model or the database.
func (s *Story) Validate() error {
	runes := utf8.RuneCountInString(s.Text)
	if runes < MinChars || runes > MaxChars {
		return fmt.Errorf("the passage is %d characters, want between %d and %d", runes, MinChars, MaxChars)
	}
	if len(s.Sentences) < MinSentences || len(s.Sentences) > MaxSentences {
		return fmt.Errorf("%d sentences, want between %d and %d", len(s.Sentences), MinSentences, MaxSentences)
	}
	if len(s.Questions) < MinQuestions || len(s.Questions) > MaxQuestions {
		return fmt.Errorf("%d comprehension questions, want between %d and %d", len(s.Questions), MinQuestions, MaxQuestions)
	}
	for i, sen := range s.Sentences {
		if sen.Pos != i {
			return fmt.Errorf("sentence %d has position %d", i, sen.Pos)
		}
		if sen.JA == "" || sen.EN == "" {
			return fmt.Errorf("sentence %d has an empty ja or en field", i)
		}
		n := utf8.RuneCountInString(sen.JA)
		for _, sp := range sen.Spans {
			if sp.Start < 0 || sp.End > n || sp.Start >= sp.End {
				return fmt.Errorf("span [%d,%d) for grammar point %d is outside sentence %d (%d characters)",
					sp.Start, sp.End, sp.GrammarPointID, i, n)
			}
		}
	}
	for i, q := range s.Questions {
		if q.Pos != i {
			return fmt.Errorf("question %d has position %d", i, q.Pos)
		}
		if q.PromptJA == "" || len(q.OptionsJA) < 2 {
			return fmt.Errorf("question %d needs a prompt and at least two options", i)
		}
		if q.AnswerIndex < 0 || q.AnswerIndex >= len(q.OptionsJA) {
			return fmt.Errorf("question %d answer_index %d is outside %d options", i, q.AnswerIndex, len(q.OptionsJA))
		}
	}
	return nil
}

// Furigana reports whether a token's reading should be shown for a user with
// the given Furigana Threshold (GLOSSARY.md): the threshold is the SRS Level
// at or above which Known Items appear without furigana. Unknown tokens
// always show theirs — the Learner has no reading for them yet.
func Furigana(t Token, threshold int) bool {
	if t.Tag != TagKnown || t.SRSLevel == nil {
		return true
	}
	return *t.SRSLevel < threshold
}
