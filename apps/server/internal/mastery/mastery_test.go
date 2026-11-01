package mastery_test

import (
	"context"
	"math"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery/masterytest"
)

var (
	userID   = uuid.MustParse("11111111-1111-1111-1111-111111111111")
	otherID  = uuid.MustParse("22222222-2222-2222-2222-222222222222")
	fixedNow = time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
)

func newService(store mastery.Store, mutate func(*mastery.Options)) *mastery.Service {
	opts := mastery.DefaultOptions()
	opts.Now = func() time.Time { return fixedNow }
	if mutate != nil {
		mutate(&opts)
	}
	return mastery.NewService(store, opts)
}

func iptr(v int) *int             { return &v }
func tptr(t time.Time) *time.Time { return &t }

func vocabItem(ref string, level int) mastery.KnownItem {
	return mastery.KnownItem{
		Key:        mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: ref},
		MaruMoriID: ref, SRSLevel: iptr(level), Source: mastery.SourceMaruMori,
	}
}

func kanjiItem(ref string, level int) mastery.KnownItem {
	return mastery.KnownItem{
		Key:        mastery.ItemKey{Kind: mastery.KindKanji, Ref: ref},
		MaruMoriID: ref, SRSLevel: iptr(level), Source: mastery.SourceMaruMori,
	}
}

func grammarItem(ref string, source mastery.Source, level *int, observedAt *time.Time) mastery.KnownItem {
	return mastery.KnownItem{
		Key:      mastery.ItemKey{Kind: mastery.KindGrammar, Ref: ref},
		SRSLevel: level, Source: source, ObservedAt: observedAt,
	}
}

func ago(d int) time.Time { return fixedNow.Add(-time.Duration(d) * 24 * time.Hour) }

func practiceFor(ref mastery.ItemKey, correct bool, daysAgo int) mastery.PracticeRecord {
	return mastery.PracticeRecord{Key: ref, Correct: correct, AnsweredAt: ago(daysAgo)}
}

func signalFor(ref mastery.ItemKey, signal string, daysAgo int) mastery.WeakSignalRecord {
	return mastery.WeakSignalRecord{Key: ref, Signal: signal, OccurredAt: ago(daysAgo)}
}

func scoreOf(t *testing.T, svc *mastery.Service, key mastery.ItemKey) float64 {
	t.Helper()
	items, err := svc.Score(context.Background(), userID)
	if err != nil {
		t.Fatalf("Score: %v", err)
	}
	for _, it := range items {
		if it.Key() == key {
			return it.Mastery
		}
	}
	t.Fatalf("no score for %v", key)
	return 0
}

func near(got, want float64) bool { return math.Abs(got-want) < 1e-9 }

// --- scoring ---

func TestMasteryOrdersBySRSLevel(t *testing.T) {
	store := masterytest.NewMemStore()
	for _, c := range []struct {
		ref   string
		level int
	}{{"weak", 1}, {"mid", 5}, {"strong", 9}} {
		store.AddKnownItem(userID, vocabItem(c.ref, c.level))
	}
	svc := newService(store, nil)

	weak, mid, strong :=
		scoreOf(t, svc, mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "weak"}),
		scoreOf(t, svc, mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "mid"}),
		scoreOf(t, svc, mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "strong"})
	if !(weak < mid && mid < strong) {
		t.Fatalf("want weak < mid < strong, got %g %g %g", weak, mid, strong)
	}
	// SRS-only evidence: the score is the level over the maximum level.
	if !near(weak, 1.0/9.0) || !near(strong, 1.0) {
		t.Fatalf("level 1 = %g (want 1/9), level 9 = %g (want 1)", weak, strong)
	}
}

func TestNoEvidenceIsMedium(t *testing.T) {
	store := masterytest.NewMemStore()
	store.AddKnownItem(userID, grammarItem("gp-seeded", mastery.SourceSeeded, nil, nil))
	store.AddKnownItem(userID, vocabItem("lvl1", 1))
	store.AddKnownItem(userID, vocabItem("lvl5", 5))
	svc := newService(store, nil)

	seeded := scoreOf(t, svc, mastery.ItemKey{Kind: mastery.KindGrammar, Ref: "gp-seeded"})
	if !near(seeded, mastery.NoEvidenceMastery) {
		t.Fatalf("no-evidence mastery = %g, want %g", seeded, mastery.NoEvidenceMastery)
	}
	// Medium: below evidence of trouble (level 1), above evidence of strength (level 5).
	if weak, strong := scoreOf(t, svc, mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "lvl1"}), scoreOf(t, svc, mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "lvl5"}); !(weak < seeded && seeded < strong) {
		t.Fatalf("want level-1 %g < seeded %g < level-5 %g", weak, seeded, strong)
	}
}

