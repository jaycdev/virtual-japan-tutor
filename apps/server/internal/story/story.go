// Package story generates Stories (issue #10): short Japanese passages built
// from a Learner's Focus Set and Known Items, passed through a deterministic
// validation gate before anything is stored, and served from the Story
// Library. It follows ADR 0002: the model's output is treated as untrusted
// data, the gate decides what is trustworthy, and the gate's outcome is kept
// either way — a Story that failed validation is stored with Validated false
// and never becomes Today's Story.
//
// Failed-Story policy: after all attempts fail the gate, the last candidate
// is still stored (its coverage numbers and attempt count included, so the
// failure is analysable) but stays unvalidated; the library and Today's
// Story show only validated Stories.
//
// Comprehension answers write Practice Records lightly: the first answer for
// a Story appends one practice_records row per Focus Set item the Story
// covers — vocabulary and Grammar Points alike (correct = that answer's
// verdict) — and stories.practiced_at marks the one-shot. practice_records
// itself stays the plain append-only log documented in
// apps/server/migrations/00008_practice_and_weak_signals.sql (ADR 0004): a
// story answer is an ordinary Exercise result for Mastery, and for now it
// carries the same AppendResult weight as a Session result.
package story

import (
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
)

// ErrNotFound is returned for unknown Stories and other users' Stories alike.
var ErrNotFound = errors.New("story: not found")

// Generation and gate bounds. MinCoverage and the Focus Set fraction are the
// issue's acceptance criteria (95% Known-word coverage, roughly half the
// Focus Set included); the character bounds keep the passage in the short
// range the prompt asks for.
//
// Note the deliberate asymmetry: the prompt ASKS for 800–1100 characters,
// but the gate only REJECTS outside 400–1200. Models undershoot a length
// target by about half (live: asked for 400–800 they wrote 216–343; asked for
// 600–900, 281–394), so the ask sits far above the floor to leave the margin; a model that overshoots slightly still
// gets a usable story rather than a wasted retry, and the gate rejects only
// shapes far outside the intended range.
const (
	MinChars = 400
	MaxChars = 1200
	// PromptMinChars/PromptMaxChars are the length the prompt asks for.
	PromptMinChars = 800
	PromptMaxChars = 1100
	MinSentences   = 3
	// MaxSentences is only a sanity bound: MinChars/MaxChars govern length. It
	// must leave MinChars reachable at the sentence length models really write
	// under a restricted vocabulary (measured live: 16-25 characters; a cap of
	// 8 held passages near 200 characters and every generation failed the
	// length gate), and it must be loose enough that a retry which overshoots
	// the prompt's range is not thrown away over sentence count alone (a cap of
	// 20 rejected a 21-sentence passage that cleared every other check). The
	// prompt asks for the tighter
	// PromptMinSentences..PromptMaxSentences, because a model counts sentences
	// far better than characters. The schema's maxItems in generate.go must
	// equal MaxSentences.
	MaxSentences       = 100
	PromptMinSentences = 20
	PromptMaxSentences = 30
	// PromptMinSentenceRunes..PromptMaxSentenceRunes is the sentence length
	// the prompt asks for, long enough to join related clauses inside one
	// sentence instead of linking them with a conjunction at the start of the
	// next.
	PromptMinSentenceRunes = 20
	PromptMaxSentenceRunes = 50
	// MaxContrastiveOpeners and MaxConjunctionShare bound the style check: how
	// many sentences may open with a contrastive conjunction (でも, しかし…),
	// and what share of sentences may open with any conjunction. The check is
	// soft: a Story that fails only on it is still accepted on its last attempt.
	MaxContrastiveOpeners = 2
	MaxConjunctionShare   = 0.2
	MinQuestions          = 3
	MaxQuestions          = 5
	// DefaultCoverage is the Known-word coverage the gate enforces.
	DefaultCoverage = 0.95
	// DefaultFocusFraction is the share of the Focus Set's vocabulary items
	// that must appear in the Story.
	DefaultFocusFraction = 0.5
	// DefaultMaxAttempts is total generation attempts, including the first:
	// the gate's feedback drives the retries. Three was not enough against a
	// real account: coverage improved on every retry (80 -> 92 -> 94%) and ran
	// out of attempts just under the 95% bar.
	DefaultMaxAttempts = 5
	// DefaultPromptKnownLimit caps how many Known Items the prompt lists;
	// truncation is safe because every listed word is genuinely Known.
	DefaultPromptKnownLimit = 600
	// MaxQuestionOptions bounds a question's options. The prompt asks for
	// exactly four; the gate accepts 3 or 4 and rejects more, so a bad
	// completion cannot store an unbounded option list.
	MaxQuestionOptions = 4
	// DefaultRetryCooldown is the failure backoff: while a user's newest
	// Story is a gate failure younger than this, background regeneration is
	// skipped. A stuck provider then costs one generation per window instead
	// of one per scheduler interval. Zero disables the cooldown.
	DefaultRetryCooldown = 6 * time.Hour
	// DefaultGenerationTimeout caps one model round-trip from the story side
	// (llm.Options.Timeout, set explicitly per attempt) and sizes the
	// scheduler's per-user context budget.
	DefaultGenerationTimeout = 60 * time.Second
)

