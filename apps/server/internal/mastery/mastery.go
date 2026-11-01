// Package mastery owns Mastery scoring and the Focus Set (issue #7,
// docs/adr/0001 and docs/adr/0004). Mastery is a 0–1 score per Known Item
// built from four signals: the SRS Level, its trend between Syncs (a drop is
// a strong weak sign), the Learner's Practice Record (recent results weigh
// more) and Weak Signals. All weights live in server config.
//
// The Focus Set is the rotating group of 15–20 low-Mastery Known Items that
// Practice Sessions (issue #9) and Stories (issue #10) target: it mixes
// vocabulary, kanji and grammar, drops items the Learner has demonstrably
// nailed (a run of correct answers across two different days) and backfills
// with the next weakest. Newly Observed Grammar is pinned to the front so it
// is targeted straight away (docs/adr/0003).
//
// The app never schedules reviews and runs no competing SRS (docs/adr/0004):
// the set is recomputed from stored signals on every read, and Mastery is
// never persisted, so it can never drift from its inputs.
package mastery

import (
	"context"
	"math"
	"sort"
	"time"

	"github.com/google/uuid"
)

// Kind distinguishes the three Item types a Focus Set mixes. Kanji and
// vocabulary come from Sync, grammar from the Grammar Catalogue (issue #6).
type Kind string

const (
	KindKanji      Kind = "kanji"
	KindVocabulary Kind = "vocabulary"
	KindGrammar    Kind = "grammar"
)

// Source records why a Known Item is known: a Synced Known Item, Seeded
// Grammar, or Observed Grammar.
type Source string

const (
	SourceMaruMori Source = "marumori"
	SourceSeeded   Source = "seeded"
	SourceObserved Source = "observed"
)

// ItemKey identifies one Known Item for Practice Record and Weak Signal joins:
// the JMdict ent_seq (as text) for linked vocabulary, the literal for linked
// kanji, the MaruMori id for items with no reference-data link, and the
// Grammar Catalogue point id (as text) for grammar. The Focus Set API exposes
// exactly this ref so later features can record results against it.
type ItemKey struct {
	Kind Kind
	Ref  string
}

// KnownItem is one Known Item from the read side of the knowledge state.
// SRSLevel is nil when MaruMori reports no SRS state for the item (Seeded
// Grammar, or a grammar point seen in lessons only).
type KnownItem struct {
	Key        ItemKey
	MaruMoriID string // kanji/vocabulary only: the join key for LevelTrends
	SRSLevel   *int
	Source     Source
	ObservedAt *time.Time // grammar only: first Catalogue-matched observation
}

// LevelTrend is the most recent level_changed delta (new − old) for one
// Synced Known Item. Items with no level history have no LevelTrend. The
// newest change stands as the item's trend until the next one lands (on the
// next Sync): the delta itself is not aged out over time — decay is a
// follow-up if the signal turns out noisier than useful.
type LevelTrend struct {
	Kind       Kind
	MaruMoriID string
	Delta      int
}

// PracticeRecord is one Exercise result from the Practice Record.
type PracticeRecord struct {
	Key        ItemKey
	Correct    bool
	AnsweredAt time.Time
}

// WeakSignalRecord is one Weak Signal from reading behaviour. Signal is free
// text ('lookup', 'translation_unblur', 'boosting_list', ...); its cost is
// Weights.WeakSignals, shared by every kind of signal.
type WeakSignalRecord struct {
	Key        ItemKey
	Signal     string
	OccurredAt time.Time
}

// Weights scale the Mastery components. SRS, Practice and Trend scale the
// positive-evidence average (a weight of 0 removes its component; the rest
// share the score proportionally). WeakSignals is different: it is the cost
// of one fresh Weak Signal, subtracted from that average (0–1).
type Weights struct {
	SRS         float64
	Practice    float64
	Trend       float64
	WeakSignals float64
}

