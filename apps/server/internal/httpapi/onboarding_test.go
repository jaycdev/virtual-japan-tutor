package httpapi_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar/knowngrammartest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// onboardingEnv serves the /starting-level and /grammar/review routes over the
// real auth middleware, with knowngrammar over in-memory stores (issue #6).
type onboardingEnv struct {
	e     env
	store *knowngrammartest.MemStore
	cat   *fakeCat
	svc   *knowngrammar.Service
	uid   uuid.UUID // alice's user id, for store inspection
}

// fakeCat is a canned knowngrammar.Catalogue.
type fakeCat struct{ points []refdata.GrammarPoint }

func (c *fakeCat) GrammarPointIDsAtOrBelow(_ context.Context, level refdata.Level) ([]int64, error) {
	var ids []int64
	for _, p := range c.points {
		for i, l := range refdata.Levels {
			if l == p.Level && i <= levelIndex(level) {
				ids = append(ids, p.ID)
				break
			}
		}
	}
	return ids, nil
}

func (c *fakeCat) GrammarPointsByNormalisedPattern(_ context.Context, normalised string) ([]refdata.GrammarPoint, error) {
	var out []refdata.GrammarPoint
	for _, p := range c.points {
		for _, v := range p.NormalisedVariants {
			if v == normalised {
				out = append(out, p)
				break
			}
		}
	}
	return out, nil
}

func levelIndex(level refdata.Level) int {
	for i, l := range refdata.Levels {
		if l == level {
			return i
		}
	}
	return len(refdata.Levels)
}

func newOnboardingEnv(t *testing.T) *onboardingEnv {
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

	store := knowngrammartest.NewMemStore()
	cat := &fakeCat{points: []refdata.GrammarPoint{
		{ID: 10, Level: refdata.N5, Pattern: "だけ", NormalisedPattern: "だけ", NormalisedVariants: []string{"だけ"}},
		{ID: 11, Level: refdata.N4, Pattern: "だけ", NormalisedPattern: "だけ", NormalisedVariants: []string{"だけ"}},
		{ID: 15, Level: refdata.N5, Pattern: "てしまう", NormalisedPattern: "てしまう", NormalisedVariants: []string{"てしまう"}},
	}}
	svc := knowngrammar.NewService(store, cat, refdata.NormalisePattern)

	e := env{h: httpapi.New(fakeDB{}, authSvc, httpapi.WithKnownGrammar(svc)), svc: authSvc, clock: clock}
	return &onboardingEnv{e: e, store: store, cat: cat, svc: svc, uid: alice.ID}
}

func TestStartingLevelUnconfiguredUntilSet(t *testing.T) {
	o := newOnboardingEnv(t)
	rec := o.e.do(t, "GET", "/starting-level", "Bearer "+o.e.login(t, "alice"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body)
	}
	var body struct {
		Configured bool    `json:"configured"`
		Level      *string `json:"level"`
	}
	mustJSON(t, rec, &body)
	if body.Configured || body.Level != nil {
		t.Errorf("body = %+v, want configured=false and no level", body)
	}
}

func TestSetStartingLevelSeedsGrammarAndReadsBack(t *testing.T) {
	o := newOnboardingEnv(t)
	token := o.e.login(t, "alice")

	rec := o.e.do(t, "PUT", "/starting-level", "Bearer "+token, map[string]string{"level": "N4"})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body)
	}
	var put struct {
		Configured bool   `json:"configured"`
		Level      string `json:"level"`
		Added      int    `json:"added"`
		Removed    int    `json:"removed"`
	}
	mustJSON(t, rec, &put)
	if !put.Configured || put.Level != "N4" || put.Added != 3 || put.Removed != 0 {
		t.Errorf("PUT body = %+v, want configured N4 with 3 points seeded", put)
	}
	ids, _ := o.store.SeededPoints(context.Background(), o.uid)
	if len(ids) != 3 {
		t.Errorf("seeded points = %v, want the three N5/N4 catalogue points", ids)
	}

	rec = o.e.do(t, "GET", "/starting-level", "Bearer "+token, nil)
	var get struct {
		Configured bool   `json:"configured"`
		Level      string `json:"level"`
		Added      *int   `json:"added"`
		Removed    *int   `json:"removed"`
	}
	mustJSON(t, rec, &get)
	if !get.Configured || get.Level != "N4" {
		t.Errorf("GET body = %+v, want the level read back", get)
	}
	if get.Added != nil || get.Removed != nil {
		t.Errorf("GET body = %+v, want no added/removed deltas outside a PUT", get)
	}
}

