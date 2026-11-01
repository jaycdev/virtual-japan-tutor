package mastery_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
)

// Postgres-backed tests for the read model: they pin the SQL semantics the
// scoring depends on — ref selection (link first, MaruMori id otherwise),
// disappeared-item exclusion, the observation joins for grammar, and the
// newest-level-change-per-item trend rule.

func TestPostgresStore(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	store := mastery.NewPostgresStore(pool)

	user, other := uuid.New(), uuid.New()
	seedUser := func(id uuid.UUID, name string) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, id, name); err != nil {
			t.Fatalf("seed user %s: %v", name, err)
		}
	}
	seedUser(user, "mine")
	seedUser(other, "theirs")

	var dakeID, teShimauID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
		                            variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 1, 1, 'だけ', '', 'only', ARRAY[]::text[], 'だけ', ARRAY[]::text[]) RETURNING id`).Scan(&dakeID); err != nil {
		t.Fatalf("seed grammar point: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
		                            variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 2, 2, 'てしまう', '', 'finish up', ARRAY[]::text[], 'てしまう', ARRAY[]::text[]) RETURNING id`).Scan(&teShimauID); err != nil {
		t.Fatalf("seed grammar point: %v", err)
	}

	// A Sync run and its history for the trend joins.
	var runID uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO marumori_sync_runs (user_id, status, started_at, finished_at)
		VALUES ($1, 'ok', '2026-02-01', '2026-02-01') RETURNING id`, user).Scan(&runID); err != nil {
		t.Fatalf("seed sync run: %v", err)
	}
	insertKnown := func(u uuid.UUID, kind, mmID string, level int, text *string, disappeared bool) {
		t.Helper()
		if disappeared {
			if _, err := pool.Exec(ctx, `
				INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, text, first_synced_at, last_seen_at, disappeared_at)
				VALUES ($1, $2, $3, $4, $5, '2026-01-01', '2026-02-01', now())`, u, kind, mmID, level, text); err != nil {
				t.Fatalf("seed disappeared item: %v", err)
			}
			return
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, text, first_synced_at, last_seen_at)
			VALUES ($1, $2, $3, $4, $5, '2026-01-01', '2026-02-01')`, u, kind, mmID, level, text); err != nil {
			t.Fatalf("seed known item: %v", err)
		}
	}
	// Unlinked items are addressed by their MaruMori id (no reference-data link).
	insertKnown(user, "vocabulary", "VocabularyForms/31288892", 3, strptr("猫"), false)
	insertKnown(user, "kanji", "Kanji/3964299", 5, strptr("食"), false)
	insertKnown(user, "vocabulary", "VocabularyForms/gone", 2, strptr("消える"), true)
	insertKnown(other, "vocabulary", "VocabularyForms/theirs", 1, strptr("他人"), false)

	// The same MaruMori id learned by another user, with a big level drop of
	// its own: if the trend query ever dropped its user filter, that delta
	// would contaminate this user's trend.
	var otherRun uuid.UUID
	if err := pool.QueryRow(ctx, `
		INSERT INTO marumori_sync_runs (user_id, status, started_at, finished_at)
		VALUES ($1, 'ok', '2026-02-02', '2026-02-02') RETURNING id`, other).Scan(&otherRun); err != nil {
		t.Fatalf("seed other sync run: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_known_item_history (user_id, sync_run_id, kind, marumori_id, change, old_level, new_level)
		VALUES ($1, $2, 'vocabulary', 'VocabularyForms/31288892', 'level_changed', 9, 1)`, other, otherRun); err != nil {
		t.Fatalf("seed other history: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_known_item_history (user_id, sync_run_id, kind, marumori_id, change, old_level, new_level)
		VALUES
			($1, $2, 'vocabulary', 'VocabularyForms/31288892', 'appeared', NULL, 4),
			($1, $2, 'vocabulary', 'VocabularyForms/31288892', 'level_changed', 4, 2),
			($1, $2, 'vocabulary', 'VocabularyForms/31288892', 'level_changed', 2, 3),
			($1, $2, 'kanji', 'Kanji/3964299', 'level_changed', 7, 5)`,
		user, runID); err != nil {
		t.Fatalf("seed history: %v", err)
	}

	// Grammar: だけ is Observed via a matched MaruMori observation (two, with
	// levels and dates); てしまう is Seeded with no observations.
	if _, err := pool.Exec(ctx, `
		INSERT INTO known_grammar_points (user_id, grammar_point_id, source, mastery)
		VALUES ($1, $2, 'observed', 'low'), ($1, $3, 'seeded', 'medium')`, user, dakeID, teShimauID); err != nil {
		t.Fatalf("seed known grammar: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_grammar_observations (user_id, marumori_id, srs_level, suspended, first_seen_at, last_seen_at)
		VALUES ($1, 'Grammar/1', 3, false, '2026-01-15', '2026-02-01'),
		       ($1, 'Grammar/2', 6, false, '2026-01-15', '2026-02-01')`, user); err != nil {
		t.Fatalf("seed grammar observations: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO known_grammar_observations (user_id, marumori_id, pattern, matched_point, observed_at)
		VALUES ($1, 'Grammar/1', 'だけ', $2, '2026-02-20'),
		       ($1, 'Grammar/2', 'だけ', $2, '2026-01-10'),
		       ($1, 'Grammar/3', '未匹配', NULL, '2026-02-01')`, user, dakeID); err != nil {
		t.Fatalf("seed matched observations: %v", err)
	}

	// Practice Record and Weak Signals for the vocabulary item.
	vocabKey := mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "VocabularyForms/31288892"}
	if _, err := pool.Exec(ctx, `
		INSERT INTO practice_records (user_id, item_kind, item_ref, correct, answered_at)
		VALUES ($1, 'vocabulary', 'VocabularyForms/31288892', false, '2026-02-10'),
		       ($1, 'vocabulary', 'VocabularyForms/31288892', true, '2026-02-15'),
		       ($1, 'kanji', 'Kanji/3964299', true, '2026-02-12')`, user); err != nil {
		t.Fatalf("seed practice: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO practice_records (user_id, item_kind, item_ref, correct, answered_at)
		VALUES ($1, 'vocabulary', 'VocabularyForms/theirs', true, '2026-02-13')`, other); err != nil {
		t.Fatalf("seed other practice: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO weak_signals (user_id, item_kind, item_ref, signal, occurred_at)
		VALUES ($1, 'vocabulary', 'VocabularyForms/31288892', 'lookup', '2026-02-11'),
		       ($1, 'vocabulary', 'VocabularyForms/31288892', 'translation_unblur', '2026-02-14')`, user); err != nil {
		t.Fatalf("seed signals: %v", err)
	}

	items, err := store.KnownItems(ctx, user)
	if err != nil {
		t.Fatalf("KnownItems: %v", err)
	}
	want := []struct {
		key      mastery.ItemKey
		source   mastery.Source
		level    *int
		observed *time.Time
	}{
		{mastery.ItemKey{Kind: mastery.KindKanji, Ref: "Kanji/3964299"}, mastery.SourceMaruMori, iptr(5), nil},
		{vocabKey, mastery.SourceMaruMori, iptr(3), nil},
		// Grammar comes back by point id: だけ (observed, id 1) before てしまう (seeded, id 2).
		{mastery.ItemKey{Kind: mastery.KindGrammar, Ref: itoa64(dakeID)}, mastery.SourceObserved, iptr(6),
			tptr(time.Date(2026, 1, 10, 0, 0, 0, 0, time.UTC))},
		{mastery.ItemKey{Kind: mastery.KindGrammar, Ref: itoa64(teShimauID)}, mastery.SourceSeeded, nil, nil},
	}
	if len(items) != len(want) {
		t.Fatalf("KnownItems = %d rows (%+v), want %d", len(items), items, len(want))
	}
	for i, w := range want {
		got := items[i]
		if got.Key != w.key || got.Source != w.source {
			t.Errorf("item %d = %+v, want %+v", i, got, w)
			continue
		}
		if (w.level == nil) != (got.SRSLevel == nil) {
			t.Errorf("item %d SRSLevel = %v, want %v", i, got.SRSLevel, w.level)
		} else if w.level != nil && *got.SRSLevel != *w.level {
			t.Errorf("item %d SRSLevel = %d, want %d", i, *got.SRSLevel, *w.level)
		}
		if (w.observed == nil) != (got.ObservedAt == nil) {
			t.Errorf("item %d ObservedAt = %v, want %v", i, got.ObservedAt, w.observed)
		} else if w.observed != nil && !got.ObservedAt.Equal(*w.observed) {
			t.Errorf("item %d ObservedAt = %v, want %v (first matched observation)", i, got.ObservedAt, *w.observed)
		}
	}

	trends, err := store.LevelTrends(ctx, user)
	if err != nil {
		t.Fatalf("LevelTrends: %v", err)
	}
	// One trend per item, from the newest level_changed (2→3 is +1, not the
	// earlier 4→2); 'appeared' rows carry no delta; other users excluded.
	if len(trends) != 2 {
		t.Fatalf("trends = %+v, want 2", trends)
	}
	byMM := map[string]int{}
	for _, tr := range trends {
		byMM[tr.MaruMoriID] = tr.Delta
	}
	if byMM["VocabularyForms/31288892"] != 1 || byMM["Kanji/3964299"] != -2 {
		t.Errorf("deltas = %v, want vocab +1 (newest change) and kanji -2", byMM)
	}

	practice, err := store.PracticeResults(ctx, user)
	if err != nil {
		t.Fatalf("PracticeResults: %v", err)
	}
	if len(practice) != 3 {
		t.Fatalf("practice = %+v, want the user's 3 rows (not another user's)", practice)
	}
	if !practice[0].AnsweredAt.Before(practice[1].AnsweredAt) || !practice[1].AnsweredAt.Before(practice[2].AnsweredAt) {
		t.Errorf("practice not oldest-first: %v", practice)
	}
	if practice[0].Correct || !practice[1].Correct || practice[0].Key != vocabKey {
		t.Errorf("practice[0] = %+v, want the first wrong vocab answer", practice[0])
	}

	signals, err := store.WeakSignals(ctx, user)
	if err != nil {
		t.Fatalf("WeakSignals: %v", err)
	}
	if len(signals) != 2 || signals[0].Signal != "lookup" || signals[1].Signal != "translation_unblur" {
		t.Fatalf("signals = %+v, want lookup then translation_unblur, oldest first", signals)
	}
	if signals[0].Key != vocabKey {
		t.Errorf("signal key = %+v, want %v", signals[0].Key, vocabKey)
	}
}

func strptr(s string) *string { return &s }
func itoa64(v int64) string   { return strconv.FormatInt(v, 10) }

// Two MaruMori vocabulary forms (the kana and kanji spellings of one word)
// can link to the same JMdict entry: they share an ItemKey, and therefore one
// Practice Record. The store collapses them into a single Known Item, keeping
// the weakest form's SRS Level and that form's MaruMori id for the Level
// Trend join.
func TestPostgresStoreCollapsesVocabFormsSharingAnEntSeq(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	store := mastery.NewPostgresStore(pool)

	u := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'forms', 'x')`, u); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	// Vocabulary links go through jmdict_entries (FK), and the table's CHECK
	// says a linked form carries no raw MaruMori text.
	if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES (2023190, true)`); err != nil {
		t.Fatalf("seed jmdict entry: %v", err)
	}
	form := func(mmID string, level int) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, first_synced_at, last_seen_at, jmdict_ent_seq)
			VALUES ($1, 'vocabulary', $2, $3, '2026-01-01', '2026-02-01', 2023190)`, u, mmID, level); err != nil {
			t.Fatalf("seed form %s: %v", mmID, err)
		}
	}
	form("VocabularyForms/kana", 7)
	form("VocabularyForms/kanji", 3)

	items, err := store.KnownItems(ctx, u)
	if err != nil {
		t.Fatalf("KnownItems: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("items = %+v, want the two forms collapsed to one", items)
	}
	it := items[0]
	if want := (mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "2023190"}); it.Key != want {
		t.Errorf("key = %v, want the shared ent_seq %v", it.Key, want)
	}
	if it.SRSLevel == nil || *it.SRSLevel != 3 {
		t.Errorf("SRSLevel = %v, want the weakest form's level 3", it.SRSLevel)
	}
	if it.MaruMoriID != "VocabularyForms/kanji" {
		t.Errorf("MaruMoriID = %q, want the kept form's, so the Level Trend follows it", it.MaruMoriID)
	}
}

// knowngrammar writes known_grammar_points.source and mastery decodes it; both
// packages name those strings with their own constants. This test writes what
// knowngrammar writes today and asserts mastery reads it back: if either
// constant drifts, grammar items would silently lose their source, and this
// test fails first.
func TestPostgresStoreGrammarSourceNamesMatchTheWriter(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	store := mastery.NewPostgresStore(pool)

	u := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'names', 'x')`, u); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	var seededPt, observedPt int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
		                            variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 41, 41, 'だ', '', 'copula', ARRAY[]::text[], 'だ', ARRAY[]::text[]) RETURNING id`).Scan(&seededPt); err != nil {
		t.Fatalf("seed grammar point: %v", err)
	}
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
		                            variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 42, 42, 'です', '', 'polite copula', ARRAY[]::text[], 'です', ARRAY[]::text[]) RETURNING id`).Scan(&observedPt); err != nil {
		t.Fatalf("seed grammar point: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO known_grammar_points (user_id, grammar_point_id, source, mastery)
		VALUES ($1, $2, $3, 'medium'), ($1, $4, $5, 'low')`,
		u, seededPt, string(knowngrammar.SourceSeeded), observedPt, string(knowngrammar.SourceObserved)); err != nil {
		t.Fatalf("seed known grammar: %v", err)
	}

	items, err := store.KnownItems(ctx, u)
	if err != nil {
		t.Fatalf("KnownItems: %v", err)
	}
	want := map[string]mastery.Source{
		itoa64(seededPt):   mastery.SourceSeeded,
		itoa64(observedPt): mastery.SourceObserved,
	}
	if len(items) != len(want) {
		t.Fatalf("items = %+v, want %d", items, len(want))
	}
	for _, it := range items {
		if it.Source != want[it.Key.Ref] {
			t.Errorf("point %s: knowngrammar wrote %q, mastery read %q, want %q",
				it.Key.Ref, want[it.Key.Ref], it.Source, want[it.Key.Ref])
		}
	}
}
