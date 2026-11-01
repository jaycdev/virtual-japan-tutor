package knowngrammar_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar/knowngrammartest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// point builds a catalogue entry. variants are taken pre-normalised: matching
// compares NormalisePattern(observed) against these, exactly like the
// normalised_variants column.
func point(id int64, level refdata.Level, ordinal int, pattern string, variants ...string) refdata.GrammarPoint {
	if len(variants) == 0 {
		variants = []string{refdata.NormalisePattern(pattern)}
	}
	return refdata.GrammarPoint{
		ID: id, Level: level, Ordinal: ordinal, Pattern: pattern,
		NormalisedPattern: refdata.NormalisePattern(pattern), NormalisedVariants: variants,
	}
}

// fakeCatalogue is an in-memory Grammar Catalogue.
type fakeCatalogue struct {
	points []refdata.GrammarPoint
}

func (c *fakeCatalogue) GrammarPointIDsAtOrBelow(ctx context.Context, level refdata.Level) ([]int64, error) {
	var ids []int64
	for _, p := range c.points {
		if refdataRank(p.Level) <= refdataRank(level) {
			ids = append(ids, p.ID)
		}
	}
	return ids, nil
}

func (c *fakeCatalogue) GrammarPointsByNormalisedPattern(ctx context.Context, normalised string) ([]refdata.GrammarPoint, error) {
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

// refdataRank orders JLPT Levels easiest-first, as the production catalogue does.
func refdataRank(level refdata.Level) int {
	for i, l := range refdata.Levels {
		if l == level {
			return i
		}
	}
	return len(refdata.Levels)
}

func newService(store knowngrammar.Store, points ...refdata.GrammarPoint) *knowngrammar.Service {
	return knowngrammar.NewService(store, &fakeCatalogue{points: points}, refdata.NormalisePattern)
}

func observation(id, pattern, jlpt string, srsLevel *int) marumori.GrammarObservation {
	return marumori.GrammarObservation{MaruMoriID: id, Pattern: pattern, JLPTLevel: jlpt, Level: srsLevel}
}

func ptr(n int) *int { return &n }

// Seeds:
//   - だけ at N5 (id 10) and at N4 (id 11): the duplicate-pattern case (issue #6).
//   - だけ twice at N3 (ids 12 ordinal 1, 13 ordinal 2): the spreadsheet's
//     same-level duplicates.
//   - ちゃいけない・じゃいけない with two variants (id 14, N4): variant matching.
//   - てしまう (id 15, N5) and a lone N1 point (id 16).
func seedPoints() []refdata.GrammarPoint {
	return []refdata.GrammarPoint{
		point(10, refdata.N5, 1, "だけ"),
		point(11, refdata.N4, 1, "だけ"),
		point(12, refdata.N3, 1, "といい", "といい"),
		point(13, refdata.N3, 2, "といい", "といい"),
		point(14, refdata.N4, 1, "ちゃいけない・じゃいけない", "ちゃいけない", "じゃいけない"),
		point(15, refdata.N5, 1, "てしまう"),
		point(16, refdata.N1, 1, "ともなると"),
	}
}

func TestSetStartingLevelSeedsGrammarAtOrBelow(t *testing.T) {
	store := knowngrammartest.NewMemStore()
	svc := newService(store, seedPoints()...)
	user := uuid.New()

	delta, err := svc.SetStartingLevel(context.Background(), user, refdata.N4)
	if err != nil {
		t.Fatalf("SetStartingLevel: %v", err)
	}
	// N5 and N4 points: ids 10, 11, 14, 15.
	if delta.Added != 4 || delta.Removed != 0 || delta.Kept != 0 {
		t.Errorf("delta = %+v, want 4 added", delta)
	}
	for _, id := range []int64{10, 11, 14, 15} {
		p, ok, err := store.KnownPoint(context.Background(), user, id)
		if err != nil || !ok {
			t.Fatalf("point %d not seeded (ok=%v err=%v)", id, ok, err)
		}
		if p.Source != knowngrammar.SourceSeeded || p.Mastery != knowngrammar.SeededMastery {
			t.Errorf("point %d = %+v, want seeded at medium Mastery", id, p)
		}
	}
	for _, id := range []int64{12, 13, 16} {
		if _, ok, _ := store.KnownPoint(context.Background(), user, id); ok {
			t.Errorf("point %d above the Starting Level was seeded", id)
		}
	}
}

func TestSetStartingLevelRejectsUnknownLevel(t *testing.T) {
	store := knowngrammartest.NewMemStore()
	svc := newService(store, seedPoints()...)
	if _, err := svc.SetStartingLevel(context.Background(), uuid.New(), refdata.Level("N6")); !errors.Is(err, knowngrammar.ErrLevelRequired) {
		t.Fatalf("err = %v, want ErrLevelRequired", err)
	}
}

// Issue #6: "Changing the Starting Level later adds or removes Seeded Grammar
// only. Observed Grammar and the Practice Record are kept."
func TestStartingLevelChangeTouchesSeededGrammarOnly(t *testing.T) {
	ctx := context.Background()
	store := knowngrammartest.NewMemStore()
	svc := newService(store, seedPoints()...)
	user := uuid.New()

	if _, err := svc.SetStartingLevel(ctx, user, refdata.N4); err != nil {
		t.Fatalf("SetStartingLevel N4: %v", err)
	}
	// Observe ちゃう (id 14, an N4 seed) and the N1 point 16 through reviews,
	// and let Practice own 16's Mastery: the Practice Record must survive.
	if _, err := svc.SyncObserved(ctx, user, []marumori.GrammarObservation{
		observation("Grammar/16", "ともなると", "", ptr(2)),
		observation("Grammar/14", "じゃいけない", "", ptr(1)),
	}); err != nil {
		t.Fatalf("SyncObserved: %v", err)
	}
	if err := store.UpsertObservedPoint(ctx, user, 15); err != nil { // てしまう confirmed too
		t.Fatal(err)
	}

	delta, err := svc.SetStartingLevel(ctx, user, refdata.N5)
	if err != nil {
		t.Fatalf("SetStartingLevel N5: %v", err)
	}
	if delta.Removed != 1 || delta.Added != 0 {
		t.Errorf("delta = %+v, want exactly one removal (the seeded-only N4 point 11)", delta)
	}
	// Only point 11 (だけ N4) was seeded-only: it goes. 14 (ちゃう N4) was
	// confirmed by observation, so it stays as Observed Grammar.
	if _, ok, _ := store.KnownPoint(ctx, user, 11); ok {
		t.Error("the N4 seed だけ was kept after lowering the level to N5")
	}
	for _, id := range []int64{14, 15, 16} {
		p, ok, _ := store.KnownPoint(ctx, user, id)
		if !ok || p.Source != knowngrammar.SourceObserved {
			t.Errorf("observed point %d lost: %+v ok=%v", id, p, ok)
		}
	}
	for _, id := range []int64{10} {
		if p, ok, _ := store.KnownPoint(ctx, user, id); !ok || p.Source != knowngrammar.SourceSeeded {
			t.Errorf("N5 seed %d should remain seeded: %+v ok=%v", id, p, ok)
		}
	}
}

func TestDuplicatePatternUsesMaruMorisLevel(t *testing.T) {
	ctx := context.Background()
	store := knowngrammartest.NewMemStore()
	svc := newService(store, seedPoints()...)
	user := uuid.New()

	res, err := svc.SyncObserved(ctx, user, []marumori.GrammarObservation{
		observation("Grammar/900", "～だけ", "N4", ptr(3)),
	})
	if err != nil {
		t.Fatalf("SyncObserved: %v", err)
	}
	if res.Matched != 1 || res.Flagged != 0 || res.Queued != 0 || res.NewlyKnown != 1 {
		t.Fatalf("res = %+v, want one clean match", res)
	}
	p, ok, _ := store.KnownPoint(ctx, user, 11) // だけ @ N4
	if !ok || p.Source != knowngrammar.SourceObserved || p.Mastery != knowngrammar.ObservedMastery {
		t.Errorf("point 11 = %+v ok=%v, want observed at low Mastery", p, ok)
	}
	if _, ok, _ := store.KnownPoint(ctx, user, 10); ok {
		t.Error("the N5 twin of だけ became known: MaruMori's level was ignored")
	}
	obs, _ := store.Observations(ctx, user)
	if len(obs) != 1 || obs[0].MatchedPoint != 11 || obs[0].Flagged {
		t.Errorf("observation = %+v, want matched to 11 unflagged", obs)
	}
}

func TestDuplicatePatternWithoutMaruMorisLevelTakesLowestAndFlags(t *testing.T) {
	ctx := context.Background()
	store := knowngrammartest.NewMemStore()
	svc := newService(store, seedPoints()...)
	user := uuid.New()

	res, err := svc.SyncObserved(ctx, user, []marumori.GrammarObservation{
		// MaruMori grammar reviews carry no JLPT Level; the pattern also
		// exists twice at N3 with ordinals 1 and 2.
		observation("Grammar/901", "だけ", "", ptr(2)),
		observation("Grammar/902", "といい", "", ptr(1)),
	})
	if err != nil {
		t.Fatalf("SyncObserved: %v", err)
	}
	if res.Matched != 2 || res.Flagged != 2 {
		t.Fatalf("res = %+v, want two flagged matches", res)
	}
	if _, ok, _ := store.KnownPoint(ctx, user, 10); !ok {
		t.Error("だけ did not resolve to the lowest level (N5, id 10)")
	}
	if _, ok, _ := store.KnownPoint(ctx, user, 11); ok {
		t.Error("the N4 twin of だけ became known as well")
	}
	if _, ok, _ := store.KnownPoint(ctx, user, 12); !ok {
		t.Error("といい did not resolve to ordinal 1 (id 12)")
	}
	if _, ok, _ := store.KnownPoint(ctx, user, 13); ok {
		t.Error("the ordinal-2 twin of いい became known")
	}
	obs, _ := store.Observations(ctx, user)
	for _, o := range obs {
		if !o.Flagged {
			t.Errorf("observation %s resolved without MaruMori's level but is unflagged: %+v", o.MaruMoriID, o)
		}
	}
}

func TestVariantMatchNeedsNoFlag(t *testing.T) {
	ctx := context.Background()
	store := knowngrammartest.NewMemStore()
	svc := newService(store, seedPoints()...)
	user := uuid.New()

	res, err := svc.SyncObserved(ctx, user, []marumori.GrammarObservation{
		// The catalogue pattern is "ちゃいけない・じゃいけない"; MaruMori shows only one variant.
		observation("Grammar/903", "じゃいけない", "", ptr(4)),
	})
	if err != nil {
		t.Fatalf("SyncObserved: %v", err)
	}
	if res.Matched != 1 || res.Flagged != 0 {
		t.Fatalf("res = %+v, want one clean variant match", res)
	}
	if _, ok, _ := store.KnownPoint(ctx, user, 14); !ok {
		t.Error("variant did not match point 14")
	}
}

// "If there's no match, add a new flagged catalogue entry": the observation is
// recorded flagged, nothing becomes known, and the settings list can show it.
func TestNoMatchRecordsFlaggedObservationAndNothingKnown(t *testing.T) {
	ctx := context.Background()
	store := knowngrammartest.NewMemStore()
	svc := newService(store, seedPoints()...)
	user := uuid.New()

	res, err := svc.SyncObserved(ctx, user, []marumori.GrammarObservation{
		observation("Grammar/904", "ものではない", "N3", ptr(2)),
	})
	if err != nil {
		t.Fatalf("SyncObserved: %v", err)
	}
	if res.Queued != 1 || res.Matched != 0 || res.NewlyKnown != 0 {
		t.Fatalf("res = %+v, want one queued with nothing known", res)
	}
	obs, _ := store.Observations(ctx, user)
	if len(obs) != 1 || !obs[0].Flagged || obs[0].MatchedPoint != 0 {
		t.Errorf("observation = %+v, want flagged and unmatched", obs)
	}
	if seeded, _ := store.SeededPoints(ctx, user); len(seeded) != 0 {
		t.Errorf("an unmatched observation created seeded points: %v", seeded)
	}
}

// A flagged no-match becomes a normal match once the catalogue gains the point.
func TestUnmatchedObservationRematchesAfterCatalogueGrows(t *testing.T) {
	ctx := context.Background()
	store := knowngrammartest.NewMemStore()
	catalogue := &fakeCatalogue{points: seedPoints()}
	svc := knowngrammar.NewService(store, catalogue, refdata.NormalisePattern)
	user := uuid.New()

	res, err := svc.SyncObserved(ctx, user, []marumori.GrammarObservation{
		observation("Grammar/904", "ものではない", "N3", ptr(2)),
	})
	if err != nil || res.Queued != 1 {
		t.Fatalf("res = %+v err = %v, want queued", res, err)
	}
	catalogue.points = append(catalogue.points, point(17, refdata.N3, 1, "ものではない"))

	res, err = svc.SyncObserved(ctx, user, nil)
	if err != nil {
		t.Fatalf("second SyncObserved: %v", err)
	}
	if res.Matched != 1 || res.NewlyKnown != 1 {
		t.Fatalf("res = %+v, want the pending observation re-matched", res)
	}
	if _, ok, _ := store.KnownPoint(ctx, user, 17); !ok {
		t.Error("the re-matched point did not become a Known Item")
	}
	obs, _ := store.Observations(ctx, user)
	if obs[0].MatchedPoint != 17 || obs[0].Flagged {
		t.Errorf("observation = %+v, want resolved to 17 unflagged", obs)
	}
}

// One permanently absent pattern must not stall the rest of the pending list:
// every still-unmatched observation is retried on every Sync, so a second one
// that the catalogue has since gained still becomes a Known Item.
func TestRematchPendingContinuesPastStillUnmatchedObservation(t *testing.T) {
	ctx := context.Background()
	store := knowngrammartest.NewMemStore()
	catalogue := &fakeCatalogue{points: seedPoints()}
	svc := knowngrammar.NewService(store, catalogue, refdata.NormalisePattern)
	user := uuid.New()

	// Both stay pending. MemStore returns observations ordered by MaruMori id,
	// so the one that will never match is retried first.
	if _, err := svc.SyncObserved(ctx, user, []marumori.GrammarObservation{
		observation("Grammar/907", "ものではない", "N3", ptr(2)),
		observation("Grammar/908", "わけではない", "N3", ptr(1)),
	}); err != nil {
		t.Fatalf("first SyncObserved: %v", err)
	}
	catalogue.points = append(catalogue.points, point(18, refdata.N3, 1, "わけではない"))

	res, err := svc.SyncObserved(ctx, user, nil)
	if err != nil {
		t.Fatalf("second SyncObserved: %v", err)
	}
	if res.Matched != 1 || res.NewlyKnown != 1 {
		t.Fatalf("res = %+v, want the second pending observation re-matched", res)
	}
	if _, ok, _ := store.KnownPoint(ctx, user, 18); !ok {
		t.Error("the re-matched point did not become a Known Item")
	}
	obs, _ := store.Observations(ctx, user)
	if len(obs) != 2 {
		t.Fatalf("observations = %+v, want both still recorded", obs)
	}
	if obs[0].MaruMoriID != "Grammar/907" || obs[0].MatchedPoint != 0 || !obs[0].Flagged {
		t.Errorf("the still-unmatched observation changed: %+v", obs[0])
	}
	if obs[1].MaruMoriID != "Grammar/908" || obs[1].MatchedPoint != 18 || obs[1].Flagged {
		t.Errorf("the matchable observation = %+v, want resolved to 18 unflagged", obs[1])
	}
}

// An observation of a point that was already Seeded promotes it to Observed
// without touching its Mastery: that is Practice's to own.
func TestObservedConfirmationPromotesSeededPoint(t *testing.T) {
	ctx := context.Background()
	store := knowngrammartest.NewMemStore()
	svc := newService(store, seedPoints()...)
	user := uuid.New()

	if _, err := svc.SetStartingLevel(ctx, user, refdata.N5); err != nil {
		t.Fatal(err)
	}
	res, err := svc.SyncObserved(ctx, user, []marumori.GrammarObservation{
		observation("Grammar/905", "てしまう", "", ptr(1)),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Matched != 1 || res.NewlyKnown != 0 {
		t.Fatalf("res = %+v: a seeded point is not newly known", res)
	}
	p, ok, _ := store.KnownPoint(ctx, user, 15)
	if !ok || p.Source != knowngrammar.SourceObserved || p.Mastery != knowngrammar.SeededMastery {
		t.Errorf("point 15 = %+v ok=%v, want observed still at medium Mastery", p, ok)
	}
}

// An observation without a usable pattern (upstream sent neither japanese nor
// grammar) is recorded unmatched and flagged, never matched on an empty key.
func TestObservationWithoutPatternNeverMatches(t *testing.T) {
	ctx := context.Background()
	store := knowngrammartest.NewMemStore()
	svc := newService(store, point(20, refdata.N5, 1, ""))
	user := uuid.New()

	res, err := svc.SyncObserved(ctx, user, []marumori.GrammarObservation{
		observation("Grammar/906", "", "", ptr(1)),
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Matched != 0 || res.Queued != 1 {
		t.Fatalf("res = %+v, want queued not matched", res)
	}
}
