package story

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"sort"
	"strconv"
	"time"

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
}

// NewService wires a Service. settings carries the gate bounds (STORY_* env
// vars); results may be nil only in tests that never answer questions.
func NewService(store Store, gen *Generator, focus Focus, resolve Resolver, results practice.ResultWriter, settings Settings, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{store: store, gen: gen, focus: focus, resolve: resolve, results: results, settings: settings.WithDefaults(), log: log}
}

// EnsureReady makes sure the user has a ready story, generating one only
// when they have none or their Focus Set has changed significantly since the
// last story (see FocusChanged). When nothing changed and a ready story
// exists, this is a cheap snapshot comparison with no LLM call — that is
// what makes the background scheduler affordable.
func (s *Service) EnsureReady(ctx context.Context, userID uuid.UUID) error {
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

	knownWords, err := s.focus.KnownWords(ctx, userID, s.settings.PromptKnownLimit)
	if err != nil {
		return fmt.Errorf("known words: %w", err)
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

	req := Request{
		UserID:     userID,
		Settings:   s.settings,
		Focus:      fset,
		Known:      s.focus,
		KnownWords: knownWords,
		Genre:      PickGenre(ratings, recent),
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
	if err := s.store.SetFocusSnapshot(ctx, userID, keys); err != nil {
		return err
	}
	return genErr
}

// OpenReady returns the ready story and clears its ready marker, so the next
// background pass re-arms generation. Reading is a plain store read — the
// request path never waits on an LLM.
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
	return st, nil
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
// it appends one Practice Record per Focus Set vocabulary item the story
// covers (correct = this answer's verdict); stories.practiced_at guards the
// at-most-once. The rows are ordinary practice_records rows, so ADR 0008's
// Mastery semantics are unchanged — see the package doc.
func (s *Service) Answer(ctx context.Context, storyID, userID uuid.UUID, questionIndex, answerIndex int) (AnswerResult, error) {
	st, err := s.store.Get(ctx, storyID, userID)
	if err != nil {
		return AnswerResult{}, err
	}
	if questionIndex < 0 || questionIndex >= len(st.Questions) {
		return AnswerResult{}, &Error{Status: 400, Code: "invalid_question", Message: "no such question in this story"}
	}
	q := st.Questions[questionIndex]
	if answerIndex < 0 || answerIndex >= len(q.OptionsJA) {
		return AnswerResult{}, &Error{Status: 400, Code: "invalid_answer", Message: "no such answer option"}
	}
	correct := answerIndex == q.AnswerIndex

	first, err := s.store.MarkPracticed(ctx, storyID, time.Now().UTC())
	if err != nil {
		return AnswerResult{}, err
	}
	if first && s.results != nil {
		at := time.Now().UTC()
		for _, v := range st.VocabItems {
			if !v.IsFocus {
				continue // Practice Records only for the story's Focus Set items
			}
			key := mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: strconv.FormatInt(v.EntSeq, 10)}
			if err := s.results.AppendResult(ctx, userID, key, correct, at); err != nil {
				return AnswerResult{}, err
			}
		}
		return AnswerResult{Correct: correct, PracticeRecorded: true}, nil
	}
	return AnswerResult{Correct: correct}, nil
}

// GetSettings returns the user's story settings.
func (s *Service) GetSettings(ctx context.Context, userID uuid.UUID) (UserSettings, error) {
	thr, err := s.store.FuriganaThreshold(ctx, userID)
	if err != nil {
		return UserSettings{}, err
	}
	return UserSettings{FuriganaThresholdSRSLevel: thr}, nil
}

// UserSettings is the per-user half of Settings: what the Learner can change
// through the API.
type UserSettings struct {
	// FuriganaThresholdSRSLevel: Known Items at or above this SRS Level are
	// shown without furigana (GLOSSARY.md). 0–9, mastery's scale.
	FuriganaThresholdSRSLevel int
}

// PutSettings updates the Furigana Threshold. The next story's tokens use the
// new value; existing stories keep theirs (their views read the stored SRS
// Levels against the current threshold).
func (s *Service) PutSettings(ctx context.Context, userID uuid.UUID, us UserSettings) (UserSettings, error) {
	if us.FuriganaThresholdSRSLevel < 0 || us.FuriganaThresholdSRSLevel > mastery.MaxSRSLevel {
		return UserSettings{}, &Error{Status: 400, Code: "invalid_threshold",
			Message: fmt.Sprintf("furigana_threshold_srs_level must be between 0 and %d", mastery.MaxSRSLevel)}
	}
	if err := s.store.SetFuriganaThreshold(ctx, userID, us.FuriganaThresholdSRSLevel); err != nil {
		return UserSettings{}, err
	}
	return us, nil
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
		if err := sc.svc.EnsureReady(ctx, id); err != nil {
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
// of the stories they read most recently. An empty result means "surprise
// me" — issue #10's story-rating-steers-genre rule.
func PickGenre(ratings map[string]map[Rating]int, recentGenres []string) string {
	type gs struct {
		genre string
		score int
	}
	var best []gs
	for g, c := range ratings {
		net := c[RatingUp] - c[RatingDown]
		if net <= 0 {
			continue
		}
		best = append(best, gs{g, net})
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
	if len(recentGenres) > 0 {
		return recentGenres[rand.Intn(len(recentGenres))]
	}
	return ""
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
