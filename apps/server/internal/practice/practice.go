// Package practice runs Practice Sessions (issue #9): short quizzes drawn from
// the Focus Set whose results feed the Practice Record, and through it Mastery
// and the Focus Set itself (docs/adr/0004). Two Exercise kinds: recognition —
// a Known Item in Japanese with four English meaning options, distractors
// drawn from the same Item kind at a similar JLPT Level — and grammar cloze —
// a Grammar Point's example sentence with its Grammar Span blanked and other
// spans from the same level as options. Items the Focus Set holds but the app
// has no content for (unlinked MaruMori items, points with no example) are
// skipped and counted.
//
// Sessions are short-lived server state behind the SessionStore interface:
// today an in-memory TTL store, so a Postgres-backed store can come later
// without touching this package's callers. Generation is deterministic for a
// seed: the same Focus Set and seed build the same session. The Focus Set is
// capped, so when it yields fewer Exercises than the session target the
// session tops up with the next-weakest Known Items beyond the set and, if
// needed, repeats buildable items with a fresh shuffle.
package practice

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
)

// Exercise kinds and session states, matching the OpenAPI enums verbatim.
const (
	ExerciseRecognition  = "recognition"
	ExerciseGrammarCloze = "grammar_cloze"

	StateInProgress = "in_progress"
	StateComplete   = "complete"
)

// Defaults for Options; config exposes each as an env var.
const (
	DefaultSessionSize = 20            // "around 20 exercises"
	DefaultSessionTTL  = 4 * time.Hour // a session stops being resumable this long after it starts
	OptionsPerExercise = 4             // one correct + three distractors
	// DefaultStretchSlots is how many Stretch Items — not-yet-Known items
	// from the Learner's Boosting Lists (issue #12) — a session reserves
	// slots for ahead of the mastery top-ups. 0 disables them.
	DefaultStretchSlots = 4
)

// Error carries an HTTP status through to the handler; match with errors.As.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

var (
	// ErrSessionNotFound is returned for unknown, expired and other users'
	// sessions alike: a foreign session id must not be distinguishable.
	ErrSessionNotFound = &Error{Status: 404, Code: "not_found", Message: "No such practice session (it may have expired)."}
	// ErrNoItems answers a start attempt when the Focus Set holds nothing the
	// app can build an exercise from.
	ErrNoItems = &Error{Status: 409, Code: "practice_no_items", Message: "Your Focus Set has nothing to practise yet."}
	// ErrAlreadyAnswered guards the at-most-once rule of the Practice Record.
	ErrAlreadyAnswered = &Error{Status: 409, Code: "already_answered", Message: "That exercise was already answered."}
)

// BadRequestError builds a 400 for unknown exercises and options.
func BadRequestError(format string, args ...any) *Error {
	return &Error{Status: 400, Code: "bad_request", Message: fmt.Sprintf(format, args...)}
}

// Options configures sessions; zero fields fall back to the defaults.
type Options struct {
	// SessionSize is the target number of exercises (the Focus Set may be
	// shorter, and skipped items shorten the session further).
	SessionSize int
	// StretchSlots reserves room for Stretch Items — not-yet-Known items
	// sitting in the Learner's Boosting Lists (issue #12) — after the
	// Focus Set and before the mastery top-ups. Zero deliberately means
	// "off" (withDefaults does not fill it); cmd/server passes
	// DefaultStretchSlots through config.
	StretchSlots int
	// Now is the clock; nil uses time.Now.
	Now func() time.Time
}

