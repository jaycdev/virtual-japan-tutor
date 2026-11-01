package story

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"sort"
	"strconv"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
)

// ErrNoReadyStory means the user has no story waiting to be opened.
var ErrNoReadyStory = errors.New("story: no story ready for this user")

// Resolver finds the AI provider a user's story generation runs on. The
// aiprovider Service satisfies it; tests fake it.
type Resolver interface {
	ResolveProvider(ctx context.Context, userID uuid.UUID, task aiprovider.Task) (aiprovider.Resolved, error)
}

// Service is the one story entry point: generation, the ready-story
// background flow, the library, ratings, answers and story settings. HTTP
// handlers do no story work beyond translating requests to these methods.
type Service struct {
	store    Store
	gen      *Generator
	focus    Focus
	resolve  Resolver
	results  practice.ResultWriter
	settings Settings
	log      *slog.Logger

	// now is the clock seam (auth's Options.Now precedent): the failure
	// cooldown compares store timestamps against it, and tests drive it.
	now func() time.Time

	// genMu guards genInFlight: the user ids whose story generation is
	// currently running, from the scheduler pass or a post-open regeneration
	// alike (at most one per user, whichever route got there first).
	genMu       sync.Mutex
	genInFlight map[uuid.UUID]bool
}

// NewService wires a Service. settings carries the gate bounds (STORY_* env
// vars); results may be nil only in tests that never answer questions.
func NewService(store Store, gen *Generator, focus Focus, resolve Resolver, results practice.ResultWriter, settings Settings, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{store: store, gen: gen, focus: focus, resolve: resolve, results: results, settings: settings.WithDefaults(), log: log, now: time.Now}
}

// beginGeneration takes the per-user generation slot, reporting false when
// one is already running for that user. The paired release always runs.
func (s *Service) beginGeneration(userID uuid.UUID) (release func(), ok bool) {
	s.genMu.Lock()
	if s.genInFlight == nil {
		s.genInFlight = map[uuid.UUID]bool{}
	}
	if s.genInFlight[userID] {
		s.genMu.Unlock()
		return nil, false
	}
	s.genInFlight[userID] = true
	s.genMu.Unlock()
	var once sync.Once
	return func() {
		once.Do(func() {
			s.genMu.Lock()
			delete(s.genInFlight, userID)
			s.genMu.Unlock()
		})
	}, true
}

