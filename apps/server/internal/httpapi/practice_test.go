package httpapi_test

import (
	"context"
	"math"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery/masterytest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice/practicetest"
)

// practiceWriter wires Practice answers into the same masterytest.MemStore the
// focus-set service reads, so the HTTP tests can watch Mastery move — the
// done-when for issue #9: answers recorded into the Practice Record feed back
// into the Focus Set.
type practiceWriter struct{ m *masterytest.MemStore }

func (w practiceWriter) AppendResult(ctx context.Context, userID uuid.UUID, item mastery.ItemKey, correct bool, answeredAt time.Time) error {
	w.m.AddPractice(userID, mastery.PracticeRecord{Key: item, Correct: correct, AnsweredAt: answeredAt})
	return nil
}

// practiceEnv serves /practice/sessions over the real auth middleware, with
// the practice service over in-memory doubles (issue #9).
type practiceEnv struct {
	e     env
	store *masterytest.MemStore
	focus *mastery.Service
	uid   uuid.UUID // alice's user id, for fixtures
}

func newPracticeEnv(t *testing.T) *practiceEnv {
	return newPracticeEnvWith(t, nil, nil)
}

// newPracticeEnvWith builds the env with optional tweaks to the mastery and
// practice options (a smaller Focus Set, a lower graduation threshold…).
func newPracticeEnvWith(t *testing.T, mopts func(*mastery.Options), popts func(*practice.Options)) *practiceEnv {
	t.Helper()
	clock := authtest.NewFakeClock()
	authSvc := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour, Now: clock.Now})
	alice, err := authSvc.CreateUser(context.Background(), "alice", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authSvc.CreateUser(context.Background(), "bob", password); err != nil {
		t.Fatal(err)
	}

	mem := masterytest.NewMemStore()
	mo := mastery.DefaultOptions()
	mo.Now = func() time.Time { return focusClock }
	if mopts != nil {
		mopts(&mo)
	}
	focusSvc := mastery.NewService(mem, mo)

	content := practicetest.NewContent()
	content.Meaning = []string{"water", "fire", "mountain"}
	content.Spans = []string{"ました", "ください"}
	content.AddVocab(1000, practice.Word{Display: "学校", Meanings: []string{"school"}, Level: "N5"})
	content.AddKanji("水", practice.Word{Display: "水", Meanings: []string{"water"}, Level: "N5"})
	content.AddCloze(5, practice.ClozeContent{
		Sentence: "昨日、学校へ行きました。", SpanStart: 6, SpanEnd: 11, SpanText: "行きました", Level: "N5",
	})

	po := practice.Options{SessionSize: 10, Now: func() time.Time { return focusClock }}
	if popts != nil {
		popts(&po)
	}
	svc := practice.NewService(focusSvc, content, practice.NewMemStore(time.Hour), practiceWriter{mem}, po)

	h := httpapi.New(fakeDB{}, authSvc, httpapi.WithFocusSet(focusSvc), httpapi.WithPractice(svc))
	e := env{h: h, svc: authSvc, clock: clock}
	return &practiceEnv{e: e, store: mem, focus: focusSvc, uid: alice.ID}
}

// seedPracticeFixtures gives alice a three-item Focus Set whose exercises all
// build: linked vocabulary (SRS 2), linked kanji (SRS 3) and Seeded Grammar 5.
func seedPracticeFixtures(m *masterytest.MemStore, uid uuid.UUID) {
	m.AddKnownItem(uid, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1000"}, MaruMoriID: "Vocab/1",
		SRSLevel: ptrInt(2), Source: mastery.SourceMaruMori,
	})
	m.AddKnownItem(uid, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindKanji, Ref: "水"}, MaruMoriID: "Kanji/2",
		SRSLevel: ptrInt(3), Source: mastery.SourceMaruMori,
	})
	m.AddKnownItem(uid, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindGrammar, Ref: "5"}, Source: mastery.SourceSeeded,
	})
}

func (o *practiceEnv) start(t *testing.T, user string, body any) api.PracticeSession {
	t.Helper()
	rec := o.e.do(t, "POST", "/practice/sessions", "Bearer "+o.e.login(t, user), body)
	if rec.Code != http.StatusOK {
		t.Fatalf("start(%s) = %d (%s)", user, rec.Code, rec.Body)
	}
	var sess api.PracticeSession
	mustJSON(t, rec, &sess)
	return sess
}

func (o *practiceEnv) answer(t *testing.T, user, sessionID string, body any) *httptest.ResponseRecorder {
	t.Helper()
	return o.e.do(t, "POST", "/practice/sessions/"+sessionID+"/answers", "Bearer "+o.e.login(t, user), body)
}