func TestSetStartingLevelRejectsUnknownLevel(t *testing.T) {
	o := newOnboardingEnv(t)
	rec := o.e.do(t, "PUT", "/starting-level", "Bearer "+o.e.login(t, "alice"), map[string]string{"level": "N7"})
	wantError(t, rec, http.StatusBadRequest, "invalid_level")
	if _, ok, _ := o.store.StartingLevel(context.Background(), o.uid); ok {
		t.Error("a rejected level was still stored")
	}
}

func TestStartingLevelRoutesRequireASession(t *testing.T) {
	o := newOnboardingEnv(t)
	for _, r := range []struct{ method, path string }{
		{"GET", "/starting-level"}, {"PUT", "/starting-level"}, {"GET", "/grammar/review"},
	} {
		rec := o.e.do(t, r.method, r.path, "", nil)
		wantError(t, rec, http.StatusUnauthorized, "unauthorized")
	}
}

func TestStartingLevelNotConfiguredIsAServiceError(t *testing.T) {
	// The pre-issue-#6 wiring (no WithKnownGrammar) answers 500, like the other
	// optional services.
	e := newEnv(t, fakeDB{})
	rec := e.do(t, "GET", "/starting-level", "Bearer "+e.login(t, "alice"), nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (%s)", rec.Code, rec.Body)
	}
}

// The settings "review these" list: flagged entries by default, everything with
// flagged=false, and a flagged no-match that clears once the catalogue grows.
func TestGrammarReviewListShowsFlaggedObservations(t *testing.T) {
	ctx := context.Background()
	o := newOnboardingEnv(t)
	token := o.e.login(t, "alice")

	if _, err := o.svc.SyncObserved(ctx, o.uid, []marumori.GrammarObservation{
		{MaruMoriID: "Grammar/202", Pattern: "〜てしまう", JLPTLevel: "N4", Level: intPtr(3)},  // clean match
		{MaruMoriID: "Grammar/904", Pattern: "ものではない", JLPTLevel: "N3", Level: intPtr(2)}, // no catalogue match
	}); err != nil {
		t.Fatal(err)
	}

	rec := o.e.do(t, "GET", "/grammar/review", "Bearer "+token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body)
	}
	var flagged []api.GrammarReviewItem
	mustJSON(t, rec, &flagged)
	if len(flagged) != 1 || flagged[0].MarumoriId != "Grammar/904" || !flagged[0].Flagged {
		t.Fatalf("flagged list = %+v, want only the unmatched observation", flagged)
	}
	if flagged[0].Pattern != "ものではない" {
		t.Errorf("pattern = %q, want the MaruMori pattern text", flagged[0].Pattern)
	}

	rec = o.e.do(t, "GET", "/grammar/review?flagged=false", "Bearer "+token, nil)
	var all []api.GrammarReviewItem
	mustJSON(t, rec, &all)
	if len(all) != 2 {
		t.Fatalf("all list = %+v, want both observations", all)
	}
	for _, item := range all {
		if item.MarumoriId == "Grammar/202" {
			if item.Flagged || item.MatchedPointId == nil || *item.MatchedPointId != 15 {
				t.Errorf("clean match item = %+v, want unflagged matched to point 15", item)
			}
			if item.JlptLevel == nil || *item.JlptLevel != api.GrammarReviewItemJlptLevel("N4") {
				t.Errorf("jlptLevel = %v, want N4 carried through", item.JlptLevel)
			}
		}
	}

	// The catalogue gains the point; the next Sync re-matches and it leaves the list.
	o.cat.points = append(o.cat.points, refdata.GrammarPoint{
		ID: 17, Level: refdata.N3, Pattern: "ものではない",
		NormalisedPattern: "ものではない", NormalisedVariants: []string{"ものではない"},
	})
	if _, err := o.svc.SyncObserved(ctx, o.uid, nil); err != nil {
		t.Fatal(err)
	}
	rec = o.e.do(t, "GET", "/grammar/review", "Bearer "+token, nil)
	flagged = nil
	mustJSON(t, rec, &flagged)
	if len(flagged) != 0 {
		t.Errorf("flagged list after re-match = %+v, want empty", flagged)
	}
	if p, ok, _ := o.store.KnownPoint(ctx, o.uid, 17); !ok || p.Source != knowngrammar.SourceObserved {
		t.Errorf("re-matched point 17 not observed: %+v ok=%v", p, ok)
	}
}
