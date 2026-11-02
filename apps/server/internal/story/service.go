package story

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math/rand"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
)

// ErrNoStory means the user has no Automatic Story yet — there is no
// Today's Story to open (issue #32).
var ErrNoStory = errors.New("story: no Automatic Story for this user yet")

// Resolver finds the AI provider a user's story generation runs on. The
// aiprovider Service satisfies it; tests fake it.
type Resolver interface {
	ResolveProvider(ctx context.Context, userID uuid.UUID, task aiprovider.Task) (aiprovider.Resolved, error)
}

// Service is the one story entry point: generation, the Automatic Story
// background flow, Today's Story, the library, ratings, answers and story
// settings. HTTP handlers do no story work beyond translating requests to
// these methods.
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

	// roll is the preference-vs-variety seam behind PreferredShare (issue
	// #32): automaticGenre and automaticTheme compare roll() against it.
	// Tests drive it to make the 70% branch deterministic.
	roll func() float64

	// genMu guards genInFlight: the user ids whose story generation is
	// currently running (at most one per user at a time).
	genMu       sync.Mutex
	genInFlight map[uuid.UUID]bool
}

// NewService wires a Service. settings carries the gate bounds (STORY_* env
// vars); results may be nil only in tests that never answer questions.
func NewService(store Store, gen *Generator, focus Focus, resolve Resolver, results practice.ResultWriter, settings Settings, log *slog.Logger) *Service {
	if log == nil {
		log = slog.Default()
	}
	return &Service{store: store, gen: gen, focus: focus, resolve: resolve, results: results, settings: settings.WithDefaults(), log: log, now: time.Now, roll: rand.Float64}
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

// ensureAutomaticStory applies the Automatic Story rule (issue #32): at most
// one Automatic Story per day in the Learner's Timezone, and none while the
// user still has an unread one. When today's story already exists or the
// newest one waits unread, this is a cheap store read with no LLM call —
// that is what makes the background scheduler affordable. The scheduler's
// regular pass writes the story soon after the day starts; if the server was
// down then, the first pass after it comes back writes it. Deleting Today's
// Story frees the day, so the next pass writes a replacement.
//
// Two brakes keep a broken provider affordable: at most one generation per
// user runs at a time, and while the user's newest Story is a gate failure
// younger than Settings.RetryCooldown the pass is skipped — a stuck user then
// costs one generation per cooldown window, not one per interval.
func (s *Service) ensureAutomaticStory(ctx context.Context, userID uuid.UUID) error {
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
	prefGenre, prefTheme, tzname, err := s.store.StoryPrefs(ctx, userID)
	if err != nil {
		return err
	}
	latest, have, err := s.store.LatestAutomaticStory(ctx, userID)
	if err != nil {
		return err
	}
	if have {
		if latest.ReadAt == nil {
			// The unread rule: an unread Automatic Story holds the slot
			// until the Learner opens it, however many days pass.
			return nil
		}
		loc := userLocation(tzname)
		if sameLocalDay(s.now().In(loc), latest.CreatedAt.In(loc)) {
			return nil // this local day's story is already written
		}
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

	// Genre and theme are decided separately (issue #32): the Learner's
	// preference steers about 70% of Automatic Stories, the rest keeps the
	// rating-steered variety — see automaticGenre and automaticTheme.
	// Disliked genres (net-down-rated) are named in the prompt as "avoid"
	// and already dropped from PickGenre's fallback.
	req := Request{
		UserID:         userID,
		Settings:       s.settings,
		Focus:          fset,
		Known:          s.focus,
		KnownWords:     knownWords,
		Genre:          automaticGenre(prefGenre, ratings, recent, s.roll()),
		Theme:          automaticTheme(prefTheme, s.roll()),
		Origin:         OriginAutomatic,
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
		s.log.Info("story: wrote today's Automatic Story",
			"user_id", userID, "story_id", st.ID, "genre", st.Genre, "theme", st.Theme)
	} else {
		// Failed-story policy: stored for analysis, never offered; the
		// day stays open, but the cooldown keeps the retries affordable.
		s.log.Warn("story failed the validation gate; stored but not offered",
			"user_id", userID, "story_id", st.ID, "attempts", st.Attempts,
			"known_words", st.KnownWords, "content_words", st.ContentWords,
			"focus_hit", st.FocusHit, "focus_items", st.FocusItems)
	}
	return genErr
}

// TodaysStory returns the newest Automatic Story — Today's Story
// (GLOSSARY.md) — read straight from storage; the request never waits on an
// AI provider. Opening it changes nothing: the daily rule, not the opening,
// decides when the next Automatic Story is written. On-demand Stories never
// qualify. It returns ErrNoStory when the user has no Automatic Story yet.
func (s *Service) TodaysStory(ctx context.Context, userID uuid.UUID) (*Story, error) {
	st, ok, err := s.store.LatestAutomaticStory(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, ErrNoStory
	}
	return st, nil
}

// userLocation resolves the Learner's Timezone (an IANA name). Unset — or a
// name the embedded zone data cannot read — follows the server's own
// timezone, as the issue requires: changing the container's TZ moves the
// Learner's day until they pick a Timezone of their own.
func userLocation(tzname string) *time.Location {
	if tzname == "" {
		return time.Local
	}
	loc, err := time.LoadLocation(tzname)
	if err != nil {
		return time.Local
	}
	return loc
}

// sameLocalDay compares two instants by their calendar date in whatever
// location each already carries; call sites pass both in the Learner's
// Timezone.
func sameLocalDay(a, b time.Time) bool {
	return a.Format("2006-01-02") == b.Format("2006-01-02")
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
// future genre selection through the daily generation.
func (s *Service) Rate(ctx context.Context, storyID, userID uuid.UUID, r Rating) error {
	if !r.Valid() {
		return &Error{Status: 400, Code: "invalid_rating", Message: "rating must be \"up\" or \"down\""}
	}
	return s.store.Rate(ctx, storyID, userID, r)
}

// MarkRead and ClearRead set and unset the library's Read mark (issue #31).
// Answering the last comprehension question sets it too; unreading is a
// plain library edit and touches nothing else.
func (s *Service) MarkRead(ctx context.Context, storyID, userID uuid.UUID, at time.Time) error {
	return s.store.MarkRead(ctx, storyID, userID, at)
}

func (s *Service) ClearRead(ctx context.Context, storyID, userID uuid.UUID) error {
	return s.store.ClearRead(ctx, storyID, userID)
}

// Delete removes a Story from the Library. Its rating goes with it; the
// Practice Records it wrote stay (the mastery log is append-only). Deleting
// Today's Story frees the day: the next scheduler pass writes a replacement
// (issue #32).
func (s *Service) Delete(ctx context.Context, storyID, userID uuid.UUID) error {
	return s.store.Delete(ctx, storyID, userID)
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
		// and Today's Story already hide it, so an answer reaching here is
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
	// The last comprehension question answered means the Learner finished
	// the Story: set its Read mark at the same moment (issue #31). The Read
	// mark is the reader's, separate from the Practiced At above, which
	// guards the Practice Records.
	if questionIndex == len(st.Questions)-1 {
		if err := s.store.MarkRead(ctx, storyID, userID, at); err != nil {
			return AnswerResult{}, err
		}
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
	genre, theme, timezone, err := s.store.StoryPrefs(ctx, userID)
	if err != nil {
		return UserSettings{}, err
	}
	return UserSettings{
		FuriganaThresholdSRSLevel: thr,
		PreferredGenre:            genre,
		PreferredTheme:            theme,
		Timezone:                  timezone,
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
	// Timezone is the Learner's Timezone (GLOSSARY.md): an IANA name
	// ("Asia/Tokyo") deciding which local day an Automatic Story belongs to.
	// "" means unset — the server's own timezone until the Learner picks.
	Timezone string
}

// Genre/theme length caps: long enough for any real preference, short
// enough to stay a usable prompt line. The timezone cap matches the
// OpenAPI field (generous for any real IANA name).
const (
	maxPreferredGenreLen = 60
	maxPreferredThemeLen = 200
	maxTimezoneLen       = 64
)

// PutSettings updates the story settings. The next story's tokens use the
// new threshold; existing stories keep theirs (their views read the stored
// SRS Levels against the current threshold). The Timezone must be a name
// the embedded zone data can read (bad names are rejected, not silently
// fallen back); "" unsets it back to the server's own timezone.
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
	timezone := strings.TrimSpace(us.Timezone)
	if utf8.RuneCountInString(timezone) > maxTimezoneLen {
		return UserSettings{}, &Error{Status: 400, Code: "invalid_timezone",
			Message: fmt.Sprintf("timezone is capped at %d characters", maxTimezoneLen)}
	}
	// LoadLocation("") is UTC without an error, so the unset case is checked
	// apart: "" stores the unset state, any other name must resolve.
	if timezone != "" {
		if _, err := time.LoadLocation(timezone); err != nil {
			return UserSettings{}, &Error{Status: 400, Code: "invalid_timezone",
				Message: "timezone must be an IANA name, like Asia/Tokyo"}
		}
	}
	if err := s.store.SetFuriganaThreshold(ctx, userID, us.FuriganaThresholdSRSLevel); err != nil {
		return UserSettings{}, err
	}
	if err := s.store.SetStoryPrefs(ctx, userID, genre, theme, timezone); err != nil {
		return UserSettings{}, err
	}
	us.PreferredGenre, us.PreferredTheme, us.Timezone = genre, theme, timezone
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

// Scheduler writes Automatic Stories in the background: the request path
// never waits on an LLM. Each pass checks every user once with
// ensureAutomaticStory, which is a cheap store read when the day's story is
// already written or an unread one is waiting.
type Scheduler struct {
	svc      *Service
	interval time.Duration
	log      *slog.Logger
}

// NewScheduler builds the background daily-story worker around a Service.
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
		err := sc.svc.ensureAutomaticStory(uctx, id)
		cancel()
		if err != nil {
			// No provider assigned is the normal quiet case; anything else
			// is worth logging, and the next pass tries again.
			if !errors.Is(err, aiprovider.ErrNotAssigned) {
				sc.log.Error("story scheduler: daily pass", "user_id", id, "err", err)
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

// PreferredShare is the issue #32 mix: a set Preferred Genre or Preferred
// Theme steers about 70% of Automatic Stories; the remaining share keeps
// variety — rating-steered genres and the model's own themes.
const PreferredShare = 0.7

// presetGenres are the labels offered when a Learner has a Preferred Genre
// but this story's roll went to the variety branch and the ratings have
// nothing to steer by. Short, plain labels the prompt can name; they seed
// variety rather than boxing the model in.
var presetGenres = []string{
	"slice of life", "folktale", "travel", "food", "school life",
	"city life", "nature", "mystery",
}

// automaticGenre decides an Automatic Story's genre (issue #32): with no
// Preferred Genre the rating-steered PickGenre decides, exactly as before;
// with one, the preference wins about 70% of the rolls, and the rest fall
// back to PickGenre — and to a random preset genre when the ratings have
// nothing to offer.
func automaticGenre(pref string, ratings map[string]map[Rating]int, recent []string, roll float64) string {
	if pref != "" && roll < PreferredShare {
		return pref
	}
	if g := PickGenre(ratings, recent); g != "" {
		return g
	}
	if pref != "" {
		others := make([]string, 0, len(presetGenres))
		for _, g := range presetGenres {
			if g != pref {
				others = append(others, g)
			}
		}
		return others[rand.Intn(len(others))]
	}
	return ""
}

// automaticTheme decides an Automatic Story's theme ask (issue #32): with no
// Preferred Theme the model chooses (an empty theme, today's behaviour);
// with one, the preference applies about 70% of the rolls and the model
// chooses otherwise.
func automaticTheme(pref string, roll float64) string {
	if pref == "" {
		return ""
	}
	if roll < PreferredShare {
		return pref
	}
	return ""
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