// EnsureReady makes sure the user has a ready story, generating one only
// when they have none or their Focus Set has changed significantly since the
// last story (see FocusChanged). When nothing changed and a ready story
// exists, this is a cheap snapshot comparison with no LLM call — that is
// what makes the background scheduler affordable.
//
// Two brakes keep a broken provider affordable: at most one generation per
// user runs at a time (from this method or a post-open regeneration,
// whichever arrives first), and while the user's newest Story is a gate
// failure younger than Settings.RetryCooldown the pass is skipped — a stuck
// user then costs one generation per cooldown window, not one per interval.
func (s *Service) EnsureReady(ctx context.Context, userID uuid.UUID) error {
	release, ok := s.beginGeneration(userID)
	if !ok {
		s.log.Debug("story: generation already in flight for this user; skipping", "user_id", userID)
		return nil
	}
	defer release()

	fset, err := s.focus.FocusFor(ctx, userID)
	if err != nil {
		return fmt.Errorf("focus set: %w", err)
	}
	if fset.Empty() {
		return nil // nothing to build a story from yet
	}
	_, isReady, err := s.store.ReadyStoryID(ctx, userID)
	if err != nil {
		return err
	}
	snap, err := s.store.FocusSnapshot(ctx, userID)
	if err != nil {
		return err
	}
	keys := s.focus.SnapshotKeys(fset)
	if isReady && !FocusChanged(snap, keys) {
		return nil
	}
	if s.settings.RetryCooldown > 0 {
		at, failed, err := s.store.LastFailedAt(ctx, userID)
		if err != nil {
			return err
		}
		if failed && s.now().UTC().Sub(at) < s.settings.RetryCooldown {
			s.log.Info("story: newest story failed the gate recently; waiting out the retry cooldown",
				"user_id", userID, "failed_at", at, "cooldown", s.settings.RetryCooldown)
			return nil
		}
	}

	knownWords, err := s.focus.KnownWords(ctx, userID, s.settings.PromptKnownLimit)
	if err != nil {
		return fmt.Errorf("known words: %w", err)
	}
	prefGenre, prefTheme, err := s.store.StoryPrefs(ctx, userID)
	if err != nil {
		return err
	}
	ratings, err := s.store.RatingCounts(ctx, userID)
	if err != nil {
		return err
	}
	recent, err := s.store.GenresByLastActivity(ctx, userID, 5)
	if err != nil {
		return err
	}

	resolved, err := s.resolve.ResolveProvider(ctx, userID, aiprovider.TaskStory)
	if err != nil {
		return err
	}
	if resolved.Client == nil {
		return aiprovider.ErrNotAssigned
	}

	// The Learner's chosen genre beats the rating-steered pick; empty means
	// "surprise me" and PickGenre decides. Disliked genres (net-down-rated)
	// are named in the prompt as "avoid" and already dropped from
	// PickGenre's fallback.
	genre := prefGenre
	if genre == "" {
		genre = PickGenre(ratings, recent)
	}
	req := Request{
		UserID:         userID,
		Settings:       s.settings,
		Focus:          fset,
		Known:          s.focus,
		KnownWords:     knownWords,
		Genre:          genre,
		Theme:          prefTheme,
		DislikedGenres: dislikedGenres(ratings),
	}
	st, genErr := s.gen.Generate(ctx, resolved.Client, req)
	if st == nil {
		return genErr
	}
	if err := s.store.Save(ctx, st); err != nil {
		return err
	}
	if st.Validated {
		if err := s.store.SetReady(ctx, st.ID, userID); err != nil {
			if errors.Is(err, errReadyConflict) {
				// Another generator (another server instance, or a pass that
				// started before this guard existed) marked a different story
				// ready first. The loser stays stored and validated but not
				// ready; the winner is this user's ready story either way.
				s.log.Debug("story: another story became ready first; this one stays in the library unready",
					"user_id", userID, "story_id", st.ID)
				return nil
			}
			return err
		}
		// Only a VALIDATED story retires the significance snapshot: a failed
		// attempt must leave the generator re-armed against the same Focus
		// Set so the next pass retries.
		if err := s.store.SetFocusSnapshot(ctx, userID, keys); err != nil {
			return err
		}
	} else {
		// Failed-story policy: stored for analysis, never offered; the
		// previous ready story (if any) stays.
		s.log.Warn("story failed the validation gate; stored but not offered",
			"user_id", userID, "story_id", st.ID, "attempts", st.Attempts,
			"known_words", st.KnownWords, "content_words", st.ContentWords,
			"focus_hit", st.FocusHit, "focus_items", st.FocusItems)
	}
	return genErr
}

// OpenReady returns the ready story and clears its ready marker, so the next
// generation pass re-arms. Reading is a plain store read — the request path
// never waits on an LLM. Having consumed the ready story, it also queues a
// background regeneration for this user (detached context, one in flight per
// user at most) so the next story becomes ready without waiting for the
// scheduler's next tick.
func (s *Service) OpenReady(ctx context.Context, userID uuid.UUID) (*Story, error) {
	id, isReady, err := s.store.ReadyStoryID(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !isReady {
		return nil, ErrNoReadyStory
	}
	st, err := s.store.Get(ctx, id, userID)
	if err != nil {
		return nil, err
	}
	if err := s.store.ClearReady(ctx, id); err != nil {
		return nil, err
	}
	s.regenerate(userID)
	return st, nil
}

// regenerate starts a detached EnsureReady for one user. It is best-effort:
// failures are logged and the scheduler pass remains the safety net. The
// at-most-one-generation-per-user rule lives in EnsureReady itself, so the
// scheduler and this path share one guard and neither waits on the other.
func (s *Service) regenerate(userID uuid.UUID) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		if err := s.EnsureReady(ctx, userID); err != nil && !errors.Is(err, aiprovider.ErrNotAssigned) {
			s.log.Error("story: regeneration after open failed", "user_id", userID, "err", err)
		}
	}()
}