// --- auth and wiring ---

func TestStartPracticeSessionRequiresASession(t *testing.T) {
	o := newPracticeEnv(t)
	wantError(t, o.e.do(t, "POST", "/practice/sessions", "", nil), http.StatusUnauthorized, "unauthorized")
	wantError(t, o.e.do(t, "GET", "/practice/sessions/nosuch", "", nil), http.StatusUnauthorized, "unauthorized")
}

func TestPracticeNotConfiguredIsAServiceError(t *testing.T) {
	// The pre-issue-#9 wiring (no WithPractice) answers 500, like the other
	// optional services.
	e := newEnv(t, fakeDB{})
	rec := e.do(t, "POST", "/practice/sessions", "Bearer "+e.login(t, "alice"), nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (%s)", rec.Code, rec.Body)
	}
}

// A Learner whose Focus Set holds nothing buildable gets 409 practice_no_items.
func TestStartPracticeSessionWithoutBuildableItemsIs409(t *testing.T) {
	o := newPracticeEnv(t)
	seedPracticeFixtures(o.store, o.uid) // alice has items; bob has none
	wantError(t, o.e.do(t, "POST", "/practice/sessions", "Bearer "+o.e.login(t, "bob"), nil),
		http.StatusConflict, "practice_no_items")
}

// --- the session view ---

func TestPracticeSessionViewShapeAndDeterminism(t *testing.T) {
	o := newPracticeEnv(t)
	seedPracticeFixtures(o.store, o.uid)
	sess := o.start(t, "alice", map[string]any{"seed": 7})

	if sess.State != api.InProgress {
		t.Errorf("state = %q, want in_progress", sess.State)
	}
	if sess.TargetSize == nil || *sess.TargetSize != 10 {
		t.Errorf("targetSize = %v, want the configured 10", sess.TargetSize)
	}
	if sess.Results != nil {
		t.Errorf("results = %+v on a fresh session, want absent", sess.Results)
	}
	if sess.Skipped != 0 {
		t.Errorf("skipped = %d, want 0", sess.Skipped)
	}

	// Focus Set order: ascending Mastery — vocab (2/9), kanji (3/9), then
	// Seeded Grammar at the no-evidence mark. Those three are all alice
	// knows, so the session tops up to its 10-item target by cycling them.
	wantKinds := []api.PracticeExerciseKind{api.Recognition, api.Recognition, api.GrammarCloze}
	wantRefs := []string{"1000", "水", "5"} // paired with kinds above by index
	if len(sess.Exercises) != 10 {
		t.Fatalf("exercises = %+v, want the 10-item target topped up from the three buildable items", sess.Exercises)
	}
	for i, ex := range sess.Exercises {
		if ex.Id != "e"+strconv.Itoa(i+1) {
			t.Errorf("exercise %d id = %q", i, ex.Id)
		}
		if ex.Kind != wantKinds[i%len(wantKinds)] {
			t.Errorf("exercise %s kind = %q, want %q", ex.Id, ex.Kind, wantKinds[i%len(wantKinds)])
		}
		if want := wantRefs[i%len(wantRefs)]; ex.ItemRef != want {
			t.Errorf("exercise %s itemRef = %q, want %q", ex.Id, ex.ItemRef, want)
		}
		if ex.Answered || ex.Correct != nil || ex.ChosenOptionId != nil || ex.CorrectOptionId != nil {
			t.Errorf("exercise %s = %+v, want unanswered and nothing revealed", ex.Id, ex)
		}
		if ex.Instruction == nil || *ex.Instruction == "" {
			t.Errorf("exercise %s has no instruction", ex.Id)
		}
		if ex.Options == nil || len(*ex.Options) < 2 {
			t.Errorf("exercise %s options = %v, want at least 2", ex.Id, ex.Options)
			continue
		}
		for _, opt := range *ex.Options {
			if opt.Id == "" || opt.Text == "" {
				t.Errorf("exercise %s has an empty option %+v", ex.Id, opt)
			}
		}
	}

	// The cloze prompt is blanked; the correct answer hides until answered.
	cloze := sess.Exercises[2]
	if !containsStr(cloze.Prompt, "＿＿＿") {
		t.Errorf("cloze prompt %q must contain the blank", cloze.Prompt)
	}
	if containsStr(cloze.Prompt, "行きました") {
		t.Errorf("cloze prompt %q still shows the answer", cloze.Prompt)
	}

	// Same seed, same Focus Set, same session.
	again := o.start(t, "alice", map[string]any{"seed": 7})
	if again.Id == sess.Id {
		t.Error("sessions must still get distinct ids")
	}
	if !reflect.DeepEqual(again.Exercises, sess.Exercises) {
		t.Errorf("same seed built different exercises:\n first=%+v\n again=%+v", sess.Exercises, again.Exercises)
	}
}