// maxLabelRunes caps a model- or user-supplied label (a genre, a theme).
const maxLabelRunes = 60

// sanitizeLabel cleans such a label before it is stored or shown: control
// characters (newlines included) become spaces, whitespace runs collapse, and
// the result is capped at maxRunes codepoints. One sanitizer for every label
// so the newline rule cannot drift between call sites; the cap differs per
// kind (maxLabelRunes for genres, the settings' own bound for preferences).
func sanitizeLabel(s string, maxRunes int) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.IsControl(r) {
			b.WriteRune(' ')
		} else {
			b.WriteRune(r)
		}
	}
	out := strings.Join(strings.Fields(b.String()), " ")
	if utf8.RuneCountInString(out) > maxRunes {
		out = string([]rune(out)[:maxRunes])
	}
	return out
}

// Rating is a Learner's verdict on a Story, steering genre choice later.
type Rating string

const (
	RatingUp   Rating = "up"
	RatingDown Rating = "down"
)

func (r Rating) Valid() bool { return r == RatingUp || r == RatingDown }

// StoryOrigin records how a Story came to exist: the background generator
// wrote it (Automatic) or the Learner asked for it (On-demand). Generator
// production is always Automatic, whatever genre or theme steering was in
// play (issue #31).
type StoryOrigin string

const (
	OriginAutomatic StoryOrigin = "automatic"
	OriginOnDemand  StoryOrigin = "on_demand"
)

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
	// Library fields (issue #31): the Story's own Title with its English
	// translation TitleEN (both model-written, Title falling back to a
	// shortened first sentence), the Theme it was written on, and the Origin
	// of its existence. Every stored Story carries them; pre-#31 rows get
	// backfilled placeholders from migration 00012.
	Title   string
	TitleEN string
	Theme   string
	Origin  StoryOrigin
	// Prompt is the generation brief sent to the model (the base user prompt,
	// not the retry feedback). Stored for debugging a story's outcome.
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
	// ReadAt records that the Learner finished the Story: set when they
	// answer its last comprehension question, and settable directly through
	// the library's Read mark. It is separate from PracticedAt, which is
	// about Practice Records, not about finishing (issue #31).
	ReadAt    *time.Time
	CreatedAt time.Time
	// Rating is the Learner's own rating, when they gave one.
	Rating *Rating
}

// Read reports whether the Learner has marked this Story read.
func (s *Story) Read() bool { return s.ReadAt != nil }

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
//
// Every token except particles, auxiliaries and symbols carries an ent_seq
// link (see isLinkable), so the reader can look any word up. Particles stay
// unlinked on purpose. content alone says what the coverage gate counts (see
// isContent); the link and the gate are separate decisions.
//
// A particle the Grammar Catalogue has a point for carries Hint instead of a
// link (issue #98): the reader's Lookup shows the point, while the word gets
// no underline, Weak Signal or Save, because none of those is keyed on Hint.
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

	// Hint is read-time enrichment from grammar_points (see GrammarHint), set
	// by the store when a Story loads. Never stored on the token.
	Hint *GrammarHint

	// content marks the morphemes the coverage gate counts (nouns, verbs,
	// adjectives, adverbs; see isContent). Set during materialisation,
	// never stored: the counts it produced are stored instead.
	content bool

	// conjunction marks a 接続詞 token (see materialise). Like content it is
	// set during materialisation and never stored; the style check reads it.
	conjunction bool

	// alts are the other dictionary entries sharing this token's spelling
	// (see VocabHit.Alts); tagKnown links the token to the Learner's known
	// one. Never stored.
	alts []VocabHit
}