// Get returns one of the user's stories.
func (s *Service) Get(ctx context.Context, storyID, userID uuid.UUID) (*Story, error) {
	return s.store.Get(ctx, storyID, userID)
}

// List returns a page of the user's validated stories, newest first, with
// the total count.
func (s *Service) List(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*Story, int, error) {
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}
	if offset < 0 {
		offset = 0
	}
	return s.store.List(ctx, userID, limit, offset)
}

// Rate records (or replaces) the user's rating of a story. Ratings steer
// future genre selection through EnsureReady.
func (s *Service) Rate(ctx context.Context, storyID, userID uuid.UUID, r Rating) error {
	if !r.Valid() {
		return &Error{Status: 400, Code: "invalid_rating", Message: "rating must be \"up\" or \"down\""}
	}
	return s.store.Rate(ctx, storyID, userID, r)
}

// AnswerResult is one graded comprehension answer.
type AnswerResult struct {
	Correct bool
	// PracticeRecorded is true when this answer wrote the story's Practice
	// Records — true only for the first answer ever for that story.
	PracticeRecorded bool
}

// Answer grades one comprehension question. On the first answer for a story
// it appends one Practice Record per Focus Set item the story covers —
// vocabulary (stories.vocab_items' IsFocus flag) and Grammar Points alike
// (the story_grammar_spans' IsFocus flag), correct = this answer's verdict;
// stories.practiced_at guards the at-most-once. The rows are ordinary
// practice_records rows, so the Mastery semantics of the practice log
// (migrations/00008, ADR 0004) are unchanged — see the package doc. The
// records are "lighter" than a Session's in coverage only, not in weight:
// for now each carries the same AppendResult weight as a Session result.
func (s *Service) Answer(ctx context.Context, storyID, userID uuid.UUID, questionIndex, answerIndex int) (AnswerResult, error) {
	st, err := s.store.Get(ctx, storyID, userID)
	if err != nil {
		return AnswerResult{}, err
	}
	if !st.Validated {
		// A gate failure is kept for analysis, never offered: the library
		// and the ready flow already hide it, so an answer reaching here is
		// a stale or forged story id.
		return AnswerResult{}, &Error{Status: 400, Code: "story_not_ready", Message: "that story failed generation and cannot be answered"}
	}
	if questionIndex < 0 || questionIndex >= len(st.Questions) {
		return AnswerResult{}, &Error{Status: 400, Code: "invalid_question", Message: "no such question in this story"}
	}
	q := st.Questions[questionIndex]
	if answerIndex < 0 || answerIndex >= len(q.OptionsJA) {
		return AnswerResult{}, &Error{Status: 400, Code: "invalid_answer", Message: "no such answer option"}
	}
	correct := answerIndex == q.AnswerIndex

	at := time.Now().UTC()
	first, err := s.store.MarkPracticed(ctx, storyID, at)
	if err != nil {
		return AnswerResult{}, err
	}
	if first && s.results != nil {
		if err := s.appendPractice(ctx, st, userID, correct, at); err != nil {
			// The marker claimed the records but the append failed: undo the
			// claim — but only while the marker is still the one we just set,
			// so we can never undo a concurrent answer's — so the Learner's
			// retry writes the records instead of being silently skipped.
			if rerr := s.store.ResetPracticed(context.WithoutCancel(ctx), storyID, at); rerr != nil {
				s.log.Error("story: could not undo the practiced marker after a failed Practice Record append",
					"story_id", storyID, "err", rerr)
			}
			return AnswerResult{}, err
		}
		return AnswerResult{Correct: correct, PracticeRecorded: true}, nil
	}
	return AnswerResult{Correct: correct}, nil
}