func containsStr(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}

// --- the done-when: answering moves Mastery through the Practice Record ---

func TestPracticeAnswersCompleteTheSessionAndMoveMastery(t *testing.T) {
	o := newPracticeEnv(t)
	seedPracticeFixtures(o.store, o.uid)
	token := o.e.login(t, "alice")

	focusBefore := getFocusSet(t, o.e, token)
	sess := o.start(t, "alice", map[string]any{"seed": 3})

	wantText := map[string]string{"1000": "school", "水": "water", "5": "行きました"}
	picked := map[string]string{}
	for i, ex := range sess.Exercises {
		pick := ""
		for _, opt := range *ex.Options {
			if opt.Text == wantText[ex.ItemRef] {
				pick = opt.Id
			}
		}
		if pick == "" {
			t.Fatalf("exercise for %s has no option with the correct text", ex.ItemRef)
		}
		picked[ex.Id] = pick
		rec := o.answer(t, "alice", sess.Id, map[string]string{"exerciseId": ex.Id, "optionId": pick})
		if rec.Code != http.StatusOK {
			t.Fatalf("answer %s = %d (%s)", ex.Id, rec.Code, rec.Body)
		}
		var res api.PracticeAnswerResult
		mustJSON(t, rec, &res)
		if !res.Correct {
			t.Errorf("answer %s: correct = false, want true", ex.Id)
		}
		wantState := api.InProgress
		if i == len(sess.Exercises)-1 {
			wantState = api.Complete
		}
		if res.State != wantState {
			t.Errorf("after %s state = %q, want %q", ex.Id, res.State, wantState)
		}
	}

	// The finished session view carries the results summary.
	rec := o.e.do(t, "GET", "/practice/sessions/"+sess.Id, "Bearer "+token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("get = %d (%s)", rec.Code, rec.Body)
	}
	var done api.PracticeSession
	mustJSON(t, rec, &done)
	if done.State != api.Complete {
		t.Errorf("state = %q, want complete", done.State)
	}
	if done.Results == nil || done.Results.Total != 10 || done.Results.Correct != 10 {
		t.Fatalf("results = %+v, want 10/10", done.Results)
	}
	if done.Results.Items == nil || len(*done.Results.Items) != 10 {
		t.Fatalf("results items = %v, want 10", done.Results.Items)
	}

	// A resumed view reveals both sides of every answered exercise.
	for _, ex := range done.Exercises {
		if ex.ChosenOptionId == nil || ex.CorrectOptionId == nil {
			t.Errorf("exercise %s = %+v, want chosenOptionId and correctOptionId revealed once answered", ex.Id, ex)
			continue
		}
		if want := picked[ex.Id]; *ex.ChosenOptionId != want {
			t.Errorf("exercise %s chosenOptionId = %q, want the submitted %q", ex.Id, *ex.ChosenOptionId, want)
		}
		if *ex.CorrectOptionId != *ex.ChosenOptionId {
			t.Errorf("exercise %s: every answer was the correct one, so chosen %q should equal correct %q", ex.Id, *ex.ChosenOptionId, *ex.CorrectOptionId)
		}
	}

	// Every answer went into the Practice Record...
	if got := len(o.store.Practice[o.uid]); got != 10 {
		t.Errorf("Practice Record has %d rows, want 3", got)
	}
	// ...and Mastery visibly moved for the items answered.
	focusAfter := getFocusSet(t, o.e, token)
	if len(focusAfter) != len(focusBefore) {
		t.Fatalf("focus set size changed: before %d, after %d", len(focusBefore), len(focusAfter))
	}
	moved := 0
	for _, before := range focusBefore {
		for _, after := range focusAfter {
			if before.ItemRef == after.ItemRef && math.Abs(float64(after.Mastery-before.Mastery)) > 1e-6 {
				moved++
			}
		}
	}
	if moved != 3 {
		t.Errorf("mastery moved for %d items, want 3 (before %+v after %+v)", moved, focusBefore, focusAfter)
	}

	// Re-answering is refused with 409 already_answered.
	wantError(t, o.answer(t, "alice", sess.Id,
		map[string]string{"exerciseId": sess.Exercises[0].Id, "optionId": (*sess.Exercises[0].Options)[0].Id}),
		http.StatusConflict, "already_answered")
}