// Options configures scoring and rotation. Zero (or absent) fields fall back
// to the defaults below; cmd/server passes them from internal/config.
type Options struct {
	Weights Weights

	// BoostingBonus is the mastery push for Boosting List membership
	// (issue #12): a Known Item in at least one Boosting List has this
	// much subtracted from its score — exactly once, however many Boosting
	// Lists hold it. 0 disables the boost, so withDefaults deliberately
	// leaves it alone (0 is a meaningful choice); cmd/server supplies
	// DefaultBoostingBonus through config.
	BoostingBonus float64

	// PracticeHalfLife: a Practice Record result's influence halves every
	// PracticeHalfLife (recent results weigh more).
	PracticeHalfLife time.Duration
	// WeakSignalHalfLife: a Weak Signal's cost halves every WeakSignalHalfLife.
	WeakSignalHalfLife time.Duration
	// TrendDropPenalty is the fraction of the trend component a one-level SRS
	// Level drop costs (1.0 makes any drop zero the component).
	TrendDropPenalty float64

	// GraduateStreak and GraduateMinDays are the rotation threshold: an item
	// with GraduateStreak correct answers in a row, spanning at least
	// GraduateMinDays different UTC days, leaves the Focus Set.
	GraduateStreak  int
	GraduateMinDays int

	// SetSize is the Focus Set's capacity (15–20); MaxPerKind caps how many
	// items of one Kind it holds when other kinds are available.
	SetSize    int
	MaxPerKind int
	// NewGrammarWindow: Observed Grammar first seen within this window is
	// pinned to the front of the set (docs/adr/0003: targeted straight away).
	NewGrammarWindow time.Duration

	// Now is the clock for recency decay; nil uses time.Now.
	Now func() time.Time
}

// Defaults for the Options above. Config exposes each as an env var.
const (
	MaxSRSLevel = 9

	DefaultPracticeHalfLife   = 14 * 24 * time.Hour
	DefaultWeakSignalHalfLife = 30 * 24 * time.Hour
	DefaultTrendDropPenalty   = 1.0
	DefaultGraduateStreak     = 3
	DefaultGraduateMinDays    = 2
	DefaultSetSize            = 20
	DefaultMaxPerKind         = 12
	DefaultNewGrammarWindow   = 14 * 24 * time.Hour
	DefaultWeightSRS          = 0.5
	DefaultWeightPractice     = 0.3
	DefaultWeightTrend        = 0.1
	DefaultWeightWeakSignals  = 0.2 // one fresh Weak Signal costs this much

	// DefaultBoostingBonus is the score cost of sitting in a Boosting List
	// (issue #12): one membership's worth, deduped per item, so ten boosting
	// lists push exactly as hard as one. Config exposes it as
	// MASTERY_BOOSTING_BONUS.
	DefaultBoostingBonus = 0.15
)

// NoEvidenceMastery is the score for a Known Item none of the signals has
// touched yet — Seeded Grammar with no practice and no weak signs. It is
// medium (docs/adr/0003), so such items rank below items with evidence of
// trouble but above items with evidence of strength.
const NoEvidenceMastery = 0.5

// DefaultOptions returns the defaults above.
func DefaultOptions() Options {
	return Options{
		Weights:            Weights{DefaultWeightSRS, DefaultWeightPractice, DefaultWeightTrend, DefaultWeightWeakSignals},
		BoostingBonus:      DefaultBoostingBonus,
		PracticeHalfLife:   DefaultPracticeHalfLife,
		WeakSignalHalfLife: DefaultWeakSignalHalfLife,
		TrendDropPenalty:   DefaultTrendDropPenalty,
		GraduateStreak:     DefaultGraduateStreak,
		GraduateMinDays:    DefaultGraduateMinDays,
		SetSize:            DefaultSetSize,
		MaxPerKind:         DefaultMaxPerKind,
		NewGrammarWindow:   DefaultNewGrammarWindow,
	}
}

