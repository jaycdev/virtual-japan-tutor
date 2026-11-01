package practice_test

import (
	"context"
	"errors"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery/masterytest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice/practicetest"
)

var (
	alice  = uuid.MustParse("11111111-1111-1111-1111-111111111111")
	bobUID = uuid.MustParse("22222222-2222-2222-2222-222222222222")
)

// clock is shared by mastery, the service and the session store so TTL and
// decay behaviour are deterministic.
type clock struct{ now time.Time }

func (c *clock) Now() time.Time          { return c.now }
func (c *clock) Advance(d time.Duration) { c.now = c.now.Add(d) }

// recordWriter wires practice results into the same masterytest.MemStore the
// mastery service reads, so a test can watch Mastery move.
type recordWriter struct{ m *masterytest.MemStore }

func (w recordWriter) AppendResult(ctx context.Context, userID uuid.UUID, item mastery.ItemKey, correct bool, answeredAt time.Time) error {
	w.m.AddPractice(userID, mastery.PracticeRecord{Key: item, Correct: correct, AnsweredAt: answeredAt})
	return nil
}

type env struct {
	svc      *practice.Service
	mem      *masterytest.MemStore
	store    *practice.MemStore
	clock    *clock
	content  *practicetest.Content
	focusSvc *mastery.Service
}

func newEnv(t *testing.T) *env {
	t.Helper()
	clk := &clock{now: time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)}

	mem := masterytest.NewMemStore()
	mopts := mastery.DefaultOptions()
	mopts.Now = clk.Now
	focusSvc := mastery.NewService(mem, mopts)

	content := practicetest.NewContent()
	content.Meaning = []string{"water", "fire", "mountain"} // recognition distractor pool
	content.Spans = []string{"ました", "ください"}                 // cloze distractor pool
	content.AddVocab(1000, practice.Word{Display: "学校", Meanings: []string{"school"}, Level: "N5"})
	content.AddKanji("水", practice.Word{Display: "水", Meanings: []string{"water"}, Level: "N5"})
	content.AddCloze(5, practice.ClozeContent{
		Sentence: "昨日、学校へ行きました。", SpanStart: 6, SpanEnd: 11, SpanText: "行きました", Level: "N5",
	})

	store := practice.NewMemStore(time.Hour).WithClock(clk.Now)
	popts := practice.Options{SessionSize: 10, Now: clk.Now}
	svc := practice.NewService(focusSvc, content, store, recordWriter{mem}, popts)

	// Focus Set fixtures: linked vocabulary and kanji, a grammar point with an
	// example (5), a grammar point without one (6 → skipped), and an unlinked
	// MaruMori vocab item (non-numeric ref → skipped).
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1000"}, MaruMoriID: "Vocab/1",
		SRSLevel: ptrInt(2), Source: mastery.SourceMaruMori,
	})
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "Vocab/9"}, MaruMoriID: "Vocab/9",
		SRSLevel: ptrInt(1), Source: mastery.SourceMaruMori,
	})
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindKanji, Ref: "水"}, MaruMoriID: "Kanji/2",
		SRSLevel: ptrInt(3), Source: mastery.SourceMaruMori,
	})
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindGrammar, Ref: "5"}, Source: mastery.SourceSeeded,
	})
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindGrammar, Ref: "6"}, Source: mastery.SourceSeeded,
	})
	return &env{svc: svc, mem: mem, store: store, clock: clk, content: content, focusSvc: focusSvc}
}

func ptrInt(n int) *int { return &n }

func mustStart(t *testing.T, e *env, userID uuid.UUID, seed int64) *practice.Session {
	t.Helper()
	id, err := e.svc.StartSession(context.Background(), userID, seed)
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}
	sess, err := e.svc.GetSession(context.Background(), userID, id)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	return sess
}

