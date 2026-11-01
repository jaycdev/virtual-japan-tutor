package marumorisync

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

// Upstream is the slice of MaruMori a Sync reads: knowledge state only, never item
// content (ADR-0002). *marumori.Client implements it.
type Upstream interface {
	Home(ctx context.Context) (marumori.Home, error)
	KnownKanji(ctx context.Context) ([]marumori.KnownItem, error)
	KnownVocabulary(ctx context.Context) ([]marumori.KnownItem, error)
	GrammarLessons(ctx context.Context) ([]marumori.GrammarObservation, error)
	GrammarReviews(ctx context.Context) ([]marumori.GrammarObservation, error)
}

// Reference links MaruMori plain-text items to our dictionary snapshot. *refdata.Store
// implements it. Linking is best-effort: an item that does not resolve is handled by
// the kind-specific fallback in the Service.
type Reference interface {
	FindKanji(ctx context.Context, literal string) (refdata.Kanji, bool, error)
	FindVocabulary(ctx context.Context, written, reading string) ([]refdata.Vocabulary, error)
}

// maxAPIKeyLength bounds what we are willing to seal and forward upstream.
const maxAPIKeyLength = 4096

// defaultRecentLimit is how many runs RecentSyncs lists.
const defaultRecentLimit = 10

// finishRunTimeout bounds the write that closes a Sync run.
const finishRunTimeout = 10 * time.Second

// Service orchestrates MaruMori Syncs: it fetches each learner's knowledge state
// through an Upstream, links it against the dictionary snapshot, records SRS level
// history, and stores the run's counts through a Store. The learner's API key is
// decrypted per run, forwarded only to the upstream client, and never persisted or
// returned in plaintext.
//
// What is stored per kind (ADR-0002):
//   - Kanji: linked to KANJIDIC2 when found; otherwise MaruMori's item text is kept,
//     because for kanji that text is just the character itself.
//   - Vocabulary: linked to a JMdict entry, or not stored at all — a vocabulary item
//     we cannot link is only MaruMori's rendering of a word, and it is counted
//     (Counts.Unlinked) rather than copied into our knowledge state.
type Service struct {
	store       Store
	box         *secrets.Box
	ref         Reference
	newUpstream func(baseURL, apiKey string) (Upstream, error)
	baseURL     string
	clock       func() time.Time
	log         *slog.Logger
}

// Option configures a Service.
type Option func(*Service)

// WithClock overrides the clock used for all run and batch timestamps (tests and the
// scheduler contract use this to make timestamps predictable).
func WithClock(clock func() time.Time) Option {
	return func(s *Service) { s.clock = clock }
}

// WithBaseURL overrides the MaruMori API base URL (tests point it at a fake server).
func WithBaseURL(baseURL string) Option {
	return func(s *Service) { s.baseURL = baseURL }
}

// WithLogger overrides the structured logger used for scheduler warnings.
func WithLogger(log *slog.Logger) Option {
	return func(s *Service) { s.log = log }
}

// NewService wires the orchestration layer. newUpstream builds the per-run upstream
// reader for (baseURL, apiKey); in production it returns a *marumori.Client, so the
// decrypted key exists only inside that client's lifetime.
func NewService(store Store, box *secrets.Box, ref Reference, newUpstream func(baseURL, apiKey string) (Upstream, error), opts ...Option) *Service {
	s := &Service{
		store:       store,
		box:         box,
		ref:         ref,
		newUpstream: newUpstream,
		baseURL:     marumori.KnownDefaultBaseURL,
		clock:       func() time.Time { return time.Now().UTC() },
		log:         slog.Default(),
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// Status is what the Settings page shows about one learner's MaruMori connection.
// LastFailure is the newest failed run, and only while it is newer than LastSync: once a
// Sync has succeeded, an older failure is not what the Learner needs to be told.
type Status struct {
	Connected   bool       `json:"connected"`
	ConnectedAt *time.Time `json:"connectedAt,omitempty"`
	LastSync    *SyncRun   `json:"lastSync,omitempty"`
	LastFailure *SyncRun   `json:"lastFailure,omitempty"`
	Totals      *Totals    `json:"totals,omitempty"`
}

// SetAPIKey validates and seals a new MaruMori API key for the authenticated learner.
func (s *Service) SetAPIKey(ctx context.Context, apiKey string) error {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return err
	}
	if err := validateAPIKey(apiKey); err != nil {
		return err
	}
	sealed, err := s.box.Encrypt(apiKey)
	if err != nil {
		return fmt.Errorf("encrypt MaruMori API key: %w", err)
	}
	_, err = s.store.SetAPIKey(ctx, userID, sealed, s.clock())
	return err
}

// RemoveAPIKey disconnects the learner. Already-synced knowledge stays (issue #5 spec).
func (s *Service) RemoveAPIKey(ctx context.Context) error {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return err
	}
	return s.store.DeleteAPIKey(ctx, userID)
}