func getFocusSet(t *testing.T, e env, token string) []api.FocusSetItem {
	t.Helper()
	rec := e.do(t, "GET", "/focus-set", "Bearer "+token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("focus-set = %d (%s)", rec.Code, rec.Body)
	}
	var body api.FocusSet
	mustJSON(t, rec, &body)
	return body.Items
}

// The done-when asserted in full: a correctly answered session changes the
// Focus Set's MEMBERSHIP, not only the per-item scores — graduated items
// leave the set and previously excluded items backfill the freed slots. The
// graduation threshold is configured at one correct answer to keep the
// fixture small; the Focus Set holds two of the four Known Items, so two
// backfill candidates exist outside it.
func TestPracticeSessionChangesFocusSetMembership(t *testing.T) {
	o := newPracticeEnvWith(t,
		func(mo *mastery.Options) {
			mo.SetSize = 2
			mo.GraduateStreak = 1
			mo.GraduateMinDays = 1
		},
		func(po *practice.Options) { po.SessionSize = 2 })
	seedPracticeFixtures(o.store, o.uid)
	// Two items outside the two-item set: seeded grammar 5 (no evidence →
	// the 0.5 mark) and vocab 1001 (SRS 5 → 5/9), weakest first.
	o.store.AddKnownItem(o.uid, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1001"}, MaruMoriID: "Vocab/3",
		SRSLevel: ptrInt(5), Source: mastery.SourceMaruMori,
	})

	token := o.e.login(t, "alice")
	before := getFocusSet(t, o.e, token)
	if want := []string{"1000", "水"}; !refsOf(before, want) {
		t.Fatalf("focus set before = %+v, want exactly the two weakest items", before)
	}

	sess := o.start(t, "alice", map[string]any{"seed": 3})
	if len(sess.Exercises) != 2 {
		t.Fatalf("exercises = %+v, want the two Focus Set members", sess.Exercises)
	}
	wantText := map[string]string{"1000": "school", "水": "water"}
	for _, ex := range sess.Exercises {
		pick := ""
		for _, opt := range *ex.Options {
			if opt.Text == wantText[ex.ItemRef] {
				pick = opt.Id
			}
		}
		if pick == "" {
			t.Fatalf("exercise for %s has no option with the correct text", ex.ItemRef)
		}
		rec := o.answer(t, "alice", sess.Id, map[string]string{"exerciseId": ex.Id, "optionId": pick})
		var res api.PracticeAnswerResult
		mustJSON(t, rec, &res)
		if rec.Code != http.StatusOK || !res.Correct {
			t.Fatalf("answer %s = %d (%s), want correct", ex.Id, rec.Code, rec.Body)
		}
	}

	after := getFocusSet(t, o.e, token)
	// Both answered items now sit at the graduation threshold and leave the
	// set; the excluded items backfill, weakest first.
	if want := []string{"5", "1001"}; !refsOf(after, want) {
		t.Errorf("focus set after = %+v, want [5 1001]: the graduated items gone and the excluded ones backfilled", after)
	}
	for _, ref := range []string{"1000", "水"} {
		if _, ok := findRef(after, ref); ok {
			t.Errorf("graduated item %s still in the focus set", ref)
		}
	}
}

// refsOf reports whether items' refs are exactly want, in order.
func refsOf(items []api.FocusSetItem, want []string) bool {
	if len(items) != len(want) {
		return false
	}
	for i, it := range items {
		if it.ItemRef != want[i] {
			return false
		}
	}
	return true
}

// --- error paths ---

func TestPracticeAnswerValidationAndIsolation(t *testing.T) {
	o := newPracticeEnv(t)
	seedPracticeFixtures(o.store, o.uid)
	sess := o.start(t, "alice", map[string]any{"seed": 11})
	first := sess.Exercises[0]
	firstOption := (*first.Options)[0].Id

	wantError(t, o.answer(t, "alice", sess.Id, map[string]string{"exerciseId": "e99", "optionId": firstOption}),
		http.StatusBadRequest, "bad_request")
	wantError(t, o.answer(t, "alice", sess.Id, map[string]string{"exerciseId": first.Id, "optionId": "z"}),
		http.StatusBadRequest, "bad_request")

	// Another Learner's session is simply not there.
	wantError(t, o.e.do(t, "GET", "/practice/sessions/"+sess.Id, "Bearer "+o.e.login(t, "bob"), nil),
		http.StatusNotFound, "not_found")
	wantError(t, o.answer(t, "bob", sess.Id, map[string]string{"exerciseId": first.Id, "optionId": firstOption}),
		http.StatusNotFound, "not_found")
	wantError(t, o.e.do(t, "GET", "/practice/sessions/nosuchid", "Bearer "+o.e.login(t, "alice"), nil),
		http.StatusNotFound, "not_found")
}