// The same seed and Focus Set must build exactly the same session.
func TestStartSessionIsDeterministicForASeed(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	first, err := e.svc.StartSession(ctx, alice, 77)
	if err != nil {
		t.Fatal(err)
	}
	second, err := e.svc.StartSession(ctx, alice, 77)
	if err != nil {
		t.Fatal(err)
	}
	a, _ := e.svc.GetSession(ctx, alice, first)
	b, _ := e.svc.GetSession(ctx, alice, second)
	if a.ID == b.ID {
		t.Fatal("sessions must still get distinct ids")
	}
	if !reflect.DeepEqual(a.Exercises, b.Exercises) {
		t.Errorf("same seed built different exercises:\n a=%+v\n b=%+v", a.Exercises, b.Exercises)
	}
	if !reflect.DeepEqual(a.Skipped, b.Skipped) || !reflect.DeepEqual(a.TargetSize, b.TargetSize) {
		t.Errorf("same seed built skipped=%v target=%v and skipped=%v target=%v",
			a.Skipped, a.TargetSize, b.Skipped, b.TargetSize)
	}
}

// Focus Set order is kept, unlinked and example-less items are skipped and
// counted, and options carry a shuffled-but-stable correct answer.
func TestStartSessionOrderSkipsAndOptions(t *testing.T) {
	e := newEnv(t)
	sess := mustStart(t, e, alice, 7)

	if sess.State != practice.StateInProgress {
		t.Errorf("state = %q, want in_progress", sess.State)
	}
	if sess.TargetSize != 10 {
		t.Errorf("target size = %d, want the configured 10", sess.TargetSize)
	}
	// Focus Set order is by ascending Mastery (nothing is pinned: the grammar
	// is seeded, not Observed): vocab 1000 (SRS 2), kanji 水 (SRS 3), then
	// seeded grammar 5 at the no-evidence mark. Grammar 6 (no example) and
	// Vocab/9 (unlinked) are skipped. Only those three items are buildable,
	// so the session tops up to its 10-item target by cycling them.
	wantKinds := []string{practice.ExerciseRecognition, practice.ExerciseRecognition, practice.ExerciseGrammarCloze}
	wantItems := []mastery.ItemKey{
		{Kind: mastery.KindVocabulary, Ref: "1000"},
		{Kind: mastery.KindKanji, Ref: "水"},
		{Kind: mastery.KindGrammar, Ref: "5"},
	}
	if len(sess.Exercises) != 10 {
		t.Fatalf("exercises = %+v, want the 10-item target topped up from the three buildable items", sess.Exercises)
	}
	if sess.Skipped != 2 {
		t.Errorf("skipped = %d, want 2 (grammar 6 has no example, Vocab/9 is unlinked)", sess.Skipped)
	}
	for i, ex := range sess.Exercises {
		if want := "e" + strconv.Itoa(i+1); ex.ID != want {
			t.Errorf("exercise %d id = %q, want %q", i, ex.ID, want)
		}
		if ex.Kind != wantKinds[i%len(wantKinds)] {
			t.Errorf("exercise %s kind = %q, want %q", ex.ID, ex.Kind, wantKinds[i%len(wantKinds)])
		}
		if want := wantItems[i%len(wantItems)]; ex.Item != want {
			t.Errorf("exercise %s item = %+v, want %+v", ex.ID, ex.Item, want)
		}
		if len(ex.Options) < 2 || len(ex.Options) > practice.OptionsPerExercise {
			t.Errorf("exercise %s has %d options, want 2..%d", ex.ID, len(ex.Options), practice.OptionsPerExercise)
		}
		var correctTexts []string
		for _, o := range ex.Options {
			if o.Text == "" {
				t.Errorf("exercise %s has an empty option", ex.ID)
			}
			if o.ID == ex.CorrectOptionID {
				correctTexts = append(correctTexts, o.Text)
			}
		}
		if len(correctTexts) != 1 {
			t.Errorf("exercise %s: %d options match CorrectOptionID, want exactly 1", ex.ID, len(correctTexts))
		}
	}

	cloze := sess.Exercises[2]
	if want := "昨日、学校へ行きました。"; cloze.Prompt == want {
		t.Error("cloze prompt kept the span; want it blanked")
	}
	if !contains(cloze.Prompt, clozeBlank) {
		t.Errorf("cloze prompt %q must contain the blank %q", cloze.Prompt, clozeBlank)
	}
	if contains(cloze.Prompt, "行きました") {
		t.Errorf("cloze prompt %q still shows the answer", cloze.Prompt)
	}
}