// Status reports connection state, the last successful run, and stored totals. A
// learner with no key is simply not connected: not an error.
func (s *Service) Status(ctx context.Context) (Status, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return Status{}, err
	}
	status := Status{}
	settings, err := s.store.GetSettings(ctx, userID)
	switch {
	case errors.Is(err, ErrNoKey):
	case err != nil:
		return Status{}, err
	default:
		status.Connected = settings.APIKeyEncrypted != ""
		if status.Connected {
			connectedAt := settings.ConnectedAt
			status.ConnectedAt = &connectedAt
		}
	}
	totals, err := s.store.KnowledgeTotals(ctx, userID)
	if err != nil {
		return Status{}, err
	}
	if totals.Kanji > 0 || totals.Vocabulary > 0 {
		status.Totals = &totals
	}
	if last, ok, err := s.store.LastSuccessfulRun(ctx, userID); err != nil {
		return Status{}, err
	} else if ok {
		run := last
		status.LastSync = &run
	}
	if failure, ok, err := s.store.LastFailedRun(ctx, userID); err != nil {
		return Status{}, err
	} else if ok && (status.LastSync == nil || failure.StartedAt.After(status.LastSync.StartedAt)) {
		run := failure
		status.LastFailure = &run
	}
	return status, nil
}

// Sync runs one Sync for the authenticated learner.
func (s *Service) Sync(ctx context.Context) (SyncRun, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return SyncRun{}, err
	}
	return s.SyncUser(ctx, userID)
}

// SyncUser runs one Sync for a specific user; the scheduler uses it after resolving
// user ids itself. A Sync that fails (unreadable key, upstream failure, store failure)
// completes as a failed run and returns it with a nil error: the run row records what
// happened, and HTTP reports it as data, not as a server error.
func (s *Service) SyncUser(ctx context.Context, userID uuid.UUID) (SyncRun, error) {
	settings, err := s.store.GetSettings(ctx, userID)
	if err != nil {
		return SyncRun{}, err // ErrNoKey: no run is recorded for a keyless Sync
	}

	runID := uuid.New()
	startedAt := s.clock()
	if err := s.store.StartRun(ctx, userID, runID, startedAt); err != nil {
		return SyncRun{}, err // ErrSyncRunning
	}

	apiKey, err := s.box.Decrypt(settings.APIKeyEncrypted)
	if err != nil {
		// SECRETS_KEY changed or the row is corrupt: advise without reading anything
		// from MaruMori with data we cannot trust.
		return s.finishFailed(ctx, userID, runID, startedAt, ErrKeyUnreadable.Error())
	}

	upstream, err := s.newUpstream(s.baseURL, apiKey)
	if err != nil {
		return s.finishFailed(ctx, userID, runID, startedAt, describeFailure(err, apiKey))
	}
	counts, batch, upstreamErr := s.collect(ctx, upstream)
	if upstreamErr != nil {
		message := describeFailure(upstreamErr, apiKey)
		return s.finishFailed(ctx, userID, runID, startedAt, message)
	}

	known, err := s.store.KnownLevels(ctx, userID)
	if err != nil {
		return s.finishFailed(ctx, userID, runID, startedAt, fmt.Sprintf("read stored knowledge: %v", err))
	}
	counts.New, counts.LevelChanges, counts.Disappeared, batch.Disappeared, batch.History = diff(known, batch.Items)

	batch.SyncedAt = s.clock()
	if err := s.store.ApplySync(ctx, userID, runID, batch); err != nil {
		return s.finishFailed(ctx, userID, runID, startedAt, fmt.Sprintf("record synced knowledge: %v", err))
	}

	finishedAt := s.clock()
	countsCopy := counts
	if err := s.finishRun(ctx, userID, runID, finishedAt, nil, &countsCopy); err != nil {
		return SyncRun{}, err
	}
	s.log.Info("marumori sync finished", "user_id", userID.String(),
		"kanji", counts.Kanji, "vocabulary", counts.Vocabulary, "new", counts.New)
	return SyncRun{ID: runID, Status: RunOK, StartedAt: startedAt, FinishedAt: &finishedAt, Counts: &counts}, nil
}