func (o Options) withDefaults() Options {
	if o.SessionSize <= 0 {
		o.SessionSize = DefaultSessionSize
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	return o
}

// Word is the content of a linked vocabulary or kanji item: the Japanese side
// of a recognition exercise, its meanings, and the JLPT Level distractors
// should match.
type Word struct {
	Display  string   // kanji form (reading when it has none), or the kanji itself
	Meanings []string // English glosses, most relevant first
	Level    string   // JLPT Level ("N5"…"N1"); "" when the item is on no list
}

// ClozeContent is one example sentence of a Grammar Point, with its Grammar
// Span located by rune offsets (the grammar package's validator guarantee).
type ClozeContent struct {
	Sentence  string
	SpanStart int
	SpanEnd   int
	SpanText  string
	Level     string
}

// Content supplies exercise material. The Postgres implementation lives in
// pg.go; tests use practicetest's fixtures. ok=false means the item has no
// content (unlinked, deleted reference row, no example) and is skipped.
type Content interface {
	VocabWord(ctx context.Context, entSeq int64) (Word, bool, error)
	KanjiWord(ctx context.Context, literal string) (Word, bool, error)
	GrammarCloze(ctx context.Context, pointID int64) (ClozeContent, bool, error)

	// Distractor pools: English meanings of the same kind at level (all levels
	// when level is ""), deterministic for salt, never including the item's
	// own entry.
	VocabDistractors(ctx context.Context, level string, exclude []int64, salt int64, limit int) ([]string, error)
	KanjiDistractors(ctx context.Context, level string, exclude []string, salt int64, limit int) ([]string, error)
	// ClozeDistractors returns Grammar Spans from other points at level,
	// excluding spans equal to notText.
	ClozeDistractors(ctx context.Context, level string, excludePoint int64, notText string, salt int64, limit int) ([]string, error)

	// StretchItems lists the Stretch Items for a session (issue #12):
	// items held by the Learner's Boosting Lists that are NOT yet Known
	// Items, oldest membership first, at most limit. They are exercised
	// for recognition but never enter the Known Item universe, so they
	// cannot distort Story coverage.
	StretchItems(ctx context.Context, userID uuid.UUID, limit int) ([]mastery.ItemKey, error)
}

// ResultWriter appends one Exercise result to the Practice Record. The
// Postgres implementation writes practice_records, exactly the rows
// mastery.PostgresStore.PracticeResults reads; tests write into a
// masterytest.MemStore so the Mastery/Focus Set change is observable.
type ResultWriter interface {
	AppendResult(ctx context.Context, userID uuid.UUID, item mastery.ItemKey, correct bool, answeredAt time.Time) error
}

// Option is one selectable answer of an Exercise.
type Option struct {
	ID   string
	Text string
}

// Exercise is one quiz item. CorrectOptionID is server-side only: the API
// view never reveals it before the Learner has answered.
type Exercise struct {
	ID              string
	Kind            string
	Item            mastery.ItemKey
	Prompt          string // the Japanese side
	Instruction     string // what to do, in English
	Options         []Option
	CorrectOptionID string
}

// Answer records a submitted choice.
type Answer struct {
	OptionID   string
	Correct    bool
	AnsweredAt time.Time
}

// Session is one Practice Session: its exercises in answer order, plus one
// answer per exercise once submitted.
type Session struct {
	ID         string
	UserID     uuid.UUID
	Seed       int64
	CreatedAt  time.Time
	State      string
	TargetSize int // the configured PRACTICE_SESSION_SIZE this session aimed at
	Skipped    int
	Exercises  []Exercise
	Answers    []Answer // parallel to Exercises; zero value = not answered
	Done       []bool   // parallel to Exercises; Done[i] = exercise i answered
}

func (s *Session) clone() *Session {
	out := *s
	out.Exercises = make([]Exercise, len(s.Exercises))
	copy(out.Exercises, s.Exercises)
	for i := range out.Exercises {
		out.Exercises[i].Options = append([]Option(nil), s.Exercises[i].Options...)
	}
	out.Answers = append([]Answer(nil), s.Answers...)
	out.Done = append([]bool(nil), s.Done...)
	return &out
}

// answeredCount reports how many exercises have results.
func (s *Session) answeredCount() int {
	n := 0
	for _, done := range s.Done {
		if done {
			n++
		}
	}
	return n
}

// SessionStore persists sessions between requests. Implementations return
// copies, so callers never hold a live pointer into the store.
type SessionStore interface {
	Put(ctx context.Context, sess *Session) error
	// Get returns the session, or ErrSessionNotFound when it is unknown or
	// past its TTL.
	Get(ctx context.Context, id string) (*Session, error)
}

// AnswerResult is the outcome of one submitted answer.
type AnswerResult struct {
	Correct         bool
	CorrectOptionID string
	State           string
}

// Service builds sessions from the Focus Set and records their results.
type Service struct {
	focus    *mastery.Service
	content  Content
	sessions SessionStore
	results  ResultWriter
	opts     Options

	// mu serialises read-modify-write on a session (get, append answer, put).
	mu sync.Mutex
}

func NewService(focus *mastery.Service, content Content, sessions SessionStore, results ResultWriter, opts Options) *Service {
	return &Service{focus: focus, content: content, sessions: sessions, results: results, opts: opts.withDefaults()}
}

// StartSession draws up to SessionSize exercises. The Focus Set comes first,
// in Focus Set order (newly Observed Grammar stays pinned to the front). The
// set is capped and may hold unbuildable items, so a pass over it can fall
// short of the target: the session then tops up with the next-weakest
// buildable Known Items beyond the set — graduated items keep their
// exclusion — and if even those run out, cycles the buildable items again,
// the seed-driven shuffle having advanced so a repeat gets a fresh option
// order and distractor sampling. It returns ErrNoItems when nothing
// buildable exists.
func (s *Service) StartSession(ctx context.Context, userID uuid.UUID, seed int64) (string, error) {
	set, err := s.focus.FocusSet(ctx, userID)
	if err != nil {
		return "", err
	}
	if len(set.Items) == 0 {
		return "", ErrNoItems
	}
	if seed == 0 {
		seed = s.opts.Now().UnixNano()
	}

	g := &generator{content: s.content, seed: seed}
	skipped := 0
	attempted := make(map[mastery.ItemKey]bool, len(set.Items))
	buildable := make([]mastery.ItemKey, 0, len(set.Items))
	for _, item := range set.Items {
		if len(g.exercises) == s.opts.SessionSize {
			break
		}
		key := item.Item.Key
		attempted[key] = true
		ok, err := g.add(ctx, key)
		if err != nil {
			return "", err
		}
		if ok {
			buildable = append(buildable, key)
		} else {
			skipped++
		}
	}

	// Stretch Items (issue #12): not-yet-Known items from the Boosting
	// Lists get their slots after the Focus Set and before any top-up, so
	// a full set never crowds them out and a short set still reserves the
	// session's target. They answer into the Practice Record like every
	// other exercise, but never join the Known Item universe.
	if s.opts.StretchSlots > 0 && len(g.exercises) < s.opts.SessionSize {
		limit := s.opts.StretchSlots
		if room := s.opts.SessionSize - len(g.exercises); room < limit {
			limit = room
		}
		stretch, err := s.content.StretchItems(ctx, userID, limit)
		if err != nil {
			return "", err
		}
		for _, key := range stretch {
			if len(g.exercises) == s.opts.SessionSize {
				break
			}
			if attempted[key] {
				continue
			}
			attempted[key] = true
			ok, err := g.add(ctx, key)
			if err != nil {
				return "", err
			}
			if !ok {
				skipped++
			}
		}
	}

	// Top-up 1: Known Items just outside the set, weakest first. Score re-
	// reads the same signals FocusSet used, so the ordering is stable.
	if len(g.exercises) < s.opts.SessionSize {
		scored, err := s.focus.Score(ctx, userID)
		if err != nil {
			return "", err
		}
		for _, it := range scored {
			if len(g.exercises) == s.opts.SessionSize {
				break
			}
			key := it.Item.Key
			if it.Graduated || attempted[key] {
				continue
			}
			attempted[key] = true
			ok, err := g.add(ctx, key)
			if err != nil {
				return "", err
			}
			if ok {
				buildable = append(buildable, key)
			} else {
				skipped++
			}
		}
	}

	// Top-up 2: fewer buildable Known Items than the target — cycle them
	// until the session is full.
	for len(g.exercises) < s.opts.SessionSize && len(buildable) > 0 {
		added := false
		for _, key := range buildable {
			if len(g.exercises) == s.opts.SessionSize {
				break
			}
			ok, err := g.add(ctx, key)
			if err != nil {
				return "", err
			}
			added = added || ok
		}
		if !added {
			break // content vanished under us: no progress is possible
		}
	}

	if len(g.exercises) == 0 {
		return "", ErrNoItems
	}

	sess := &Session{
		ID:         uuid.NewString(),
		UserID:     userID,
		Seed:       seed,
		CreatedAt:  s.opts.Now(),
		State:      StateInProgress,
		TargetSize: s.opts.SessionSize,
		Skipped:    skipped,
		Exercises:  g.exercises,
		Answers:    make([]Answer, len(g.exercises)),
		Done:       make([]bool, len(g.exercises)),
	}
	if err := s.sessions.Put(ctx, sess); err != nil {
		return "", err
	}
	return sess.ID, nil
}

// GetSession returns the learner's session, or ErrSessionNotFound.
func (s *Service) GetSession(ctx context.Context, userID uuid.UUID, id string) (*Session, error) {
	sess, err := s.sessions.Get(ctx, id)
	if err != nil {
		return nil, err
	}
	if sess.UserID != userID {
		return nil, ErrSessionNotFound // do not confirm the session exists
	}
	return sess, nil
}

// SubmitAnswer applies one choice: it checks the exercise and option, appends
// the result to the Practice Record, and completes the session when the last
// exercise is answered. Re-answering is ErrAlreadyAnswered.
func (s *Service) SubmitAnswer(ctx context.Context, userID uuid.UUID, sessionID, exerciseID, optionID string) (AnswerResult, error) {
	// The mutex is deliberately global rather than per-session: sessions are
	// few and short-lived, and serialising every read-modify-write keeps the
	// at-most-once rule simple until the SessionStore itself can enforce it
	// (a Postgres store would do it with a transaction).
	s.mu.Lock()
	defer s.mu.Unlock()

	sess, err := s.GetSession(ctx, userID, sessionID)
	if err != nil {
		return AnswerResult{}, err
	}
	idx := -1
	for i, e := range sess.Exercises {
		if e.ID == exerciseID {
			idx = i
			break
		}
	}
	if idx < 0 {
		return AnswerResult{}, BadRequestError("no exercise %q in this session", exerciseID)
	}
	if sess.Done[idx] {
		return AnswerResult{}, ErrAlreadyAnswered
	}
	ex := sess.Exercises[idx]
	optIdx := -1
	for i, o := range ex.Options {
		if o.ID == optionID {
			optIdx = i
			break
		}
	}
	if optIdx < 0 {
		return AnswerResult{}, BadRequestError("no option %q for exercise %q", optionID, exerciseID)
	}

	correct := ex.Options[optIdx].ID == ex.CorrectOptionID
	at := s.opts.Now()
	sess.Answers[idx] = Answer{OptionID: optionID, Correct: correct, AnsweredAt: at}
	sess.Done[idx] = true
	if sess.answeredCount() == len(sess.Exercises) {
		sess.State = StateComplete
	}
	// AppendResult goes before the session Put on purpose: if the Practice
	// Record write fails the session stays unanswered, so the learner's retry
	// re-attempts the record write. The reverse order would mark the exercise
	// answered while its result never landed — and a Postgres-backed store
	// needs the same order (one transaction: record insert + session update)
	// to keep the at-most-once rule idempotent.
	if err := s.results.AppendResult(ctx, userID, ex.Item, correct, at); err != nil {
		return AnswerResult{}, err
	}
	if err := s.sessions.Put(ctx, sess); err != nil {
		return AnswerResult{}, err
	}
	return AnswerResult{Correct: correct, CorrectOptionID: ex.CorrectOptionID, State: sess.State}, nil
}

// parseNumericRef splits a Focus Set item ref into the id its Content lookup
// needs. Only refs that address reference data (an ent_seq or a grammar point
// id) parse; a MaruMori id ("Vocab/1") does not — its content was never
// stored (docs/adr/0002), so such items are skipped.
func parseNumericRef(ref string) (int64, bool) {
	n, err := strconv.ParseInt(ref, 10, 64)
	if err != nil || n <= 0 {
		return 0, false
	}
	return n, true
}