// appendPractice writes one Practice Record per Focus Set item the story
// covers: vocabulary (stories.vocab_items' IsFocus flag) and Grammar Points
// alike (the story_grammar_spans' IsFocus flag), correct = the answer's
// verdict, at = the moment the practiced marker was claimed.
func (s *Service) appendPractice(ctx context.Context, st *Story, userID uuid.UUID, correct bool, at time.Time) error {
	for _, v := range st.VocabItems {
		if !v.IsFocus {
			continue // Practice Records only for the story's Focus Set items
		}
		key := mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: strconv.FormatInt(v.EntSeq, 10)}
		if err := s.results.AppendResult(ctx, userID, key, correct, at); err != nil {
			return err
		}
	}
	// The grammar half: every Focus Set point the story realised, once
	// however many spans share it.
	seenGrammar := map[int64]bool{}
	for _, sen := range st.Sentences {
		for _, sp := range sen.Spans {
			if !sp.IsFocus || seenGrammar[sp.GrammarPointID] {
				continue
			}
			seenGrammar[sp.GrammarPointID] = true
			key := mastery.ItemKey{Kind: mastery.KindGrammar, Ref: strconv.FormatInt(sp.GrammarPointID, 10)}
			if err := s.results.AppendResult(ctx, userID, key, correct, at); err != nil {
				return err
			}
		}
	}
	return nil
}

// GetSettings returns the user's story settings.
func (s *Service) GetSettings(ctx context.Context, userID uuid.UUID) (UserSettings, error) {
	thr, err := s.store.FuriganaThreshold(ctx, userID)
	if err != nil {
		return UserSettings{}, err
	}
	genre, theme, err := s.store.StoryPrefs(ctx, userID)
	if err != nil {
		return UserSettings{}, err
	}
	return UserSettings{
		FuriganaThresholdSRSLevel: thr,
		PreferredGenre:            genre,
		PreferredTheme:            theme,
	}, nil
}

// UserSettings is the per-user half of Settings: what the Learner can change
// through the API.
type UserSettings struct {
	// FuriganaThresholdSRSLevel: Known Items at or above this SRS Level are
	// shown without furigana (GLOSSARY.md). 0–9, mastery's scale.
	FuriganaThresholdSRSLevel int
	// PreferredGenre / PreferredTheme: what the next stories aim for; ""
	// means "surprise me" / no theme, and the server picks steered by
	// ratings. These steer the prompt only — never the validation gate.
	PreferredGenre string
	PreferredTheme string
}

// Genre/theme length caps: long enough for any real preference, short
// enough to stay a usable prompt line.
const (
	maxPreferredGenreLen = 60
	maxPreferredThemeLen = 200
)

// PutSettings updates the story settings. The next story's tokens use the
// new threshold; existing stories keep theirs (their views read the stored
// SRS Levels against the current threshold).
func (s *Service) PutSettings(ctx context.Context, userID uuid.UUID, us UserSettings) (UserSettings, error) {
	if us.FuriganaThresholdSRSLevel < 0 || us.FuriganaThresholdSRSLevel > mastery.MaxSRSLevel {
		return UserSettings{}, &Error{Status: 400, Code: "invalid_threshold",
			Message: fmt.Sprintf("furigana_threshold_srs_level must be between 0 and %d", mastery.MaxSRSLevel)}
	}
	genre, theme := sanitizeLabel(us.PreferredGenre, maxPreferredGenreLen), sanitizeLabel(us.PreferredTheme, maxPreferredThemeLen)
	if utf8.RuneCountInString(us.PreferredGenre) > maxPreferredGenreLen || utf8.RuneCountInString(us.PreferredTheme) > maxPreferredThemeLen {
		return UserSettings{}, &Error{Status: 400, Code: "invalid_preference",
			Message: fmt.Sprintf("preferredGenre is capped at %d characters, preferredTheme at %d", maxPreferredGenreLen, maxPreferredThemeLen)}
	}
	if err := s.store.SetFuriganaThreshold(ctx, userID, us.FuriganaThresholdSRSLevel); err != nil {
		return UserSettings{}, err
	}
	if err := s.store.SetStoryPrefs(ctx, userID, genre, theme); err != nil {
		return UserSettings{}, err
	}
	us.PreferredGenre, us.PreferredTheme = genre, theme
	return us, nil
}