func TestSRSLevelDropIsAWeakSign(t *testing.T) {
	key := func(ref string) mastery.ItemKey { return mastery.ItemKey{Kind: mastery.KindKanji, Ref: ref} }
	store := masterytest.NewMemStore()
	store.AddKnownItem(userID, kanjiItem("dropped", 4))
	store.AddKnownItem(userID, kanjiItem("steady", 4))
	store.AddKnownItem(userID, kanjiItem("risen", 4))
	store.AddTrend(userID, mastery.LevelTrend{Kind: mastery.KindKanji, MaruMoriID: "dropped", Delta: -1})
	store.AddTrend(userID, mastery.LevelTrend{Kind: mastery.KindKanji, MaruMoriID: "risen", Delta: 2})
	svc := newService(store, nil)

	dropped, steady, risen := scoreOf(t, svc, key("dropped")), scoreOf(t, svc, key("steady")), scoreOf(t, svc, key("risen"))
	if !(dropped < steady && steady < risen) {
		t.Fatalf("want dropped %g < steady %g < risen %g", dropped, steady, risen)
	}
	if !near(dropped, (0.5*4.0/9.0)/0.6) {
		t.Fatalf("dropped = %g, want the trend component at 0", dropped)
	}
	if !near(risen, (0.5*4.0/9.0+0.1)/0.6) {
		t.Fatalf("risen = %g, want a clean trend component", risen)
	}
}

func TestLevelTrendJoinsOnMaruMoriID(t *testing.T) {
	// The Sync history keys by MaruMori id, not the item ref: the join must use it.
	it := mastery.KnownItem{
		Key:        mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "31288892"},
		MaruMoriID: "VocabularyForms/31288892", SRSLevel: iptr(4), Source: mastery.SourceMaruMori,
	}
	store := masterytest.NewMemStore()
	store.AddKnownItem(userID, it)
	store.AddTrend(userID, mastery.LevelTrend{Kind: mastery.KindVocabulary, MaruMoriID: "31288892", Delta: -1})
	svc := newService(store, nil)

	got := scoreOf(t, svc, it.Key)
	if !near(got, 4.0/9.0) {
		t.Fatalf("trend keyed by the item ref scored %g; the join must use the MaruMori id", got)
	}

	store.AddTrend(userID, mastery.LevelTrend{Kind: mastery.KindVocabulary, MaruMoriID: "VocabularyForms/31288892", Delta: -1})
	if dropped := scoreOf(t, svc, it.Key); !near(dropped, (0.5*4.0/9.0)/0.6) {
		t.Fatalf("trend keyed by the MaruMori id scored %g", dropped)
	}
}

func TestPracticeRecordWeighsRecentResultsMore(t *testing.T) {
	key := func(ref string) mastery.ItemKey { return mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: ref} }
	store := masterytest.NewMemStore()
	store.AddKnownItem(userID, vocabItem("recent-right", 3))
	store.AddKnownItem(userID, vocabItem("recent-wrong", 3))
	store.AddKnownItem(userID, vocabItem("untouched", 3))
	recentRight, recentWrong := key("recent-right"), key("recent-wrong")
	store.AddPractice(userID, practiceFor(recentRight, true, 1))
	store.AddPractice(userID, practiceFor(recentRight, false, 60))
	store.AddPractice(userID, practiceFor(recentWrong, false, 1))
	store.AddPractice(userID, practiceFor(recentWrong, true, 60))
	svc := newService(store, nil)

	right, wrong, untouched := scoreOf(t, svc, recentRight), scoreOf(t, svc, recentWrong), scoreOf(t, svc, key("untouched"))
	if !(wrong < untouched && untouched < right) {
		t.Fatalf("want recent-wrong %g < untouched %g < recent-right %g", wrong, untouched, right)
	}
}