const clozeBlank = "＿＿＿"

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// A short Focus Set still builds a session at the target size: the next-
// weakest buildable Known Items beyond the set top it up, graduated items
// stay out, and cycling the buildable items with fresh shuffles fills the
// rest of the target.
func TestStartSessionTopsUpAShortFocusSet(t *testing.T) {
	clk := &clock{now: time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)}
	mem := masterytest.NewMemStore()
	mopts := mastery.DefaultOptions()
	mopts.Now = clk.Now
	mopts.SetSize = 2 // only the two weakest items are Focus Set members
	mopts.GraduateStreak = 1
	mopts.GraduateMinDays = 1

	content := practicetest.NewContent()
	content.Meaning = []string{"water", "fire"}
	content.AddVocab(1000, practice.Word{Display: "学校", Meanings: []string{"school"}, Level: "N5"})
	content.AddKanji("水", practice.Word{Display: "水", Meanings: []string{"water"}, Level: "N5"})
	content.AddVocab(1001, practice.Word{Display: "本", Meanings: []string{"book"}, Level: "N5"})
	content.AddVocab(1002, practice.Word{Display: "火", Meanings: []string{"fire"}, Level: "N5"})

	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1000"}, MaruMoriID: "Vocab/1",
		SRSLevel: ptrInt(2), Source: mastery.SourceMaruMori,
	})
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindKanji, Ref: "水"}, MaruMoriID: "Kanji/2",
		SRSLevel: ptrInt(3), Source: mastery.SourceMaruMori,
	})
	// Beyond the two-item set: the top-up pick.
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1001"}, MaruMoriID: "Vocab/3",
		SRSLevel: ptrInt(5), Source: mastery.SourceMaruMori,
	})
	// One correct answer at this threshold graduates the item: it must stay
	// out of the session even though the set is short.
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1002"}, MaruMoriID: "Vocab/4",
		SRSLevel: ptrInt(4), Source: mastery.SourceMaruMori,
	})
	mem.AddPractice(alice, mastery.PracticeRecord{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1002"}, Correct: true, AnsweredAt: clk.now,
	})

	svc := practice.NewService(mastery.NewService(mem, mopts), content,
		practice.NewMemStore(time.Hour).WithClock(clk.Now), &practicetest.Results{},
		practice.Options{SessionSize: 10, Now: clk.Now})
	sess := mustStart(t, &env{svc: svc, clock: clk}, alice, 4)

	// Focus Set first (vocab 1000, kanji 水), then 1001 tops up; 1002 stays out
	// as graduated. The remaining slots cycle the three buildable items.
	wantRefs := []string{"1000", "水", "1001", "1000", "水", "1001", "1000", "水", "1001", "1000"}
	if len(sess.Exercises) != len(wantRefs) {
		t.Fatalf("exercises = %d, want the 10-item target:\n%+v", len(sess.Exercises), sess.Exercises)
	}
	for i, ex := range sess.Exercises {
		if ex.Item.Ref != wantRefs[i] {
			t.Errorf("exercise %s item = %q, want %q", ex.ID, ex.Item.Ref, wantRefs[i])
		}
	}

	// A repeat is a fresh exercise, not a copy: the four vocabulary 1000
	// exercises do not all carry the same option order.
	orders := map[string]bool{}
	for _, ex := range sess.Exercises {
		if ex.Item.Ref != "1000" {
			continue
		}
		var sig string
		for _, o := range ex.Options {
			sig += o.Text + "|"
		}
		orders[sig] = true
	}
	if len(orders) < 2 {
		t.Errorf("repeats of vocab 1000 all share one option order, want a fresh shuffle")
	}
}

// A Focus Set with nothing buildable refuses to start a session.
func TestStartSessionWithoutContentIsNoItems(t *testing.T) {
	e := newEnv(t)
	_, err := e.svc.StartSession(context.Background(), bobUID, 1)
	if !errors.Is(err, practice.ErrNoItems) {
		t.Fatalf("err = %v, want ErrNoItems", err)
	}
	e.mem.AddKnownItem(bobUID, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "Vocab/404"}, MaruMoriID: "Vocab/404",
		SRSLevel: ptrInt(1), Source: mastery.SourceMaruMori,
	})
	if _, err := e.svc.StartSession(context.Background(), bobUID, 1); !errors.Is(err, practice.ErrNoItems) {
		t.Fatalf("err = %v, want ErrNoItems for an unlinked-only set", err)
	}
}