// withDefaults fills unset fields. A fully zero Weights also falls back to
// the defaults: Options{} is the "no tuning wanted" case, and all-zero
// positive-evidence weights would otherwise silently flatten every Mastery to
// NoEvidenceMastery. (Config additionally refuses that combination in
// loadMastery.)
func (o Options) withDefaults() Options {
	if o.Now == nil {
		o.Now = time.Now
	}
	def := DefaultOptions()
	if o.Weights == (Weights{}) {
		o.Weights = def.Weights
	}
	// BoostingBonus deliberately keeps its zero: disabling the boost is a
	// legitimate configuration, so only DefaultOptions supplies the default.
	if o.PracticeHalfLife <= 0 {
		o.PracticeHalfLife = def.PracticeHalfLife
	}
	if o.WeakSignalHalfLife <= 0 {
		o.WeakSignalHalfLife = def.WeakSignalHalfLife
	}
	if o.TrendDropPenalty <= 0 {
		o.TrendDropPenalty = def.TrendDropPenalty
	}
	if o.GraduateStreak <= 0 {
		o.GraduateStreak = def.GraduateStreak
	}
	if o.GraduateMinDays <= 0 {
		o.GraduateMinDays = def.GraduateMinDays
	}
	if o.SetSize <= 0 {
		o.SetSize = def.SetSize
	}
	if o.MaxPerKind <= 0 {
		o.MaxPerKind = def.MaxPerKind
	}
	if o.NewGrammarWindow <= 0 {
		o.NewGrammarWindow = def.NewGrammarWindow
	}
	return o
}

// Store is the read side of the Mastery/Focus Set data: the Known Item
// universe plus the signals each item has gathered. The Postgres store joins
// marumori_known_items and known_grammar_points with practice_records,
// weak_signals and the Sync level history.
type Store interface {
	KnownItems(ctx context.Context, userID uuid.UUID) ([]KnownItem, error)
	LevelTrends(ctx context.Context, userID uuid.UUID) ([]LevelTrend, error)
	PracticeResults(ctx context.Context, userID uuid.UUID) ([]PracticeRecord, error)
	WeakSignals(ctx context.Context, userID uuid.UUID) ([]WeakSignalRecord, error)
	// BoostingRefs lists the item keys held by the Learner's Boosting
	// Lists (issue #12). Duplicates are allowed — the Service dedupes by
	// item — and refs may include items that are not (yet) Known Items:
	// those simply never match a scored item.
	BoostingRefs(ctx context.Context, userID uuid.UUID) ([]ItemKey, error)
}

// ScoredItem is one Known Item with its Mastery and rotation state.
type ScoredItem struct {
	Item                 KnownItem
	Mastery              float64
	Graduated            bool // past the correct-run threshold: out of the Focus Set
	NewlyObservedGrammar bool // Observed Grammar inside the pinning window
}

// Key exposes the item's ItemKey.
func (s ScoredItem) Key() ItemKey { return s.Item.Key }

// FocusSet is the current rotating set, in the order Practice should use:
// pinned Observed Grammar first, then ascending Mastery.
type FocusSet struct {
	Size  int // the configured capacity (the set may be smaller)
	Items []ScoredItem
}

// Service scores the Learner's Known Items and builds their Focus Set.
type Service struct {
	store Store
	opts  Options
}

func NewService(store Store, opts Options) *Service {
	return &Service{store: store, opts: opts.withDefaults()}
}