func TestWeakSignalsLowerMasteryAndFade(t *testing.T) {
	key := func(ref string) mastery.ItemKey { return mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: ref} }
	store := masterytest.NewMemStore()
	store.AddKnownItem(userID, vocabItem("fresh-sign", 6))
	store.AddKnownItem(userID, vocabItem("stale-sign", 6))
	store.AddKnownItem(userID, vocabItem("clean", 6))
	fresh, stale := key("fresh-sign"), key("stale-sign")
	store.AddSignal(userID, signalFor(fresh, "lookup", 0))
	store.AddSignal(userID, signalFor(stale, "lookup", 90)) // three half-lives old
	svc := newService(store, nil)

	f, s, c := scoreOf(t, svc, fresh), scoreOf(t, svc, stale), scoreOf(t, svc, key("clean"))
	if !(f < s && s < c) {
		t.Fatalf("want fresh-signal %g < stale-signal %g < clean %g", f, s, c)
	}
	// One fresh signal costs Weights.WeakSignals outright.
	if !near(f, 6.0/9.0-0.2) {
		t.Fatalf("fresh-signal = %g, want 6/9 − 0.2", f)
	}
}

func TestManyWeakSignalsFloorAtZeroButNeverBelow(t *testing.T) {
	key := mastery.ItemKey{Kind: mastery.KindKanji, Ref: "食"}
	store := masterytest.NewMemStore()
	store.AddKnownItem(userID, kanjiItem("食", 1))
	for i := range 6 {
		store.AddSignal(userID, mastery.WeakSignalRecord{Key: key, Signal: "lookup", OccurredAt: fixedNow.Add(-time.Duration(i) * time.Hour)})
	}
	svc := newService(store, nil)

	if got := scoreOf(t, svc, key); got != 0 {
		t.Fatalf("score = %g, want exactly 0 (clamped, not negative)", got)
	}
}

func TestWeightsAreConfigurable(t *testing.T) {
	kV, kG := mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "srs-ace"}, mastery.ItemKey{Kind: mastery.KindGrammar, Ref: "gp-practised"}
	store := masterytest.NewMemStore()
	store.AddKnownItem(userID, vocabItem("srs-ace", 9))
	store.AddKnownItem(userID, grammarItem("gp-practised", mastery.SourceSeeded, iptr(1), nil))
	for d := range 4 {
		store.AddPractice(userID, practiceFor(kG, true, d))
	}

	srsFirst := newService(store, nil)
	if a, b := scoreOf(t, srsFirst, kV), scoreOf(t, srsFirst, kG); !(b < a) {
		t.Fatalf("default weights: practised %g should trail level-9 %g", b, a)
	}
	// Zeroing the SRS weight leaves the level-9 item with no evidence (medium)
	// and the practised item at a perfect practice score: the order flips.
	srsOff := newService(store, func(o *mastery.Options) { o.Weights.SRS = 0 })
	if a, b := scoreOf(t, srsOff, kV), scoreOf(t, srsOff, kG); !(a < b) {
		t.Fatalf("SRS weight 0: level-9 %g should fall below practised %g", a, b)
	}
}

// mastery.Options{} is the "no tuning wanted" case. Left as-is, all-zero
// weights would switch every component off and silently score every item at
// NoEvidenceMastery, so a fully zero Weights falls back to the defaults.
func TestZeroWeightsFallBackToTheDefaults(t *testing.T) {
	store := masterytest.NewMemStore()
	store.AddKnownItem(userID, vocabItem("weak", 2))
	store.AddKnownItem(userID, vocabItem("strong", 8))
	svc := mastery.NewService(store, mastery.Options{})
	for ref, want := range map[string]float64{"weak": 2.0 / 9.0, "strong": 8.0 / 9.0} {
		key := mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: ref}
		if got := scoreOf(t, svc, key); !near(got, want) {
			t.Errorf("%s = %g, want %g: zero Weights must fall back to the default weights", ref, got, want)
		}
	}
}