// RecentSyncs lists the authenticated learner's runs, newest first.
func (s *Service) RecentSyncs(ctx context.Context) ([]SyncRun, error) {
	userID, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	return s.store.RecentRuns(ctx, userID, defaultRecentLimit)
}

// SyncScheduled runs one Sync for every learner with a stored key. A per-user failure
// (bad key, MaruMori outage for one account) is recorded as that user's failed run and
// does not stop the sweep; only a store failure ends it.
func (s *Service) SyncScheduled(ctx context.Context) error {
	userIDs, err := s.store.UsersWithKeys(ctx)
	if err != nil {
		return err
	}
	for _, userID := range userIDs {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		run, err := s.SyncUser(ctx, userID)
		if err != nil {
			s.log.Warn("scheduled marumori sync failed", "user_id", userID.String(), "error", err)
			continue
		}
		if run.Status == RunFailed {
			s.log.Warn("scheduled marumori sync failed", "user_id", userID.String(), "error", derefString(run.Error))
		}
	}
	return nil
}

// collect reads the five knowledge-state endpoints and links what it reads into a
// SyncBatch. It stops at the first upstream failure.
func (s *Service) collect(ctx context.Context, upstream Upstream) (Counts, SyncBatch, error) {
	var counts Counts

	home, err := upstream.Home(ctx)
	if err != nil {
		return counts, SyncBatch{}, err
	}
	kanji, err := upstream.KnownKanji(ctx)
	if err != nil {
		return counts, SyncBatch{}, err
	}
	vocabulary, err := upstream.KnownVocabulary(ctx)
	if err != nil {
		return counts, SyncBatch{}, err
	}
	lessons, err := upstream.GrammarLessons(ctx)
	if err != nil {
		return counts, SyncBatch{}, err
	}
	reviews, err := upstream.GrammarReviews(ctx)
	if err != nil {
		return counts, SyncBatch{}, err
	}

	batch := SyncBatch{Home: &home}

	for _, item := range kanji {
		switch {
		case item.MaruMoriID == "" || item.Text == "":
		case item.Level == 0:
			counts.SkippedLevelZero++ // learning, not Known; any stored row disappears below
		case item.Level < 0 || item.Level > 9:
		default:
			counts.Kanji++
			found, ok, err := s.ref.FindKanji(ctx, item.Text)
			if err != nil {
				return counts, batch, fmt.Errorf("link kanji %q: %w", item.Text, err)
			}
			applied := AppliedItem{Kind: KindKanji, MaruMoriID: item.MaruMoriID, Level: item.Level}
			if ok {
				literal := found.Literal
				applied.KanjiLiteral = &literal
				counts.Linked++
			} else {
				// Kanji items are identified by the character itself; keep it.
				text := item.Text
				applied.Text = &text
				counts.Unlinked++
			}
			batch.Items = append(batch.Items, applied)
		}
	}

	for _, item := range vocabulary {
		switch {
		case item.MaruMoriID == "" || item.Text == "":
		case item.Level == 0:
			counts.SkippedLevelZero++ // learning, not Known; any stored row disappears below
		case item.Level < 0 || item.Level > 9:
		default:
			candidates, err := s.ref.FindVocabulary(ctx, item.Text, "")
			if err != nil {
				return counts, batch, fmt.Errorf("link vocabulary %q: %w", item.Text, err)
			}
			if len(candidates) == 0 {
				// No JMdict entry: this stays MaruMori-side; we count it, not copy it.
				counts.Unlinked++
				continue
			}
			if len(candidates) > 1 {
				// Plain text alone can match several entries. Pick deterministically
				// (easiest JLPT level first, then the query's common-first order) and
				// count the ambiguity instead of hiding it.
				sortCandidates(candidates)
				counts.Ambiguous++
			}
			entSeq := candidates[0].EntSeq
			batch.Items = append(batch.Items, AppliedItem{
				Kind: KindVocabulary, MaruMoriID: item.MaruMoriID, Level: item.Level, EntSeq: &entSeq,
			})
			counts.Vocabulary++
			counts.Linked++
		}
	}

	// Grammar observations merge across the two endpoints: reviews carry the SRS
	// level and suspension; lessons only prove the point exists on the account.
	grammar := make(map[string]marumori.GrammarObservation, len(lessons)+len(reviews))
	for _, observation := range append(append([]marumori.GrammarObservation{}, lessons...), reviews...) {
		if observation.MaruMoriID == "" {
			continue
		}
		merged, seen := grammar[observation.MaruMoriID]
		if !seen {
			merged = marumori.GrammarObservation{MaruMoriID: observation.MaruMoriID}
		}
		if observation.Level != nil {
			merged.Level = observation.Level
		}
		if observation.Suspended != nil {
			merged.Suspended = observation.Suspended
		}
		grammar[observation.MaruMoriID] = merged
	}
	// Deterministic batch order: reviews, then lessons-only.
	for _, observation := range reviews {
		if merged, ok := grammar[observation.MaruMoriID]; ok {
			batch.Grammar = append(batch.Grammar, merged)
			delete(grammar, observation.MaruMoriID)
		}
	}
	for _, observation := range lessons {
		if merged, ok := grammar[observation.MaruMoriID]; ok {
			batch.Grammar = append(batch.Grammar, merged)
			delete(grammar, observation.MaruMoriID)
		}
	}
	counts.GrammarLessons = len(lessons)
	counts.GrammarReviews = len(reviews)

	return counts, batch, nil
}