// The answer loop: results land in the Practice Record (observable as a
// Mastery change), the session completes, and re-answers are refused.
func TestSubmitAnswerRecordsAndCompletes(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	sess := mustStart(t, e, alice, 3)

	before, err := e.focusSvc.FocusSet(ctx, alice)
	if err != nil {
		t.Fatal(err)
	}

	for i, ex := range sess.Exercises {
		chosen := ex.Options[0]
		wantCorrect := chosen.ID == ex.CorrectOptionID
		res, err := e.svc.SubmitAnswer(ctx, alice, sess.ID, ex.ID, chosen.ID)
		if err != nil {
			t.Fatalf("answer %s: %v", ex.ID, err)
		}
		if res.Correct != wantCorrect {
			t.Errorf("answer %s correct = %v, want %v", ex.ID, res.Correct, wantCorrect)
		}
		if res.CorrectOptionID != ex.CorrectOptionID {
			t.Errorf("answer %s revealed %q, want %q", ex.ID, res.CorrectOptionID, ex.CorrectOptionID)
		}
		wantState := practice.StateInProgress
		if i == len(sess.Exercises)-1 {
			wantState = practice.StateComplete
		}
		if res.State != wantState {
			t.Errorf("after %s state = %q, want %q", ex.ID, res.State, wantState)
		}
	}

	if got := len(e.mem.Practice[alice]); got != len(sess.Exercises) {
		t.Fatalf("Practice Record got %d rows, want %d", got, len(sess.Exercises))
	}
	// The answers also reached the mastery store: Mastery changed for the
	// items answered.
	after, err := e.focusSvc.FocusSet(ctx, alice)
	if err != nil {
		t.Fatal(err)
	}
	if reflect.DeepEqual(before.Items, after.Items) {
		t.Fatal("Mastery did not move after the session")
	}

	// Re-answering — and answering on a complete session — is refused.
	if _, err := e.svc.SubmitAnswer(ctx, alice, sess.ID, sess.Exercises[0].ID, sess.Exercises[0].Options[0].ID); !errors.Is(err, practice.ErrAlreadyAnswered) {
		t.Errorf("re-answer err = %v, want ErrAlreadyAnswered", err)
	}

	// The session view carries the answers.
	again, err := e.svc.GetSession(ctx, alice, sess.ID)
	if err != nil {
		t.Fatal(err)
	}
	if again.State != practice.StateComplete {
		t.Errorf("state = %q, want complete", again.State)
	}
	for i, ex := range again.Exercises {
		if !again.Done[i] || again.Answers[i].OptionID == "" {
			t.Errorf("exercise %s not recorded as answered", ex.ID)
		}
	}
}

// Bad exercise/option ids are 400s; another user's session is a 404.
func TestSubmitAnswerRejectsBadRequestsAndForeignSessions(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	sess := mustStart(t, e, alice, 11)

	_, err := e.svc.SubmitAnswer(ctx, alice, sess.ID, "e99", "a")
	var pErr *practice.Error
	if !errors.As(err, &pErr) || pErr.Status != 400 {
		t.Errorf("unknown exercise err = %v, want 400", err)
	}
	_, err = e.svc.SubmitAnswer(ctx, alice, sess.ID, sess.Exercises[0].ID, "z")
	if !errors.As(err, &pErr) || pErr.Status != 400 {
		t.Errorf("unknown option err = %v, want 400", err)
	}
	_, err = e.svc.SubmitAnswer(ctx, bobUID, sess.ID, sess.Exercises[0].ID, "a")
	if !errors.Is(err, practice.ErrSessionNotFound) {
		t.Errorf("foreign submit err = %v, want ErrSessionNotFound", err)
	}
	if _, err := e.svc.GetSession(ctx, bobUID, sess.ID); !errors.Is(err, practice.ErrSessionNotFound) {
		t.Errorf("foreign get err = %v, want ErrSessionNotFound", err)
	}
}