// ReadingSettings is the reader-behaviour preference set (issue #11, with
// the issue #12 lookup-hold threshold), kept apart from UserSettings: story
// settings steer generation and are rewritten wholesale by the settings
// form, while these flags belong to the reader and are written on their own.
type ReadingSettings struct {
	// BlurTranslation: story translations start blurred in the Reading
	// Panel; the Learner's reveal click flips this stored flag.
	BlurTranslation bool
	// LookupHoldMs is how long a dictionary lookup must stay open before
	// the reader reports it as a Weak Signal (issue #12). 0 signals every
	// lookup; the stored default is 800.
	LookupHoldMs int
}

// DefaultLookupHoldMs is the learner-configurable Weak Signal threshold
// until they choose another (issue #12).
const DefaultLookupHoldMs = 800

// ReadingSettingsUpdate is the PUT body's shape on the service side: an
// omitted lookupHoldMs (nil) keeps the stored threshold. 0 is a legitimate
// stored value ("signal every lookup"), so the field cannot be a plain int
// — an absent JSON field would decode to exactly the value it must not
// imply.
type ReadingSettingsUpdate struct {
	BlurTranslation bool
	LookupHoldMs    *int
}

// GetReadingSettings returns the user's reading settings.
func (s *Service) GetReadingSettings(ctx context.Context, userID uuid.UUID) (ReadingSettings, error) {
	blur, err := s.store.BlurTranslation(ctx, userID)
	if err != nil {
		return ReadingSettings{}, err
	}
	hold, err := s.store.LookupHoldMs(ctx, userID)
	if err != nil {
		return ReadingSettings{}, err
	}
	return ReadingSettings{BlurTranslation: blur, LookupHoldMs: hold}, nil
}

// PutReadingSettings applies the update over the stored settings: a nil
// LookupHoldMs keeps what is stored. Range validation lives at the HTTP
// edge; the store just keeps what it is given.
func (s *Service) PutReadingSettings(ctx context.Context, userID uuid.UUID, u ReadingSettingsUpdate) (ReadingSettings, error) {
	rs, err := s.GetReadingSettings(ctx, userID)
	if err != nil {
		return ReadingSettings{}, err
	}
	rs.BlurTranslation = u.BlurTranslation
	if u.LookupHoldMs != nil {
		rs.LookupHoldMs = *u.LookupHoldMs
	}
	if err := s.store.SetBlurTranslation(ctx, userID, rs.BlurTranslation); err != nil {
		return ReadingSettings{}, err
	}
	if err := s.store.SetLookupHoldMs(ctx, userID, rs.LookupHoldMs); err != nil {
		return ReadingSettings{}, err
	}
	return rs, nil
}

// Scheduler regenerates ready stories in the background: the request path
// never waits on an LLM. Each pass checks every user once with EnsureReady,
// which is cheap when the Focus Set is unchanged.
type Scheduler struct {
	svc      *Service
	interval time.Duration
	log      *slog.Logger
}

// NewScheduler builds the background worker around a Service.
func NewScheduler(svc *Service, interval time.Duration, log *slog.Logger) *Scheduler {
	if interval <= 0 {
		interval = 15 * time.Minute
	}
	if log == nil {
		log = slog.Default()
	}
	return &Scheduler{svc: svc, interval: interval, log: log}
}

// Run loops until ctx is cancelled, starting with an immediate pass so a
// fresh server has stories quickly.
func (sc *Scheduler) Run(ctx context.Context) {
	for {
		sc.pass(ctx)
		select {
		case <-ctx.Done():
			return
		case <-time.After(sc.interval):
		}
	}
}

func (sc *Scheduler) pass(ctx context.Context) {
	ids, err := sc.svc.store.UserIDs(ctx)
	if err != nil {
		sc.log.Error("story scheduler: list users", "err", err)
		return
	}
	for _, id := range ids {
		if ctx.Err() != nil {
			return
		}
		// Per-user budget: every attempt capped at DefaultGenerationTimeout
		// each (llm.Options.Timeout), and one extra slot for the store work,
		// so one stuck provider cannot stretch a pass past the interval.
		uctx, cancel := context.WithTimeout(ctx, time.Duration(sc.svc.settings.MaxAttempts+1)*DefaultGenerationTimeout)
		err := sc.svc.EnsureReady(uctx, id)
		cancel()
		if err != nil {
			// No provider assigned is the normal quiet case; anything else
			// is worth logging, and the next pass tries again.
			if !errors.Is(err, aiprovider.ErrNotAssigned) {
				sc.log.Error("story scheduler: ensure ready", "user_id", id, "err", err)
			}
		}
	}
}

// PickGenre chooses the genre/theme for the next generation: genres the user
// rated up (net of downvotes, ties broken randomly) come first, then genres
// of the stories they read most recently — minus any the user rated net
// down, which are never re-picked even when they were read recently. An
// empty result means "surprise me" — issue #10's story-rating-steers-genre
// rule.
func PickGenre(ratings map[string]map[Rating]int, recentGenres []string) string {
	type gs struct {
		genre string
		score int
	}
	net := func(g string) int {
		c := ratings[g]
		return c[RatingUp] - c[RatingDown]
	}
	var best []gs
	for g := range ratings {
		if net(g) <= 0 {
			continue
		}
		best = append(best, gs{g, net(g)})
	}
	if len(best) > 0 {
		sort.Slice(best, func(i, j int) bool {
			if best[i].score != best[j].score {
				return best[i].score > best[j].score
			}
			return best[i].genre < best[j].genre
		})
		var top []string
		for _, b := range best {
			if b.score == best[0].score {
				top = append(top, b.genre)
			}
		}
		if len(top) == 1 {
			return top[0]
		}
		return top[rand.Intn(len(top))]
	}
	var fallback []string
	for _, g := range recentGenres {
		if net(g) < 0 {
			continue // disliked: ratings steer away even from recent reading
		}
		fallback = append(fallback, g)
	}
	if len(fallback) > 0 {
		return fallback[rand.Intn(len(fallback))]
	}
	return ""
}

// dislikedGenres lists the genres the user rated net down, sorted for a
// stable prompt; the generator names them as "avoid".
func dislikedGenres(ratings map[string]map[Rating]int) []string {
	var out []string
	for g, c := range ratings {
		if c[RatingUp]-c[RatingDown] < 0 {
			out = append(out, g)
		}
	}
	sort.Strings(out)
	return out
}

// FocusChanged implements the significance rule from the issue: regenerate
// when at least DefaultSignificanceFraction of the current Focus Set was not
// in the snapshot the last story was generated against. An empty snapshot
// (no story yet) is always "changed".
func FocusChanged(snapshot []string, current []string) bool {
	if len(current) == 0 {
		return false
	}
	if len(snapshot) == 0 {
		return true
	}
	old := map[string]bool{}
	for _, k := range snapshot {
		old[k] = true
	}
	fresh := 0
	for _, k := range current {
		if !old[k] {
			fresh++
		}
	}
	return float64(fresh) >= DefaultSignificanceFraction*float64(len(current))
}

// Error is an HTTP-mappable story error, shaped like grammar.Error and
// practice.Error.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

// NewPostgresService builds the whole story stack over the shared pool: the
// Postgres store, the generator with the shared kagome tokeniser and the
// jmdict vocabulary lookup, and the mastery-backed Focus Set provider. msvc
// is the configured mastery service (same scoring weights as practice);
// focus is derived from it.
func NewPostgresService(pool *pgxpool.Pool, resolve Resolver, msvc *mastery.Service, settings Settings, log *slog.Logger) *Service {
	store := NewPostgresStore(pool)
	lookup := NewRefdataLookup(pool)
	focus := NewMasteryFocus(pool, msvc)
	gen := NewGenerator(lookup)
	results := practice.NewPostgresResults(pool)
	return NewService(store, gen, focus, resolve, results, settings, log)
}