func TestMasteryStaysWithinZeroAndOne(t *testing.T) {
	store := masterytest.NewMemStore()
	store.AddKnownItem(userID, vocabItem("ace", 9))
	store.AddKnownItem(userID, kanjiItem("slow", 1))
	store.AddKnownItem(userID, grammarItem("gp-raw", mastery.SourceObserved, nil, tptr(ago(2))))
	ace := mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "ace"}
	for d := range 3 {
		store.AddPractice(userID, practiceFor(ace, true, d))
	}
	svc := newService(store, nil)

	for _, tc := range []struct {
		key  mastery.ItemKey
		want float64
	}{{ace, 1.0}, {mastery.ItemKey{Kind: mastery.KindKanji, Ref: "slow"}, 1.0 / 9.0}} {
		if got := scoreOf(t, svc, tc.key); got < 0 || got > 1 || !near(got, tc.want) {
			t.Fatalf("%v = %g, want %g within [0,1]", tc.key, got, tc.want)
		}
	}
}

// --- focus set ---

func setFixture(items ...mastery.KnownItem) *masterytest.MemStore {
	store := masterytest.NewMemStore()
	for _, it := range items {
		store.AddKnownItem(userID, it)
	}
	return store
}

func refsOf(set mastery.FocusSet) []mastery.ItemKey {
	out := make([]mastery.ItemKey, len(set.Items))
	for i, it := range set.Items {
		out[i] = it.Key()
	}
	return out
}

func hasRef(set mastery.FocusSet, ref string) bool {
	for _, it := range set.Items {
		if it.Key().Ref == ref {
			return true
		}
	}
	return false
}

func TestFocusSetTakesTheWeakestItems(t *testing.T) {
	var items []mastery.KnownItem
	for i := range 30 {
		level := 1 + i%9 // mixed levels: mastery = level/9
		items = append(items, vocabItem(string(rune('a'+i)), level))
	}
	// A foreign user's items must never leak into the set.
	store := setFixture(items...)
	store.AddKnownItem(otherID, vocabItem("mine", 1))
	svc := newService(store, func(o *mastery.Options) { o.SetSize = 15; o.MaxPerKind = 15 })

	set, err := svc.FocusSet(context.Background(), userID)
	if err != nil {
		t.Fatalf("FocusSet: %v", err)
	}
	if set.Size != 15 || len(set.Items) != 15 {
		t.Fatalf("set size = %d with %d items, want capacity 15 full", set.Size, len(set.Items))
	}
	for i := 1; i < len(set.Items); i++ {
		if set.Items[i-1].Mastery > set.Items[i].Mastery {
			t.Fatalf("items %d..%d not ascending by mastery", i-1, i)
		}
	}
	// The fifteen weakest, exactly: levels cycle a..z by i%9, so the level-1
	// through level-4 items fill the set and every stronger item stays out.
	wantRefs := []string{"a", "j", "s", "|", "b", "k", "t", "}", "c", "l", "u", "~", "d", "m", "v"}
	gotRefs := make([]string, 0, len(set.Items))
	for _, it := range set.Items {
		gotRefs = append(gotRefs, it.Key().Ref)
	}
	if strings.Join(gotRefs, ",") != strings.Join(wantRefs, ",") {
		t.Fatalf("set refs = %v, want exactly %v", gotRefs, wantRefs)
	}
	if hasRef(set, "mine") {
		t.Fatalf("another user's item leaked into the set")
	}
}

func TestFocusSetCapsEachKindButBackfillsWhenShort(t *testing.T) {
	var items []mastery.KnownItem
	for i := range 20 {
		items = append(items, vocabItem(string(rune('a'+i)), 1)) // weak vocabulary
	}
	for i := range 4 {
		items = append(items, kanjiItem(string(rune('A'+i)), 9)) // strong kanji
	}
	store := setFixture(items...)
	svc := newService(store, func(o *mastery.Options) { o.SetSize = 15; o.MaxPerKind = 12 })

	set, err := svc.FocusSet(context.Background(), userID)
	if err != nil {
		t.Fatalf("FocusSet: %v", err)
	}
	var vocabCount, kanjiCount int
	for _, it := range set.Items {
		switch it.Key().Kind {
		case mastery.KindVocabulary:
			vocabCount++
		case mastery.KindKanji:
			kanjiCount++
		}
	}
	// 20 weaker vocabulary items are available, but the per-kind cap reserves
	// the last slots for kanji: the set mixes instead of drowning in vocab.
	if vocabCount != 12 || kanjiCount != 3 {
		t.Fatalf("mix = %d vocabulary + %d kanji, want 12 (the cap) + 3 backfill kanji", vocabCount, kanjiCount)
	}
}