// Sessions stop being resumable past the TTL.
func TestSessionExpiresPastTTL(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	sess := mustStart(t, e, alice, 5)

	e.clock.Advance(time.Hour) // the store's TTL
	if _, err := e.svc.GetSession(ctx, alice, sess.ID); !errors.Is(err, practice.ErrSessionNotFound) {
		t.Errorf("after TTL err = %v, want ErrSessionNotFound", err)
	}
	if _, err := e.svc.SubmitAnswer(ctx, alice, sess.ID, sess.Exercises[0].ID, "a"); !errors.Is(err, practice.ErrSessionNotFound) {
		t.Errorf("answer after TTL err = %v, want ErrSessionNotFound", err)
	}
}

// The session size cap bounds generation to the configured target.
func TestSessionSizeCapsExercises(t *testing.T) {
	clk := &clock{now: time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)}
	mem := masterytest.NewMemStore()
	mopts := mastery.DefaultOptions()
	mopts.Now = clk.Now
	content := practicetest.NewContent()
	content.Meaning = []string{"water"}
	for i := int64(1); i <= 30; i++ {
		content.AddVocab(i, practice.Word{Display: "word", Meanings: []string{"gloss"}, Level: "N5"})
		mem.AddKnownItem(alice, mastery.KnownItem{
			Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: itoa(i)}, MaruMoriID: "Vocab/" + itoa(i),
			SRSLevel: ptrInt(1), Source: mastery.SourceMaruMori,
		})
	}
	svc := practice.NewService(mastery.NewService(mem, mopts), content,
		practice.NewMemStore(time.Hour).WithClock(clk.Now), &practicetest.Results{},
		practice.Options{SessionSize: 20, Now: clk.Now})
	sess := mustStart(t, &env{svc: svc, clock: clk}, alice, 1)
	if len(sess.Exercises) != 20 {
		t.Errorf("generated %d exercises, want capped at 20", len(sess.Exercises))
	}
	if sess.TargetSize != 20 {
		t.Errorf("target size = %d, want 20", sess.TargetSize)
	}
}

// --- fair options (a one-option exercise is a free "correct") ---

// noDistractors serves item content but never a distractor, so every
// candidate exercise would ship with a single option.
type noDistractors struct{ *practicetest.Content }

func (c noDistractors) VocabDistractors(ctx context.Context, level string, exclude []int64, salt int64, limit int) ([]string, error) {
	return nil, nil
}

func (c noDistractors) KanjiDistractors(ctx context.Context, level string, exclude []string, salt int64, limit int) ([]string, error) {
	return nil, nil
}

func (c noDistractors) ClozeDistractors(ctx context.Context, level string, excludePoint int64, notText string, salt int64, limit int) ([]string, error) {
	return nil, nil
}

// With no distractors anywhere nothing is buildable fairly: the session
// refuses to start rather than hand out free "correct" Practice Records.
func TestStartSessionWithoutDistractorsIsNoItems(t *testing.T) {
	content := noDistractors{practicetest.NewContent()}
	content.AddVocab(1000, practice.Word{Display: "学校", Meanings: []string{"school"}, Level: "N5"})
	clk := &clock{now: time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)}
	mem := masterytest.NewMemStore()
	mopts := mastery.DefaultOptions()
	mopts.Now = clk.Now
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1000"}, MaruMoriID: "Vocab/1",
		SRSLevel: ptrInt(2), Source: mastery.SourceMaruMori,
	})
	svc := practice.NewService(mastery.NewService(mem, mopts), content,
		practice.NewMemStore(time.Hour).WithClock(clk.Now), &practicetest.Results{},
		practice.Options{SessionSize: 10, Now: clk.Now})
	if _, err := svc.StartSession(context.Background(), alice, 7); !errors.Is(err, practice.ErrNoItems) {
		t.Fatalf("err = %v, want ErrNoItems: a one-option exercise is a giveaway", err)
	}
}