// itemKey addresses one Known Item the way the schema does: (kind, MaruMori id).
type itemKey struct {
	kind Kind
	id   string
}

// diff turns this Sync's items against the previously stored Known Items into
// (new, levelChanged, disappeared) counts plus the batch's history and disappearance
// marks. An item is "present" exactly when this Sync stores it as Known: MaruMori
// reporting it at level 0 (learning) or dropping it entirely both make a stored row
// disappear.
func diff(known []KnownLevel, items []AppliedItem) (appeared, changed, gone int, disappeared []DisappearedRef, history []HistoryEntry) {
	prev := make(map[itemKey]int, len(known))
	for _, k := range known {
		prev[itemKey{k.Kind, k.MaruMoriID}] = k.Level
	}
	present := make(map[itemKey]bool, len(items))
	for _, it := range items {
		present[itemKey{it.Kind, it.MaruMoriID}] = true
	}

	for _, it := range items {
		k := itemKey{it.Kind, it.MaruMoriID}
		oldLevel, seen := prev[k]
		switch {
		case !seen:
			appeared++
			level := it.Level
			history = append(history, HistoryEntry{
				Kind: it.Kind, MaruMoriID: it.MaruMoriID, Change: ChangeAppeared, NewLevel: &level,
			})
		case oldLevel != it.Level:
			changed++
			old, level := oldLevel, it.Level
			history = append(history, HistoryEntry{
				Kind: it.Kind, MaruMoriID: it.MaruMoriID, Change: ChangeLevelChanged, OldLevel: &old, NewLevel: &level,
			})
		}
	}
	for _, k := range known {
		if present[itemKey{k.Kind, k.MaruMoriID}] {
			continue
		}
		gone++
		old := k.Level
		disappeared = append(disappeared, DisappearedRef{Kind: k.Kind, MaruMoriID: k.MaruMoriID})
		history = append(history, HistoryEntry{
			Kind: k.Kind, MaruMoriID: k.MaruMoriID, Change: ChangeDisappeared, OldLevel: &old,
		})
	}
	return appeared, changed, gone, disappeared, history
}

// finishRun closes a run on a context the caller no longer controls. Postgres refuses
// writes on a context that is already done, so closing a run on the request's own context
// would let a Learner who navigated away — or a server shutting down — leave the row
// 'running', which blocks their next Sync until StartRun reaps it. The outcome of a round
// that ran is not the caller's to cancel.
func (s *Service) finishRun(ctx context.Context, userID, runID uuid.UUID, finishedAt time.Time, failure *string, counts *Counts) error {
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), finishRunTimeout)
	defer cancel()
	return s.store.FinishRun(finishCtx, userID, runID, finishedAt, failure, counts)
}

func (s *Service) finishFailed(ctx context.Context, userID uuid.UUID, runID uuid.UUID, startedAt time.Time, message string) (SyncRun, error) {
	message = truncate(message, 2000)
	finishedAt := s.clock()
	failure := &message
	if err := s.finishRun(ctx, userID, runID, finishedAt, failure, nil); err != nil {
		return SyncRun{}, err
	}
	return SyncRun{ID: runID, Status: RunFailed, StartedAt: startedAt, FinishedAt: &finishedAt, Error: failure}, nil
}

func validateAPIKey(apiKey string) error {
	if apiKey == "" || len(apiKey) > maxAPIKeyLength {
		return ErrInvalidKey
	}
	for _, r := range apiKey {
		if r < 0x21 || r > 0x7e { // printable ASCII only: no spaces, tabs, control or multi-byte bytes
			return ErrInvalidKey
		}
	}
	return nil
}

// sortCandidates orders ambiguous vocabulary matches: easiest JLPT level first (no
// level last), keeping the query's order (common entries first, then ent_seq) among
// equals.
func sortCandidates(candidates []refdata.Vocabulary) {
	sort.SliceStable(candidates, func(i, j int) bool {
		return jlptRank(candidates[i].JLPTLevel) < jlptRank(candidates[j].JLPTLevel)
	})
}

func jlptRank(level refdata.Level) int {
	for idx, known := range refdata.Levels {
		if known == level {
			return idx
		}
	}
	return len(refdata.Levels)
}

// describeFailure turns an upstream error into learner-facing text that never contains
// the API key. It reads like internal/llm's descriptions so callers can present them
// the same way.
func describeFailure(err error, apiKey string) string {
	var upstream *marumori.Error
	if errors.As(err, &upstream) {
		message := upstream.Error()
		if upstream.Status > 0 && upstream.Kind != nil {
			message = fmt.Sprintf("%s (status %d)", upstream.Kind.Error(), upstream.Status)
			if upstream.Detail != "" {
				message += ": " + upstream.Detail
			}
		}
		if errors.Is(upstream.Kind, marumori.ErrAuth) {
			message += " — check the MaruMori API key in Settings"
		}
		if upstream.RetryAfter > 0 {
			message += fmt.Sprintf(" (MaruMori asks to retry after %s)", upstream.RetryAfter.Truncate(time.Second))
		}
		return redactKey(message, apiKey)
	}
	return redactKey(fmt.Sprintf("MaruMori sync failed: %v", err), apiKey)
}

// redactKey scrubs the decrypted key from any error surface. The adapter already
// redacts; this is defense in depth.
func redactKey(message, apiKey string) string {
	if apiKey != "" {
		message = strings.ReplaceAll(message, apiKey, "[redacted]")
	}
	return message
}

// truncate keeps s within max bytes. The cut lands on a rune boundary: this text is shown
// to the Learner, and half a UTF-8 character is not text. MaruMori's own detail strings
// are largely Japanese, where a byte slice lands inside a character almost always.
func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max - len("…")
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}