func TestFocusSetRelaxesTheKindCapToFillUp(t *testing.T) {
	var items []mastery.KnownItem
	for i := range 25 {
		items = append(items, vocabItem(string(rune('a'+i)), 1))
	}
	store := setFixture(items...)
	svc := newService(store, func(o *mastery.Options) { o.SetSize = 20; o.MaxPerKind = 12 })

	set, err := svc.FocusSet(context.Background(), userID)
	if err != nil {
		t.Fatalf("FocusSet: %v", err)
	}
	// A learner who only knows vocabulary still gets a full set.
	if len(set.Items) != 20 {
		t.Fatalf("only %d items, want the cap relaxed to fill all 20 slots", len(set.Items))
	}
}

func TestFocusSetDropsGraduatedItemsAndBackfills(t *testing.T) {
	// 16 items of graded mastery, plus a proven correct run on the first one.
	// Without graduation its post-practice mastery would tie the level-4 items
	// and, leading the tie by ref, push "p" out of the 15 slots.
	var items []mastery.KnownItem
	for i := range 16 {
		items = append(items, vocabItem(string(rune('a'+i)), 1+i/4))
	}
	store := setFixture(items...)
	weakest := mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "a"}
	store.AddPractice(userID, practiceFor(weakest, true, 5))
	store.AddPractice(userID, practiceFor(weakest, true, 2))
	store.AddPractice(userID, practiceFor(weakest, true, 1)) // 3 correct over 2+ days
	svc := newService(store, func(o *mastery.Options) { o.SetSize = 15; o.MaxPerKind = 15 })

	set, err := svc.FocusSet(context.Background(), userID)
	if err != nil {
		t.Fatalf("FocusSet: %v", err)
	}
	if hasRef(set, "a") {
		t.Fatalf("graduated item still in the set")
	}
	if !hasRef(set, "p") {
		t.Fatalf("the next weakest item did not backfill the freed slot")
	}
	if len(set.Items) != 15 {
		t.Fatalf("%d items, want 15 after backfill", len(set.Items))
	}
	scored, err := svc.Score(context.Background(), userID)
	if err != nil {
		t.Fatalf("Score: %v", err)
	}
	var found bool
	for _, it := range scored {
		if it.Key() == weakest {
			found = true
			if !it.Graduated {
				t.Fatalf("Score must mark the graduated item (it stays visible, only the set drops it)")
			}
		}
	}
	if !found {
		t.Fatalf("Score dropped the graduated item entirely")
	}
}

func TestGraduationNeedsThreeCorrectAcrossTwoDays(t *testing.T) {
	cases := []struct {
		name string
		recs []bool
		want bool // want graduated
	}{
		{"3 correct on one day", []bool{true, true, true}, false},
		{"2 correct over 2 days", []bool{true, true}, false},
		{"3 correct over 2 days", nil, true},
		{"wrong answer breaks the run", []bool{true, true, true, false}, false},
		{"3 correct spanning 3 days", nil, true},
	}
	// Built per-case for the date spread:
	daySpread := [][]int{{0, 0, 0}, {1, 0}, {5, 2, 1}, {4, 3, 2, 1}, {9, 5, 1}}
	for i, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			store := setFixture(vocabItem("it", 3))
			key := mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "it"}
			spread := daySpread[i]
			if tc.recs == nil { // all correct
				for _, d := range spread {
					store.AddPractice(userID, practiceFor(key, true, d))
				}
			} else {
				for j, ok := range tc.recs {
					store.AddPractice(userID, practiceFor(key, ok, spread[j]))
				}
			}
			svc := newService(store, func(o *mastery.Options) { o.SetSize = 15; o.MaxPerKind = 15 })
			set, err := svc.FocusSet(context.Background(), userID)
			if err != nil {
				t.Fatalf("FocusSet: %v", err)
			}
			if inSet := hasRef(set, "it"); inSet == tc.want {
				t.Fatalf("in set = %v, want graduated = %v (i.e. in set = %v)", inSet, tc.want, !tc.want)
			}
		})
	}
}