// Score loads every Known Item with its signals and scores it. The result is
// sorted by ascending Mastery, then kind and ref, so callers can walk it
// weakest-first.
func (s *Service) Score(ctx context.Context, userID uuid.UUID) ([]ScoredItem, error) {
	items, err := s.store.KnownItems(ctx, userID)
	if err != nil {
		return nil, err
	}
	trends, err := s.store.LevelTrends(ctx, userID)
	if err != nil {
		return nil, err
	}
	practice, err := s.store.PracticeResults(ctx, userID)
	if err != nil {
		return nil, err
	}
	signals, err := s.store.WeakSignals(ctx, userID)
	if err != nil {
		return nil, err
	}

	// LevelTrends join on (kind, marumori_id), not the item ref: the Sync
	// history speaks MaruMori's ids.
	trendByMM := make(map[[2]string]*LevelTrend, len(trends))
	for i := range trends {
		trendByMM[[2]string{string(trends[i].Kind), trends[i].MaruMoriID}] = &trends[i]
	}
	practiceBy := make(map[ItemKey][]PracticeRecord, len(practice))
	for _, p := range practice {
		practiceBy[p.Key] = append(practiceBy[p.Key], p)
	}
	signalsBy := make(map[ItemKey][]WeakSignalRecord, len(signals))
	for _, w := range signals {
		signalsBy[w.Key] = append(signalsBy[w.Key], w)
	}
	// Boosting List membership is a set: one boost per item no matter how
	// many Boosting Lists hold it.
	refs, err := s.store.BoostingRefs(ctx, userID)
	if err != nil {
		return nil, err
	}
	boosted := make(map[ItemKey]bool, len(refs))
	for _, k := range refs {
		boosted[k] = true
	}

	now := s.opts.Now()
	out := make([]ScoredItem, 0, len(items))
	for _, it := range items {
		var trend *LevelTrend
		if it.MaruMoriID != "" {
			trend = trendByMM[[2]string{string(it.Key.Kind), it.MaruMoriID}]
		}
		pr := practiceBy[it.Key]
		sort.SliceStable(pr, func(i, j int) bool { return pr[i].AnsweredAt.Before(pr[j].AnsweredAt) })
		scored := ScoredItem{
			Item:      it,
			Mastery:   s.scoreItem(it, trend, pr, signalsBy[it.Key], boosted[it.Key], now),
			Graduated: graduated(pr, s.opts.GraduateStreak, s.opts.GraduateMinDays),
		}
		scored.NewlyObservedGrammar = newlyObservedGrammar(it, s.opts.NewGrammarWindow, now)
		out = append(out, scored)
	}
	sort.SliceStable(out, func(i, j int) bool { return lessByMastery(out[i], out[j]) })
	return out, nil
}

// FocusSet builds the current rotating set: the lowest-Mastery Known Items,
// minus graduated ones, capped per kind when other kinds are available, with
// pinned Observed Grammar at the front. Backfill is automatic — the next
// weakest candidate simply takes the slot a graduation frees.
func (s *Service) FocusSet(ctx context.Context, userID uuid.UUID) (FocusSet, error) {
	scored, err := s.Score(ctx, userID)
	if err != nil {
		return FocusSet{}, err
	}
	// Rotation order first: pinned Observed Grammar, then ascending Mastery.
	sort.SliceStable(scored, func(i, j int) bool { return lessForSet(scored[i], scored[j]) })

	counts := map[Kind]int{}
	chosen := make([]ScoredItem, 0, s.opts.SetSize)
	skipped := make([]ScoredItem, 0, len(scored))
	for _, it := range scored {
		if it.Graduated {
			continue
		}
		if counts[it.Item.Key.Kind] >= s.opts.MaxPerKind {
			skipped = append(skipped, it) // over the kind cap: backfill candidate
			continue
		}
		counts[it.Item.Key.Kind]++
		chosen = append(chosen, it)
		if len(chosen) == s.opts.SetSize {
			break
		}
	}
	// Too few items under the caps to fill the set: relax the cap for the
	// remaining slots, still weakest-first. A learner who only knows
	// vocabulary still gets a full Focus Set.
	for _, it := range skipped {
		if len(chosen) == s.opts.SetSize {
			break
		}
		chosen = append(chosen, it)
	}
	return FocusSet{Size: s.opts.SetSize, Items: chosen}, nil
}

