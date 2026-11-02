package story

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// Settings configures generation for every user: the gate thresholds and
// prompt budget (cmd/server passes them from STORY_* env vars). The per-user
// Furigana Threshold lives on the user row, read through Store.
type Settings struct {
	// MinCoverage: minimum known-word coverage over content-word tokens.
	MinCoverage float64
	// MinFocusFraction: minimum share of the Focus Set's vocabulary items
	// that must appear in the Story.
	MinFocusFraction float64
	// MaxAttempts: total generation attempts including the first.
	MaxAttempts int
	// PromptKnownLimit: how many Known Items the prompt lists (0 → default).
	PromptKnownLimit int
	// RetryCooldown: how long to skip regeneration while the user's newest
	// Story is a gate failure (failure backoff for a stuck provider). Zero
	// disables the cooldown; cmd/server passes STORY_RETRY_COOLDOWN, whose
	// default is DefaultRetryCooldown.
	RetryCooldown time.Duration
}

// WithDefaults fills the zero fields with the package defaults.
func (s Settings) WithDefaults() Settings {
	if s.MinCoverage <= 0 {
		s.MinCoverage = DefaultCoverage
	}
	if s.MinFocusFraction <= 0 {
		s.MinFocusFraction = DefaultFocusFraction
	}
	if s.MaxAttempts <= 0 {
		s.MaxAttempts = DefaultMaxAttempts
	}
	if s.PromptKnownLimit <= 0 {
		s.PromptKnownLimit = DefaultPromptKnownLimit
	}
	return s
}

// FocusSet is the Story-facing view of mastery's Focus Set: the Known Items
// a Story is built around. Only the vocabulary half needs content for the
// prompt (the words themselves); grammar is named by catalogue point id.
type FocusSet struct {
	Vocab   []VocabFocus
	Grammar []GrammarFocus
}

// VocabFocus is one Focus Set vocabulary item resolved to its jmdict side.
type VocabFocus struct {
	EntSeq   int64
	JA       string
	EN       string
	SRSLevel int
}

// GrammarFocus is one Focus Set grammar point.
type GrammarFocus struct {
	PointID int64
	Pattern string
}

// Empty reports whether the Focus Set offers nothing to build on.
func (f FocusSet) Empty() bool { return len(f.Vocab) == 0 }

// KnownView is a Vocabulary Item's Known Item state for one user, with the
// SRS Level that drives furigana and the Focus Set.
type KnownView struct {
	IsKnown  bool
	SRSLevel int
}