func TestFocusSetPinsNewlyObservedGrammar(t *testing.T) {
	store := setFixture(
		grammarItem("gp-new", mastery.SourceObserved, iptr(9), tptr(ago(2))),   // strong, but new
		grammarItem("gp-old", mastery.SourceObserved, iptr(1), tptr(ago(100))), // weak, but old
		grammarItem("gp-seeded", mastery.SourceSeeded, nil, nil),
	)
	for i := range 3 {
		store.AddKnownItem(userID, vocabItem(string(rune('a'+i)), 1))
	}
	svc := newService(store, func(o *mastery.Options) { o.SetSize = 15; o.MaxPerKind = 15 })

	set, err := svc.FocusSet(context.Background(), userID)
	if err != nil {
		t.Fatalf("FocusSet: %v", err)
	}
	if len(set.Items) == 0 || set.Items[0].Key().Ref != "gp-new" {
		t.Fatalf("first item = %+v, want the newly observed grammar point", set.Items)
	}
	if !set.Items[0].NewlyObservedGrammar {
		t.Fatalf("pinned item not flagged NewlyObservedGrammar")
	}
	// The rest stays mastery-ordered: gp-old (level 1) leads the unpinned run.
	if set.Items[1].Key().Ref != "gp-old" {
		t.Fatalf("second item = %v, want the weakest unpinned item", set.Items[1].Key())
	}
	if set.Items[len(set.Items)-1].Key().Ref != "gp-new" && set.Items[len(set.Items)-1].NewlyObservedGrammar {
		t.Fatalf("a pinned item sits after unpinned ones")
	}
}

func TestFocusSetPinnedGrammarDisplacesTheCutoff(t *testing.T) {
	var items []mastery.KnownItem
	for i := range 15 {
		items = append(items, vocabItem(string(rune('a'+i)), 1)) // 15 weak vocabulary items
	}
	items = append(items, grammarItem("gp-new", mastery.SourceObserved, iptr(5), tptr(ago(3))))
	store := setFixture(items...)
	svc := newService(store, func(o *mastery.Options) { o.SetSize = 15; o.MaxPerKind = 15 })

	set, err := svc.FocusSet(context.Background(), userID)
	if err != nil {
		t.Fatalf("FocusSet: %v", err)
	}
	if !hasRef(set, "gp-new") {
		t.Fatalf("newly observed grammar missed the set despite the pin")
	}
	if len(set.Items) != 15 {
		t.Fatalf("%d items, want 15", len(set.Items))
	}
	// All 15 vocabulary items scored level 1 = 1/9; the pin pushes one out.
	var vocabCount int
	for _, it := range set.Items {
		if it.Key().Kind == mastery.KindVocabulary {
			vocabCount++
		}
	}
	if vocabCount != 14 {
		t.Fatalf("%d vocabulary items, want 14 (one displaced by the pinned grammar)", vocabCount)
	}
}

func TestObservedGrammarOutsideTheWindowIsNotPinned(t *testing.T) {
	store := setFixture(
		grammarItem("gp-stale", mastery.SourceObserved, iptr(9), tptr(ago(30))), // observed 30d ago
		grammarItem("gp-seeded-newish", mastery.SourceSeeded, nil, tptr(ago(1))),
	)
	for i := range 3 {
		store.AddKnownItem(userID, vocabItem(string(rune('a'+i)), 1))
	}
	svc := newService(store, func(o *mastery.Options) { o.SetSize = 15; o.MaxPerKind = 15 })

	set, err := svc.FocusSet(context.Background(), userID)
	if err != nil {
		t.Fatalf("FocusSet: %v", err)
	}
	for _, it := range set.Items {
		if it.NewlyObservedGrammar {
			t.Fatalf("%v flagged as new although observed 30 days ago (window 14)", it.Key())
		}
	}
	if set.Items[0].Key().Ref == "gp-stale" {
		t.Fatalf("stale grammar pinned ahead of weaker items")
	}
}

func TestFocusSetEmptyLearner(t *testing.T) {
	svc := newService(masterytest.NewMemStore(), nil)
	set, err := svc.FocusSet(context.Background(), userID)
	if err != nil {
		t.Fatalf("FocusSet: %v", err)
	}
	if len(set.Items) != 0 {
		t.Fatalf("%d items for a learner with no Known Items", len(set.Items))
	}
	if set.Size != mastery.DefaultSetSize {
		t.Fatalf("Size = %d, want the configured default %d", set.Size, mastery.DefaultSetSize)
	}
}
