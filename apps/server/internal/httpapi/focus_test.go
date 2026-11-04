package httpapi_test

import (
	"context"
	"math"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery/masterytest"
)

// focusClock keeps decay maths deterministic: every fixture timestamp is
// relative to a fixed now.
var focusClock = time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)

// focusEnv serves /focus-set over the real auth middleware, with mastery over
// an in-memory store (issue #7).
type focusEnv struct {
	e     env
	store *masterytest.MemStore
	uid   uuid.UUID // alice's user id, for fixtures
}

func newFocusEnv(t *testing.T) *focusEnv {
	t.Helper()
	clock := authtest.NewFakeClock()
	authSvc := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour, Now: clock.Now, PasswordParams: authtest.FastPasswordParams})
	alice, err := authSvc.CreateUser(context.Background(), "alice", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authSvc.CreateUser(context.Background(), "bob", password); err != nil {
		t.Fatal(err)
	}

	store := masterytest.NewMemStore()
	opts := mastery.DefaultOptions() // config defaults, so the expected scores below are stable
	opts.Now = func() time.Time { return focusClock }
	svc := mastery.NewService(store, opts)

	e := env{h: httpapi.New(fakeDB{}, authSvc, httpapi.WithFocusSet(svc)), svc: authSvc, clock: clock}
	return &focusEnv{e: e, store: store, uid: alice.ID}
}

func ptrInt(n int) *int { return &n }

// The full read-side story: two Synced items, one graduated (three correct
// answers across two days, so it rotates out), Seeded Grammar at the
// no-evidence mark, and Observed Grammar seen yesterday pinned to the front.
func seedFocusFixtures(m *masterytest.MemStore, uid uuid.UUID) {
	m.AddKnownItem(uid, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "2023190"}, MaruMoriID: "Vocab/1",
		SRSLevel: ptrInt(2), Source: mastery.SourceMaruMori,
	})
	m.AddKnownItem(uid, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1557560"}, MaruMoriID: "Vocab/2",
		SRSLevel: ptrInt(3), Source: mastery.SourceMaruMori,
	})
	for _, p := range []struct {
		day time.Time
		ok  bool
	}{
		{focusClock.AddDate(0, 0, -2), true},
		{focusClock.AddDate(0, 0, -1), true},
		{focusClock, true},
	} {
		m.AddPractice(uid, mastery.PracticeRecord{
			Key:        mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1557560"},
			Correct:    p.ok,
			AnsweredAt: p.day,
		})
	}
	m.AddKnownItem(uid, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindKanji, Ref: "学"}, MaruMoriID: "Kanji/9",
		SRSLevel: ptrInt(8), Source: mastery.SourceMaruMori,
	})
	m.AddKnownItem(uid, mastery.KnownItem{
		Key:    mastery.ItemKey{Kind: mastery.KindGrammar, Ref: "7"},
		Source: mastery.SourceSeeded,
	})
	observed := focusClock.AddDate(0, 0, -1)
	m.AddKnownItem(uid, mastery.KnownItem{
		Key:    mastery.ItemKey{Kind: mastery.KindGrammar, Ref: "42"},
		Source: mastery.SourceObserved, ObservedAt: &observed,
	})
}

func TestGetFocusSetRequiresASession(t *testing.T) {
	o := newFocusEnv(t)
	wantError(t, o.e.do(t, "GET", "/focus-set", "", nil), http.StatusUnauthorized, "unauthorized")
}

func TestGetFocusSetScoresOrdersAndRotatesOutGraduated(t *testing.T) {
	o := newFocusEnv(t)
	seedFocusFixtures(o.store, o.uid)
	rec := o.e.do(t, "GET", "/focus-set", "Bearer "+o.e.login(t, "alice"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body)
	}
	var body api.FocusSet
	mustJSON(t, rec, &body)

	if body.Size != mastery.DefaultSetSize {
		t.Errorf("size = %d, want the configured capacity %d", body.Size, mastery.DefaultSetSize)
	}
	// Order: pinned Observed Grammar first, then ascending Mastery. The
	// graduated vocabulary item (ref 1557560) is absent.
	wantRefs := []string{"42", "2023190", "7", "学"}
	wantMastery := []float64{mastery.NoEvidenceMastery, 2.0 / 9.0, mastery.NoEvidenceMastery, 8.0 / 9.0}
	if len(body.Items) != len(wantRefs) {
		t.Fatalf("items = %+v, want %d items", body.Items, len(wantRefs))
	}
	for i, item := range body.Items {
		if item.ItemRef != wantRefs[i] {
			t.Errorf("item %d = %q, want %q (full order: %+v)", i, item.ItemRef, wantRefs[i], body.Items)
			continue
		}
		if math.Abs(float64(item.Mastery)-wantMastery[i]) > 1e-4 {
			t.Errorf("mastery of %s = %v, want ~%v", item.ItemRef, item.Mastery, wantMastery[i])
		}
	}

	byRef := map[string]api.FocusSetItem{}
	for _, item := range body.Items {
		byRef[item.ItemRef] = item
	}
	if got := byRef["42"]; got.Kind != api.Grammar || got.Source != api.Observed || !got.NewlyObservedGrammar || got.SrsLevel != nil {
		t.Errorf("observed grammar = %+v, want grammar/observed, pinned, no SRS level", got)
	}
	if got := byRef["7"]; got.Source != api.Seeded || got.NewlyObservedGrammar || got.SrsLevel != nil {
		t.Errorf("seeded grammar = %+v, want seeded, not pinned, no SRS level", got)
	}
	if got := byRef["2023190"]; got.Kind != api.Vocabulary || got.Source != api.Marumori || got.SrsLevel == nil || *got.SrsLevel != 2 {
		t.Errorf("synced vocab = %+v, want marumori vocab with srsLevel 2", got)
	}
	if got := byRef["学"]; got.Kind != api.Kanji || got.SrsLevel == nil || *got.SrsLevel != 8 {
		t.Errorf("synced kanji = %+v, want kanji with srsLevel 8", got)
	}
}

func TestGetFocusSetIsScopedToTheTokensUser(t *testing.T) {
	o := newFocusEnv(t)
	seedFocusFixtures(o.store, o.uid)
	rec := o.e.do(t, "GET", "/focus-set", "Bearer "+o.e.login(t, "bob"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body)
	}
	var body api.FocusSet
	mustJSON(t, rec, &body)
	if len(body.Items) != 0 {
		t.Errorf("bob's set = %+v, want empty: alice's Known Items stay hers", body.Items)
	}
}

func TestFocusSetNotConfiguredIsAServiceError(t *testing.T) {
	// The pre-issue-#7 wiring (no WithFocusSet) answers 500, like the other
	// optional services.
	e := newEnv(t, fakeDB{})
	rec := e.do(t, "GET", "/focus-set", "Bearer "+e.login(t, "alice"), nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (%s)", rec.Code, rec.Body)
	}
}