// Store persists Stories, ratings, and the background state. Every method is
// scoped to the Story's or user's owner; foreign ids read as ErrNotFound.
type Store interface {
	// Save inserts a Story with its sentences, tokens, spans, questions, and
	// vocab items in one transaction; s.ID is assigned if empty.
	Save(ctx context.Context, s *Story) error
	Get(ctx context.Context, id, userID uuid.UUID) (*Story, error)
	// List returns one page of the user's Stories, newest first, with the
	// total count; each carries the user's own rating when there is one.
	// Validated Stories only — a Story that failed the gate is kept for
	// analysis, not offered.
	List(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*Story, int, error)
	// Rate upserts the user's rating; ErrNotFound for a foreign Story.
	Rate(ctx context.Context, storyID, userID uuid.UUID, r Rating) error
	// RatingCounts totals the user's ratings by genre and rating.
	RatingCounts(ctx context.Context, userID uuid.UUID) (map[string]map[Rating]int, error)

	// LatestAutomaticStory returns the user's newest VALIDATED Automatic
	// Story — Today's Story (GLOSSARY.md) — whatever its Read mark. On-demand
	// Stories never qualify. (false) when they have none yet.
	LatestAutomaticStory(ctx context.Context, userID uuid.UUID) (*Story, bool, error)
	// LastFailedAt reports the newest Story's creation time when that newest
	// Story failed the gate — the failure backoff's clock (false when the
	// user has no stories or their newest one validated).
	LastFailedAt(ctx context.Context, userID uuid.UUID) (at time.Time, failed bool, err error)

	// GenresByLastActivity returns the genres of the user's recent Stories,
	// newest first; it seeds genre choice when there are no ratings.
	GenresByLastActivity(ctx context.Context, userID uuid.UUID, limit int) ([]string, error)

	// RecordGenerationDuration samples the wall time of one successful
	// generation (issue #33); RecentGenerationDurations reads the most
	// recent samples, newest first, so the On-demand progress bar fills its
	// writing stage at the Learner's own pace.
	RecordGenerationDuration(ctx context.Context, userID uuid.UUID, finishedAt time.Time, ms int64) error
	RecentGenerationDurations(ctx context.Context, userID uuid.UUID, limit int) ([]time.Duration, error)

	// StoryGenreThemeSuggestions returns the distinct genres and themes of
	// the user's VALIDATED Stories, newest first — the autocomplete options
	// for the Generate box and the settings form (issue #33).
	StoryGenreThemeSuggestions(ctx context.Context, userID uuid.UUID) (genres, themes []string, err error)

	// FuriganaThreshold reads and SetFuriganaThreshold writes the user's
	// Furigana Threshold SRS Level (0–9).
	FuriganaThreshold(ctx context.Context, userID uuid.UUID) (int, error)
	SetFuriganaThreshold(ctx context.Context, userID uuid.UUID, level int) error

	// BlurTranslation reads and SetBlurTranslation write the reader's Blur
	// Translation preference (issue #11): story translations start blurred
	// when true. Default true, stored on the user row.
	BlurTranslation(ctx context.Context, userID uuid.UUID) (bool, error)
	SetBlurTranslation(ctx context.Context, userID uuid.UUID, blur bool) error
	// LookupHoldMs reads and SetLookupHoldMs write the lookup-hold threshold
	// for reader Weak Signals (issue #12): milliseconds a Lookup Menu must
	// stay open before the reader reports a signal. Default 800, stored on
	// the user row.
	LookupHoldMs(ctx context.Context, userID uuid.UUID) (int, error)
	SetLookupHoldMs(ctx context.Context, userID uuid.UUID, holdMs int) error

	// StoryPrefs reads and SetStoryPrefs write the Learner's preferred
	// genre/theme for future stories ("" = "surprise me" / no theme) and the
	// Learner's Timezone (IANA name; "" = unset, the server's own timezone
	// decides which local day an Automatic Story belongs to).
	StoryPrefs(ctx context.Context, userID uuid.UUID) (genre, theme, timezone string, err error)
	SetStoryPrefs(ctx context.Context, userID uuid.UUID, genre, theme, timezone string) error

	// MarkPracticed flips a Story's practiced flag; it reports true only for
	// the first call ever for that Story (the at-most-once guard for writing
	// its Practice Records).
	MarkPracticed(ctx context.Context, storyID uuid.UUID, at time.Time) (bool, error)
	// ResetPracticed undoes a MarkPracticed claim when the Story's practiced
	// flag still holds exactly the value that call set (the rollback for a
	// Practice Record append that failed after the claim).
	ResetPracticed(ctx context.Context, storyID uuid.UUID, at time.Time) error

	// MarkRead sets a Story's Read mark (issue #31) and ClearRead unsets it;
	// both are the library's Read toggle. Delete removes the Story and its
	// rating; the Practice Records it wrote stay (the mastery log is append-
	// only). All three are owner-scoped: a foreign or missing id is
	// ErrNotFound.
	MarkRead(ctx context.Context, storyID, userID uuid.UUID, at time.Time) error
	ClearRead(ctx context.Context, storyID, userID uuid.UUID) error
	Delete(ctx context.Context, storyID, userID uuid.UUID) error

	// UserIDs lists the users the background generator considers.
	UserIDs(ctx context.Context) ([]uuid.UUID, error)
}

// Focus supplies the Focus Set and the Known-Item views generation needs.
// The production implementation wraps internal/mastery plus refdata; tests
// hand in fixtures.
type Focus interface {
	// FocusFor returns the Focus Set resolved to prompt-ready content.
	FocusFor(ctx context.Context, userID uuid.UUID) (FocusSet, error)
	// KnownVocab reports, per ent_seq, whether the item is a Known Item for
	// the user (and its SRS Level when it is).
	KnownVocab(ctx context.Context, userID uuid.UUID, entSeqs []int64) (map[int64]KnownView, error)
	// KnownWords returns up to limit of the user's Known vocabulary items,
	// most solid first, for the prompt's Known Items list.
	KnownWords(ctx context.Context, userID uuid.UUID, limit int) ([]VocabFocus, error)
}

// KnownSource is the Focus membership query generation runs per candidate;
// Focus satisfies it.
type KnownSource interface {
	KnownVocab(ctx context.Context, userID uuid.UUID, entSeqs []int64) (map[int64]KnownView, error)
}

// VocabLookup resolves a token to a jmdict entry: try the surface as written,
// then the dictionary form. ok=false means the token linked to no entry — an
// unlinked vocabulary item, which counts as unknown for coverage (issue #10).
// The production implementation is refdata.Store.FindVocabulary.
type VocabLookup interface {
	Lookup(ctx context.Context, surface, dictionary string) (VocabHit, bool, error)
}

// VocabHit is what a lookup found: the entry and the form that matched.
type VocabHit struct {
	EntSeq int64
	// Headword and first gloss for the Story's vocab_items list.
	JA string
	EN string
}