// Span is a Grammar Span inside a sentence: runes [Start,End) realising one
// of the Focus Set's Grammar Points. IsFocus marks a span whose point was in
// the Focus Set — the grammar half of the items a comprehension answer writes
// Practice Records for (the gate rejects spans citing other points, so a
// validated Story's spans are all focus spans; failed Stories may keep
// others, stored unflagged).
//
// Pattern, Meaning and JLPTLevel are not stored on the span: readers fill
// them in from grammar_points when they load a Story (the Postgres store
// joins them in), so the reader's hover shows the Grammar Point instantly.
// A Span built without them reads as empty strings.
type Span struct {
	ID             uuid.UUID
	Start          int
	End            int
	GrammarPointID int64
	IsFocus        bool

	// Read-time enrichment from grammar_points (issue #11).
	Pattern   string
	Meaning   string
	JLPTLevel string
}

// GrammarHint names the Grammar Point an unlinked token expresses when its
// surface is exactly that point's pattern (issue #98): the particles は, が,
// を, に, の, で, と, も, か, ね and よ. It is computed when a Story loads, from
// the Grammar Catalogue as it stands, so it needs no relink and an edited
// catalogue shows up at once. A pattern with rows at several levels resolves to
// the lowest level (N5 first), then catalogue order.
type GrammarHint struct {
	GrammarPointID int64
	Pattern        string
	Meaning        string
	JLPTLevel      string
}

// hintParticles are the only surfaces a GrammarHint may attach to. A pattern
// match alone is not enough: the catalogue has single-kana rows such as な
// (N4, "don't ~") and kagome leaves the auxiliary な unlinked too, so a bare
// match would hint きれいな with the wrong meaning. The stored token keeps no
// part of speech, so the rule is an explicit list of particles instead.
var hintParticles = map[string]bool{
	"は": true, "が": true, "を": true, "に": true, "の": true, "で": true,
	"と": true, "も": true, "へ": true, "や": true, "か": true, "ね": true,
	"よ": true, "から": true, "まで": true, "より": true,
}

// hintable reports whether a token's surface may carry a GrammarHint.
func hintable(surface string) bool { return hintParticles[surface] }

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
				return fmt.Errorf("span [%d,%d) for grammar point %d is outside sentence %d (%d characters: %q)",
					sp.Start, sp.End, sp.GrammarPointID, i, n, sen.JA)
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
		if len(q.OptionsJA) > MaxQuestionOptions {
			return fmt.Errorf("question %d has %d options, want at most %d", i, len(q.OptionsJA), MaxQuestionOptions)
		}
		if q.AnswerIndex < 0 || q.AnswerIndex >= len(q.OptionsJA) {
			return fmt.Errorf("question %d answer_index %d is outside %d options", i, q.AnswerIndex, len(q.OptionsJA))
		}
	}
	return nil
}

// hasKanji reports whether a surface contains a kanji codepoint (CJK
// Unified Ideographs plus the Extension A block; Japanese sentence
// punctuation and kana are not kanji).
func hasKanji(s string) bool {
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF || r >= 0x3400 && r <= 0x4DBF {
			return true
		}
	}
	return false
}

// Furigana reports whether a token's reading should be shown for a user with
// the given Furigana Threshold (GLOSSARY.md): the threshold is the SRS Level
// at or above which Known Items appear without furigana. Ruby is only worth
// rendering when the surface actually contains kanji — a kana particle's
// "reading" is just its surface, so kana-only tokens never get ruby. Among
// kanji surfaces: unknown tokens always show the reading (the Learner has no
// reading for them yet), Known Items show it only below the threshold.
func Furigana(t Token, threshold int) bool {
	if !hasKanji(t.Surface) {
		return false
	}
	if t.Tag != TagKnown || t.SRSLevel == nil {
		return true
	}
	return *t.SRSLevel < threshold
}