// An empty same-level pool falls back to same-kind-all-levels distractors
// before giving up: the exercise is built, not skipped.
func TestRecognitionFallsBackToAllLevelsBeforeSkipping(t *testing.T) {
	content := &emptyAtLevel{Content: practicetest.NewContent()}
	content.Meaning = []string{"water", "fire", "mountain"}
	content.AddVocab(1000, practice.Word{Display: "学校", Meanings: []string{"school"}, Level: "N5"})

	clk := &clock{now: time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)}
	mem := masterytest.NewMemStore()
	mopts := mastery.DefaultOptions()
	mopts.Now = clk.Now
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1000"}, MaruMoriID: "Vocab/1",
		SRSLevel: ptrInt(2), Source: mastery.SourceMaruMori,
	})
	svc := practice.NewService(mastery.NewService(mem, mopts), content,
		practice.NewMemStore(time.Hour).WithClock(clk.Now), &practicetest.Results{},
		practice.Options{SessionSize: 2, Now: clk.Now})
	sess := mustStart(t, &env{svc: svc, clock: clk}, alice, 7)

	if sess.Skipped != 0 {
		t.Errorf("skipped = %d, want 0: the all-levels fallback should have built the exercise", sess.Skipped)
	}
	for _, ex := range sess.Exercises {
		if len(ex.Options) < 2 {
			t.Errorf("exercise %s has %d options, want the fallback to have offered at least 2", ex.ID, len(ex.Options))
		}
	}
}

// emptyAtLevel has no same-level vocabulary distractors but a full pool at
// every level — the fallback's best case.
type emptyAtLevel struct{ *practicetest.Content }

func (c *emptyAtLevel) VocabDistractors(ctx context.Context, level string, exclude []int64, salt int64, limit int) ([]string, error) {
	if level != "" {
		return nil, nil
	}
	return c.Content.VocabDistractors(ctx, "", exclude, salt, limit)
}

// A vocabulary item with no distractors at all is skipped and counted, while
// other kinds keep building: sessions stay fair, not empty.
func TestSkipItemsWithoutEnoughOptionsAndKeepTheRest(t *testing.T) {
	content := practicetest.NewContent()
	content.Meaning = []string{"water", "fire", "mountain"}
	content.AddVocab(1000, practice.Word{Display: "学校", Meanings: []string{"school"}, Level: "N5"})
	content.AddKanji("水", practice.Word{Display: "水", Meanings: []string{"water"}, Level: "N5"})

	clk := &clock{now: time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)}
	mem := masterytest.NewMemStore()
	mopts := mastery.DefaultOptions()
	mopts.Now = clk.Now
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1000"}, MaruMoriID: "Vocab/1",
		SRSLevel: ptrInt(2), Source: mastery.SourceMaruMori,
	})
	mem.AddKnownItem(alice, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindKanji, Ref: "水"}, MaruMoriID: "Kanji/2",
		SRSLevel: ptrInt(3), Source: mastery.SourceMaruMori,
	})
	svc := practice.NewService(mastery.NewService(mem, mopts), noVocabDistractors{content},
		practice.NewMemStore(time.Hour).WithClock(clk.Now), &practicetest.Results{},
		practice.Options{SessionSize: 10, Now: clk.Now})
	sess := mustStart(t, &env{svc: svc, clock: clk}, alice, 3)

	// The vocabulary attempt is skipped once (top-ups only cycle what built).
	if sess.Skipped != 1 {
		t.Errorf("skipped = %d, want 1 (vocab 1000 cannot be asked fairly)", sess.Skipped)
	}
	if len(sess.Exercises) == 0 {
		t.Fatal("no exercises, want the kanji to keep filling the session")
	}
	for _, ex := range sess.Exercises {
		if len(ex.Options) < 2 {
			t.Errorf("exercise %s (%+v) has %d options, want at least 2", ex.ID, ex.Item, len(ex.Options))
		}
		if ex.Item.Kind != mastery.KindKanji {
			t.Errorf("exercise %s practises %+v, want only the kanji (the vocab was skipped)", ex.ID, ex.Item)
		}
	}
}

type noVocabDistractors struct{ *practicetest.Content }

func (c noVocabDistractors) VocabDistractors(ctx context.Context, level string, exclude []int64, salt int64, limit int) ([]string, error) {
	return nil, nil
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }
