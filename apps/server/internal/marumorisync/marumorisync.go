// Package marumorisync turns a MaruMori connection (internal/marumori) into stored
// knowledge state (issue #5, docs/adr/0002): Known Items linked to our KANJIDIC and
// JMdict data, per-Sync history, Grammar SRS observations, and Sync runs. Like
// internal/aiprovider it is the orchestration layer: HTTP handlers and the scheduler
// call a Service, the Service drives a Store and the upstream client.
//
// ADR-0002 is enforced at the type level: nothing in this package carries item content
// (meanings, definitions, readings, mnemonics, examples, personal notes). AppliedItem
// keeps MaruMori's item text only as a fallback when no reference-data link was found.
package marumorisync

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
)

// Kind distinguishes the two Known Item types, mirroring the marumori_known_items.kind
// column and the MaruMori /known/* endpoints.
type Kind string

const (
	KindKanji      Kind = "kanji"
	KindVocabulary Kind = "vocabulary"
)

// Kinds lists both kinds in a stable order.
var Kinds = []Kind{KindKanji, KindVocabulary}

// Errors; match with errors.Is.
var (
	// ErrNoKey: the Learner has no stored MaruMori API key (not connected).
	ErrNoKey = errors.New("no MaruMori API key stored")
	// ErrSyncRunning: a Sync run is already in flight for this Learner.
	ErrSyncRunning = errors.New("a Sync is already running")
	// ErrInvalidKey: the submitted API key is unusable.
	ErrInvalidKey = errors.New("invalid MaruMori API key")
	// ErrKeyUnreadable: the stored ciphertext cannot be decrypted (SECRETS_KEY changed?).
	ErrKeyUnreadable = errors.New("the stored MaruMori API key cannot be decrypted (was SECRETS_KEY changed?); enter the key again")
)

// RunStatus is the state of one Sync run.
type RunStatus string

const (
	RunRunning RunStatus = "running"
	RunOK      RunStatus = "ok"
	RunFailed  RunStatus = "failed"
)

// Change is what one Sync did to one Known Item; it is the change column of
// marumori_known_item_history. An item dropping to SRS level 0 disappears: the
// /known/* filter only reports level 1+.
type Change string

const (
	ChangeAppeared     Change = "appeared"
	ChangeLevelChanged Change = "level_changed"
	ChangeDisappeared  Change = "disappeared"
)

// Settings is the stored MaruMori connection. A row exists exactly while the Learner
// is connected. APIKeyEncrypted is internal/secrets ciphertext: never select it into a
// response or a log.
type Settings struct {
	APIKeyEncrypted string
	ConnectedAt     time.Time
}

// KnownLevel is the stored SRS state of one Known Item, keyed by (kind, marumori_id)
// in the Store. Items marked disappeared are not reported: they are no longer Known.
type KnownLevel struct {
	Kind       Kind
	MaruMoriID string
	Level      int
}

// AppliedItem is one Known Item to insert or refresh. Link is exactly one of
// KanjiLiteral / EntSeq; when neither is set the item is unlinked and Text (the
// MaruMori item text) is kept instead — the only MaruMori wording this feature stores.
type AppliedItem struct {
	Kind         Kind
	MaruMoriID   string
	Level        int
	Text         *string // non-nil only when unlinked
	KanjiLiteral *string // kind kanji, found in KANJIDIC2
	EntSeq       *int64  // kind vocabulary, linked to a JMdict entry
}

// DisappearedRef names a stored Known Item that MaruMori no longer reports; the Store
// marks it (never deletes it).
type DisappearedRef struct {
	Kind       Kind
	MaruMoriID string
}

// HistoryEntry is one row of Sync history for one Known Item.
type HistoryEntry struct {
	Kind       Kind
	MaruMoriID string
	Change     Change
	OldLevel   *int
	NewLevel   *int
}

// Counts is what one completed Sync found and stored (MaruMoriCounts in
// api/openapi.yaml). It is persisted with the run.
type Counts struct {
	Kanji            int `json:"kanji"`
	Vocabulary       int `json:"vocabulary"`
	GrammarReviews   int `json:"grammarReviews"`
	GrammarLessons   int `json:"grammarLessons"`
	Linked           int `json:"linked"`
	Unlinked         int `json:"unlinked"`
	Ambiguous        int `json:"ambiguous"`
	New              int `json:"new"`
	LevelChanges     int `json:"levelChanges"`
	Disappeared      int `json:"disappeared"`
	SkippedLevelZero int `json:"skippedLevelZero"`
}

// SyncRun is one Sync run: running while in flight, then ok or failed. A failed run's
// Error is Learner-facing text that never contains the API key.
type SyncRun struct {
	ID         uuid.UUID
	Status     RunStatus
	StartedAt  time.Time
	FinishedAt *time.Time
	Error      *string
	Counts     *Counts
}

// Totals summarises the stored knowledge state for the status view. VocabularyLinked
// is the linked share of the stored Known vocabulary; the HTTP layer turns it into a
// 0..1 rate.
type Totals struct {
	Kanji            int
	Vocabulary       int
	VocabularyLinked int
	LastSyncAt       *time.Time
}

// SyncBatch is one Sync's whole effect on the stored state, applied atomically.
type SyncBatch struct {
	Items       []AppliedItem
	Disappeared []DisappearedRef
	History     []HistoryEntry
	Grammar     []marumori.GrammarObservation
	Home        *marumori.Home
	SyncedAt    time.Time
}

// Store persists the MaruMori connection, the knowledge state, and Sync runs. Every
// method is scoped to userID; data of another user is simply ErrNoKey/absent. A Store
// implementation may assume it is called by one Service (Syncs are single-flight per
// user), but must keep concurrent users apart.
type Store interface {
	// GetSettings returns the stored connection; ErrNoKey when the Learner is not
	// connected.
	GetSettings(ctx context.Context, userID uuid.UUID) (Settings, error)
	// SetAPIKey inserts or replaces the key. ConnectedAt is set on first connect and
	// kept across key replacements.
	SetAPIKey(ctx context.Context, userID uuid.UUID, encrypted string, at time.Time) (Settings, error)
	// DeleteAPIKey removes the connection; idempotent. Already-synced state stays.
	DeleteAPIKey(ctx context.Context, userID uuid.UUID) error
	// UsersWithKeys lists every user with a stored key (the scheduler's work list).
	UsersWithKeys(ctx context.Context) ([]uuid.UUID, error)

	// KnownLevels returns the user's present (not disappeared) Known Items.
	KnownLevels(ctx context.Context, userID uuid.UUID) ([]KnownLevel, error)
	// KnowledgeTotals counts the present Known Items and their vocabulary link rate.
	KnowledgeTotals(ctx context.Context, userID uuid.UUID) (Totals, error)

	// StartRun inserts a running run; ErrSyncRunning if one is already running for
	// this user.
	StartRun(ctx context.Context, userID, runID uuid.UUID, startedAt time.Time) error
	// FinishRun closes a running run as ok (failure nil) or failed.
	FinishRun(ctx context.Context, userID, runID uuid.UUID, finishedAt time.Time, failure *string, counts *Counts) error
	// RecentRuns returns the user's runs, newest first.
	RecentRuns(ctx context.Context, userID uuid.UUID, limit int) ([]SyncRun, error)
	// LastSuccessfulRun returns the newest ok run, if any.
	LastSuccessfulRun(ctx context.Context, userID uuid.UUID) (SyncRun, bool, error)

	// ApplySync applies one Sync's whole batch atomically: upsert Items (clearing any
	// disappeared mark and refreshing last_seen_at), mark Disappeared, append History,
	// upsert Grammar, and store Home.
	ApplySync(ctx context.Context, userID, runID uuid.UUID, batch SyncBatch) error
}