// scoreItem averages the positive-evidence components (SRS Level, Level
// Trend, Practice Record) over just those with stored evidence, then
// subtracts the Weak Signal penalty — so a Weak Signal can only ever lower
// Mastery, never pull a weak item up. Items with no evidence at all sit at
// NoEvidenceMastery. Boosting List membership then costs BoostingBonus,
// exactly once per item — the deliberate focus nudge of issue #12. The
// result is clamped to 0–1.
func (s *Service) scoreItem(it KnownItem, trend *LevelTrend, practice []PracticeRecord, signals []WeakSignalRecord, boosted bool, now time.Time) float64 {
	var num, den float64

	if it.SRSLevel != nil {
		num += s.opts.Weights.SRS * float64(*it.SRSLevel) / float64(MaxSRSLevel)
		den += s.opts.Weights.SRS
	}
	if trend != nil {
		// Level rises or holds: a clean trend. Each level of drop costs
		// TrendDropPenalty of the component — a drop is a strong weak sign.
		score := 1.0
		if drop := -trend.Delta; drop > 0 {
			score = clamp01(1.0 - float64(drop)*s.opts.TrendDropPenalty)
		}
		num += s.opts.Weights.Trend * score
		den += s.opts.Weights.Trend
	}
	if len(practice) > 0 {
		var acc, wsum float64
		for _, p := range practice {
			w := decay(now.Sub(p.AnsweredAt), s.opts.PracticeHalfLife)
			if p.Correct {
				acc += w
			}
			wsum += w
		}
		if wsum > 0 {
			num += s.opts.Weights.Practice * (acc / wsum)
			den += s.opts.Weights.Practice
		}
	}

	base := NoEvidenceMastery
	if den > 0 {
		base = num / den
	}
	var penalty float64
	for _, w := range signals {
		// Weights.WeakSignals is the cost of one fresh signal; it halves
		// every WeakSignalHalfLife.
		penalty += s.opts.Weights.WeakSignals * decay(now.Sub(w.OccurredAt), s.opts.WeakSignalHalfLife)
	}
	if boosted {
		// One membership's worth of boost, deduped by the caller's set.
		penalty += s.opts.BoostingBonus
	}
	return clamp01(base - penalty)
}

// graduated reports whether the tail of an item's Practice Record passes the
// rotation threshold: GraduateStreak correct answers in a row, spanning at
// least GraduateMinDays different UTC days. An incorrect answer ends the run.
func graduated(practice []PracticeRecord, streakNeed, daysNeed int) bool {
	if len(practice) < streakNeed {
		return false
	}
	streak := 0
	days := map[string]bool{}
	for i := len(practice) - 1; i >= 0 && practice[i].Correct; i-- {
		streak++
		days[practice[i].AnsweredAt.UTC().Format("2006-01-02")] = true
	}
	return streak >= streakNeed && len(days) >= daysNeed
}

// newlyObservedGrammar pins Observed Grammar the Learner only recently came
// across (docs/adr/0003). A missing ObservedAt counts as new: the Postgres
// store always fills one for observed items, and defaulting to "new" errs
// toward targeting the item straight away.
func newlyObservedGrammar(it KnownItem, window time.Duration, now time.Time) bool {
	if it.Source != SourceObserved {
		return false
	}
	if it.ObservedAt == nil {
		return true
	}
	age := now.Sub(*it.ObservedAt)
	return age <= window
}

func lessByMastery(a, b ScoredItem) bool {
	if a.Mastery != b.Mastery {
		return a.Mastery < b.Mastery
	}
	return lessRef(a.Item.Key, b.Item.Key)
}

// lessForSet orders the Focus Set candidate list: pinned Observed Grammar
// first (between themselves by Mastery), then the rest by Mastery.
func lessForSet(a, b ScoredItem) bool {
	if a.NewlyObservedGrammar != b.NewlyObservedGrammar {
		return a.NewlyObservedGrammar
	}
	if a.Mastery != b.Mastery {
		return a.Mastery < b.Mastery
	}
	return lessRef(a.Item.Key, b.Item.Key)
}

func lessRef(a, b ItemKey) bool {
	if a.Kind != b.Kind {
		return a.Kind < b.Kind
	}
	return a.Ref < b.Ref
}

// decay is the exponential recency weight: 1 when age is 0, 1/2 at halfLife.
func decay(age, halfLife time.Duration) float64 {
	if age <= 0 {
		return 1
	}
	return math.Pow(0.5, float64(age)/float64(halfLife))
}

func clamp01(v float64) float64 { return min(max(v, 0), 1) }
