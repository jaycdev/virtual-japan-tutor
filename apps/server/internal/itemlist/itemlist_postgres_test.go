package itemlist_test

import (
	"context"
	"errors"
	"strconv"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/itemlist"
)

// seedTestUser creates a user row for one store test.
func seedTestUser(t *testing.T, pool *pgxpool.Pool, ctx context.Context, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, id, name); err != nil {
		t.Fatalf("seed user %s: %v", name, err)
	}
	return id
}

// Postgres-backed tests for the Item List store and service: they pin the
// schema semantics the feature depends on — case-insensitive unique names,
// the ON DELETE SET NULL default-list pointer, multi-list membership, and
// the exact weak_signals row shape the mastery read model consumes.

func TestPostgresStoreLists(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	store := itemlist.NewPostgresStore(pool)

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'lists', 'x')`, user); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	// EnsureSaved seeds the built-in lazily, and a second call is a no-op.
	savedID, err := store.EnsureSaved(ctx, user)
	if err != nil {
		t.Fatalf("EnsureSaved: %v", err)
	}
	saved, found, err := store.ByID(ctx, user, savedID)
	if err != nil || !found {
		t.Fatalf("ByID Saved: %v/%v", found, err)
	}
	if saved.Name != itemlist.SavedListName || !saved.Boosting {
		t.Errorf("Saved = %+v, want name %q boosting true", saved, itemlist.SavedListName)
	}
	savedID2, err := store.EnsureSaved(ctx, user)
	if err != nil {
		t.Fatalf("EnsureSaved (again): %v", err)
	}
	if savedID != savedID2 {
		t.Errorf("EnsureSaved twice = %s then %s, want the same row", savedID, savedID2)
	}

	// DefaultID falls back to "unset" before anything is configured; the
	// service resolves that to Saved.
	def, ok, err := store.DefaultID(ctx, user)
	if err != nil {
		t.Fatalf("DefaultID: %v", err)
	}
	if ok || def != uuid.Nil {
		t.Errorf("DefaultID = %s/%v, want unset before configuration", def, ok)
	}

	// A configured default wins.
	travel, err := store.Insert(ctx, user, "travel", true)
	if err != nil {
		t.Fatalf("Insert travel: %v", err)
	}
	if err := store.SetDefaultID(ctx, user, travel); err != nil {
		t.Fatalf("SetDefaultID: %v", err)
	}
	def, ok, err = store.DefaultID(ctx, user)
	if err != nil {
		t.Fatalf("DefaultID after set: %v", err)
	}
	if !ok || def != travel {
		t.Errorf("DefaultID = %s/%v, want travel %s", def, ok, travel)
	}

	// Deleting the defaulted list clears the pointer (ON DELETE SET NULL),
	// so the effective default falls back to Saved again.
	if err := store.Delete(ctx, user, travel); err != nil {
		t.Fatalf("Delete travel: %v", err)
	}
	def, ok, err = store.DefaultID(ctx, user)
	if err != nil {
		t.Fatalf("DefaultID after delete: %v", err)
	}
	if ok || def != uuid.Nil {
		t.Errorf("DefaultID after deleting the default = %s/%v, want unset", def, ok)
	}

	// Names are unique per user ignoring case; another user may collide.
	// ("travel" was deleted above, so seed a fresh name to collide with.)
	if _, err := store.Insert(ctx, user, "food", true); err != nil {
		t.Fatalf("Insert food: %v", err)
	}
	if _, err := store.Insert(ctx, user, "Food", false); !errors.Is(err, itemlist.ErrDuplicateName) {
		t.Errorf("Insert duplicate error = %v, want ErrDuplicateName", err)
	}
	other := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'other', 'x')`, other); err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	if _, err := store.Insert(ctx, other, "food", false); err != nil {
		t.Errorf("other user inserting 'food' = %v, want success (lists are per user)", err)
	}
	// ByName is scoped to the user too.
	if _, found, err := store.ByName(ctx, user, "nope"); err != nil || found {
		t.Errorf("ByName missing = %v/%v, want false/nil", found, err)
	}
	// Lists shows only the user's own rows.
	lists, err := store.Lists(ctx, other)
	if err != nil {
		t.Fatalf("Lists(other): %v", err)
	}
	if len(lists) != 1 || lists[0].Name != "food" {
		t.Errorf("Lists(other) = %+v, want only their own row (no lazy Saved yet)", lists)
	}
}

// The service layers the default-resolution and Saved-protection rules on
// top of the store.
func TestPostgresServiceDefaultResolution(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	svc := itemlist.NewService(itemlist.NewPostgresStore(pool))

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'resolve', 'x')`, user); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	// The first read seeds Saved and reports it as the effective default.
	lists, defID, err := svc.Lists(ctx, user)
	if err != nil {
		t.Fatalf("Lists: %v", err)
	}
	if len(lists) != 1 || lists[0].Name != itemlist.SavedListName || !lists[0].Boosting {
		t.Fatalf("Lists = %+v, want just the Saved list (boosting)", lists)
	}
	if !lists[0].IsDefault {
		t.Errorf("Saved.IsDefault = false, want true as the fallback default")
	}
	savedID := lists[0].ID
	if defID != savedID {
		t.Errorf("defaultListID = %s, want Saved %s", defID, savedID)
	}
	if got, err := svc.DefaultListID(ctx, user); err != nil || got != savedID {
		t.Errorf("DefaultListID = %s/%v, want Saved %s", got, err, savedID)
	}

	// Switching the default moves the flag.
	food, err := svc.Create(ctx, user, "food words", false)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	if err := svc.SetDefault(ctx, user, food.ID); err != nil {
		t.Fatalf("SetDefault: %v", err)
	}
	lists, defID, err = svc.Lists(ctx, user)
	if err != nil {
		t.Fatalf("Lists after SetDefault: %v", err)
	}
	if defID != food.ID {
		t.Errorf("default = %s, want food %s", defID, food.ID)
	}
	for _, l := range lists {
		if l.Name == itemlist.SavedListName && l.IsDefault {
			t.Errorf("Saved still marked default after switching")
		}
		if l.Name == "food words" && !l.IsDefault {
			t.Errorf("food not marked default")
		}
	}

	// Deleting the defaulted list sends the default back to Saved.
	if err := svc.Delete(ctx, user, food.ID); err != nil {
		t.Fatalf("Delete food: %v", err)
	}
	if got, err := svc.DefaultListID(ctx, user); err != nil || got != savedID {
		t.Errorf("DefaultListID after deleting the default = %s/%v, want Saved %s", got, err, savedID)
	}

	// A blank name is rejected; a missing list 404s.
	if _, err := svc.Create(ctx, user, "   ", true); !errors.Is(err, itemlist.ErrInvalidName) {
		t.Errorf("Create blank error = %v, want ErrInvalidName", err)
	}
	if err := svc.SetDefault(ctx, user, uuid.New()); !errors.Is(err, itemlist.ErrListNotFound) {
		t.Errorf("SetDefault missing error = %v, want ErrListNotFound", err)
	}
}

func TestPostgresServiceItemsAndWeakSignals(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	store := itemlist.NewPostgresStore(pool)
	svc := itemlist.NewService(store)

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'items', 'x')`, user); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	// A known vocabulary item (linked to JMdict, so its ItemKey ref is the
	// ent_seq) and a known grammar point (ref is the catalogue row id).
	if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES (2023190, true)`); err != nil {
		t.Fatalf("seed jmdict entry: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, first_synced_at, last_seen_at, jmdict_ent_seq)
		VALUES ($1, 'vocabulary', 'VocabularyForms/31288892', 3, '2026-01-01', '2026-02-01', 2023190)`, user); err != nil {
		t.Fatalf("seed known vocab: %v", err)
	}
	var dakeID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
		                            variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 1, 1, 'だけ', '', 'only', ARRAY[]::text[], 'だけ', ARRAY[]::text[]) RETURNING id`).Scan(&dakeID); err != nil {
		t.Fatalf("seed grammar point: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO known_grammar_points (user_id, grammar_point_id, source, mastery)
		VALUES ($1, $2, 'observed', 'low')`, user, dakeID); err != nil {
		t.Fatalf("seed known grammar: %v", err)
	}

	savedID, err := store.EnsureSaved(ctx, user)
	if err != nil {
		t.Fatalf("EnsureSaved: %v", err)
	}
	studyList, err := svc.Create(ctx, user, "work", true)
	if err != nil {
		t.Fatalf("Create work: %v", err)
	}

	// One item can sit in several lists at once, and re-adding the same
	// membership is an idempotent upsert, not an error or a duplicate row.
	vocab := itemlist.ItemKey{Kind: itemlist.KindVocabulary, Ref: "2023190"}
	if err := svc.AddItem(ctx, user, savedID, vocab); err != nil {
		t.Fatalf("AddItem Saved: %v", err)
	}
	if err := svc.AddItem(ctx, user, studyList.ID, vocab); err != nil {
		t.Fatalf("AddItem work: %v", err)
	}
	if err := svc.AddItem(ctx, user, studyList.ID, vocab); err != nil {
		t.Fatalf("AddItem work (again): %v", err)
	}
	var rows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM item_list_items WHERE list_id = $1`, studyList.ID).Scan(&rows); err != nil {
		t.Fatalf("count items: %v", err)
	}
	if rows != 1 {
		t.Errorf("work list rows = %d, want 1 (re-add is idempotent)", rows)
	}

	// The store answers IsKnownItem with mastery's ref conventions: the
	// ent_seq for linked vocab, the point id for grammar, and false for an
	// unlearned kanji.
	if known, err := store.IsKnownItem(ctx, user, vocab); err != nil || !known {
		t.Errorf("IsKnownItem vocab = %v/%v, want true/nil", known, err)
	}
	if known, err := store.IsKnownItem(ctx, user, itemlist.ItemKey{Kind: itemlist.KindGrammar, Ref: "1"}); err != nil || !known {
		t.Errorf("IsKnownItem grammar = %v/%v, want true/nil", known, err)
	}
	unknown := itemlist.ItemKey{Kind: itemlist.KindKanji, Ref: "食"}
	if known, err := store.IsKnownItem(ctx, user, unknown); err != nil || known {
		t.Errorf("IsKnownItem kanji = %v/%v, want false/nil", known, err)
	}

	// A known item saved into a boosting list leaves exactly one
	// 'boosting_list' Weak Signal, in the exact shape mastery reads.
	type sig struct{ Kind, Ref, Signal string }
	querySignals := func() []sig {
		t.Helper()
		var out []sig
		rrows, err := pool.Query(ctx, `SELECT item_kind, item_ref, signal FROM weak_signals WHERE user_id = $1 ORDER BY item_kind, item_ref, signal`, user)
		if err != nil {
			t.Fatalf("query signals: %v", err)
		}
		defer rrows.Close()
		for rrows.Next() {
			var s sig
			if err := rrows.Scan(&s.Kind, &s.Ref, &s.Signal); err != nil {
				t.Fatalf("scan signal: %v", err)
			}
			out = append(out, s)
		}
		if err := rrows.Err(); err != nil {
			t.Fatalf("signal rows: %v", err)
		}
		return out
	}
	// Re-adding to the same list is a no-op, so the signal does not repeat:
	// exactly the two fresh saves (into Saved, then into work) each left a
	// 'boosting_list' signal, and the two re-adds left nothing. The count
	// is exact — one more means the ON CONFLICT no-op still signalled.
	if err := svc.AddItem(ctx, user, savedID, vocab); err != nil {
		t.Fatalf("AddItem Saved (again): %v", err)
	}
	signals := querySignals()
	var boostingCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM weak_signals WHERE user_id = $1 AND signal = 'boosting_list'`, user).Scan(&boostingCount); err != nil {
		t.Fatalf("count boosting signals: %v", err)
	}
	if boostingCount != 2 {
		t.Errorf("boosting signals = %d, want exactly 2 (one per real insert, none for re-adds): %+v", boostingCount, signals)
	}

	// An unknown item in a boosting list gets no signal: the signal marks
	// "you claimed to know this but it lives in a boosting list".
	if err := svc.AddItem(ctx, user, studyList.ID, unknown); err != nil {
		t.Fatalf("AddItem unknown kanji: %v", err)
	}
	var unknownSignals int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM weak_signals WHERE user_id = $1 AND item_ref = '食'`, user).Scan(&unknownSignals); err != nil {
		t.Fatalf("count unknown signals: %v", err)
	}
	if unknownSignals != 0 {
		t.Errorf("signals for the unknown kanji = %d, want 0", unknownSignals)
	}

	// Reader signals: known items record, unknown items are silently
	// skipped, bad reasons are rejected up front.
	if err := svc.WriteReaderSignals(ctx, user, []itemlist.ReaderSignal{
		{Item: vocab, Reason: itemlist.SignalLookup},
		{Item: unknown, Reason: itemlist.SignalMenuOpen},
		{Item: itemlist.ItemKey{Kind: itemlist.KindGrammar, Ref: "1"}, Reason: itemlist.SignalTranslationUnblur},
	}); err != nil {
		t.Fatalf("WriteReaderSignals: %v", err)
	}
	var lookupCount, unblurCount, menuCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE signal = 'lookup'),
		       count(*) FILTER (WHERE signal = 'translation_unblur'),
		       count(*) FILTER (WHERE signal = 'menu_open')
		FROM weak_signals WHERE user_id = $1`, user).Scan(&lookupCount, &unblurCount, &menuCount); err != nil {
		t.Fatalf("count reader signals: %v", err)
	}
	if lookupCount != 1 || unblurCount != 1 || menuCount != 0 {
		t.Errorf("lookup/unblur/menu = %d/%d/%d, want 1/1/0 (unknown items skipped)", lookupCount, unblurCount, menuCount)
	}
	if err := svc.WriteReaderSignals(ctx, user, []itemlist.ReaderSignal{
		{Item: vocab, Reason: "staring"},
	}); !errors.Is(err, itemlist.ErrInvalidKind) && err == nil {
		t.Errorf("WriteReaderSignals unbounded reason = nil error, want rejection")
	}
	if err := svc.WriteReaderSignals(ctx, user, []itemlist.ReaderSignal{
		{Item: vocab, Reason: itemlist.SignalBoostingList},
	}); err == nil {
		t.Errorf("WriteReaderSignals boosting_list = nil error, want rejection (server-side only)")
	}

	// RemoveItem deletes exactly one membership; other lists are untouched.
	if err := svc.RemoveItem(ctx, user, studyList.ID, vocab); err != nil {
		t.Fatalf("RemoveItem: %v", err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM item_list_items WHERE list_id = $1 AND item_ref = '2023190'`, studyList.ID).Scan(&rows); err != nil {
		t.Fatalf("count after remove: %v", err)
	}
	if rows != 0 {
		t.Errorf("work list still holds %d vocab rows after remove", rows)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM item_list_items WHERE list_id = $1 AND item_ref = '2023190'`, savedID).Scan(&rows); err != nil {
		t.Fatalf("count saved list: %v", err)
	}
	if rows != 1 {
		t.Errorf("Saved list rows = %d, want the membership to remain", rows)
	}
}

// The races this feature has to survive: a list deleted between the
// service's existence check and the write that lands on it. Each store
// answer must be the same not-found the checks give, never a raw FK
// violation (500) or a silent success (200).
func TestPostgresStoreRacesWithDeletedList(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	store := itemlist.NewPostgresStore(pool)
	svc := itemlist.NewService(store)

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'races', 'x')`, user); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	travel, err := store.Insert(ctx, user, "travel", false)
	if err != nil {
		t.Fatalf("Insert travel: %v", err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM item_lists WHERE id = $1`, travel); err != nil {
		t.Fatalf("delete travel: %v", err)
	}

	// Update with no row to change (the concurrent-delete case for PUT):
	// RowsAffected says the row is gone.
	if err := store.Update(ctx, user, travel, "travel", true); !errors.Is(err, itemlist.ErrListNotFound) {
		t.Errorf("Update deleted list = %v, want ErrListNotFound", err)
	}
	// SetDefault racing Delete: users.default_item_list_id -> item_lists
	// rejects the write with an FK violation; that maps to not-found.
	if err := store.SetDefaultID(ctx, user, travel); !errors.Is(err, itemlist.ErrListNotFound) {
		t.Errorf("SetDefaultID deleted list = %v, want ErrListNotFound", err)
	}

	// Create seeds the built-in Saved first, so even a user who has never
	// listed their lists cannot claim the reserved name before the built-in
	// row exists — the name check lands on ErrDuplicateName.
	latecomer := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'latecomer', 'x')`, latecomer); err != nil {
		t.Fatalf("seed latecomer: %v", err)
	}
	if _, err := svc.Create(ctx, latecomer, "Saved", false); !errors.Is(err, itemlist.ErrDuplicateName) {
		t.Errorf(`Create "Saved" on a fresh user = %v, want ErrDuplicateName`, err)
	}
	if _, found, err := store.ByName(ctx, latecomer, "Saved"); err != nil || !found {
		t.Errorf("built-in Saved after the refused create = %v/%v, want the seeded row present", found, err)
	}
}

// The service keeps the Saved name reserved: it cannot be renamed or deleted,
// but its boosting flag is editable like any other list.
func TestPostgresServiceSavedListProtected(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	svc := itemlist.NewService(itemlist.NewPostgresStore(pool))

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'saved', 'x')`, user); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	lists, _, err := svc.Lists(ctx, user)
	if err != nil {
		t.Fatalf("Lists: %v", err)
	}
	savedID := lists[0].ID

	if _, err := svc.Update(ctx, user, savedID, "Keep", true); !errors.Is(err, itemlist.ErrReservedList) {
		t.Errorf("rename Saved error = %v, want ErrReservedList", err)
	}
	if err := svc.Delete(ctx, user, savedID); !errors.Is(err, itemlist.ErrReservedList) {
		t.Errorf("delete Saved error = %v, want ErrReservedList", err)
	}
	updated, err := svc.Update(ctx, user, savedID, "", false)
	if err != nil {
		t.Fatalf("update Saved boosting: %v", err)
	}
	if updated.Boosting {
		t.Errorf("Saved boosting after update = true, want false (the flag is editable)")
	}

	// With boosting off, saving a known item into Saved leaves no signal.
	if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES (5550001, true)`); err != nil {
		t.Fatalf("seed jmdict: %v", err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, first_synced_at, last_seen_at, jmdict_ent_seq)
		VALUES ($1, 'vocabulary', 'VocabularyForms/1', 1, '2026-01-01', '2026-02-01', 5550001)`, user); err != nil {
		t.Fatalf("seed known vocab: %v", err)
	}
	if err := svc.AddItem(ctx, user, savedID, itemlist.ItemKey{Kind: itemlist.KindVocabulary, Ref: "5550001"}); err != nil {
		t.Fatalf("AddItem: %v", err)
	}
	var count int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM weak_signals WHERE user_id = $1`, user).Scan(&count); err != nil {
		t.Fatalf("count signals: %v", err)
	}
	if count != 0 {
		t.Errorf("weak signals = %d, want 0 with the list no longer boosting", count)
	}
}

func TestPostgresStoreListItems(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	store := itemlist.NewPostgresStore(pool)

	user := seedTestUser(t, pool, ctx, "listitems")
	savedID, err := store.EnsureSaved(ctx, user)
	if err != nil {
		t.Fatalf("EnsureSaved: %v", err)
	}

	// Reference rows shared across runs: unique keys make the seeds idempotent.
	seeds := []string{
		`INSERT INTO jmdict_entries (ent_seq, is_common) VALUES (5560001, true), (5560002, true) ON CONFLICT DO NOTHING`,
		`INSERT INTO jmdict_kanji_forms (ent_seq, ord, text) VALUES (5560001, 1, '学校') ON CONFLICT DO NOTHING`,
		`INSERT INTO jmdict_readings (ent_seq, ord, text) VALUES (5560001, 2, 'がっこう'), (5560002, 1, 'ねこ') ON CONFLICT DO NOTHING`,
		`INSERT INTO jmdict_senses (ent_seq, ord, glosses) VALUES
		 (5560001, 1, ARRAY['gakko', 'school']), (5560002, 1, ARRAY['cat']) ON CONFLICT DO NOTHING`,
		`INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning, variants, normalised_pattern, normalised_variants)
		 VALUES ('N5', 556001, 1, '～ました', 'mashita', 'past tense (polite)', ARRAY['ました'], 'ました556001', ARRAY['ました556001'])
		 ON CONFLICT (jlpt_level, normalised_pattern, ordinal) DO NOTHING`,
	}
	for _, q := range seeds {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("seed reference data: %v", err)
		}
	}
	var pastPoint int64
	if err := pool.QueryRow(ctx, `SELECT id FROM grammar_points WHERE normalised_pattern = 'ました556001'`).Scan(&pastPoint); err != nil {
		t.Fatalf("grammar id: %v", err)
	}
	// An UNLINKED Vocabulary Item: the label comes from this user's own row.
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, text, first_synced_at, last_seen_at)
		VALUES ($1, 'vocabulary', '5560', 1, 'ほん', '2026-01-01', '2026-02-01') ON CONFLICT DO NOTHING`, user); err != nil {
		t.Fatalf("seed unlinked vocab: %v", err)
	}

	members := []itemlist.ItemKey{
		{Kind: itemlist.KindGrammar, Ref: strconv.FormatInt(pastPoint, 10)},
		{Kind: itemlist.KindKanji, Ref: "学"},
		{Kind: itemlist.KindVocabulary, Ref: "5560"},    // unlinked: own row's text
		{Kind: itemlist.KindVocabulary, Ref: "5560001"}, // kanji form + first gloss
		{Kind: itemlist.KindVocabulary, Ref: "5560002"}, // kana-only: reading fallback
		{Kind: itemlist.KindVocabulary, Ref: "5569"},    // no reference row at all
	}
	for _, m := range members {
		if _, err := store.AddItem(ctx, user, savedID, m); err != nil {
			t.Fatalf("AddItem %v: %v", m, err)
		}
	}

	got, err := store.ListItems(ctx, user, savedID, 500)
	if err != nil {
		t.Fatalf("ListItems: %v", err)
	}
	// Ordered by kind then ref; labels joined where a row exists.
	want := []itemlist.Member{
		{Kind: "grammar", Ref: strconv.FormatInt(pastPoint, 10), Surface: "～ました", Gloss: "past tense (polite)"},
		{Kind: "kanji", Ref: "学", Surface: "学", Gloss: ""},
		{Kind: "vocabulary", Ref: "5560", Surface: "ほん", Gloss: ""},
		{Kind: "vocabulary", Ref: "5560001", Surface: "学校", Gloss: "gakko"},
		{Kind: "vocabulary", Ref: "5560002", Surface: "ねこ", Gloss: "cat"},
		{Kind: "vocabulary", Ref: "5569", Surface: "5569", Gloss: ""},
	}
	if len(got) != len(want) {
		t.Fatalf("ListItems = %+v, want %d members", got, len(want))
	}
	for i, w := range want {
		if got[i] != w {
			t.Errorf("member %d = %+v, want %+v", i, got[i], w)
		}
	}

	// The cap is exact and keeps the ordering.
	capped, err := store.ListItems(ctx, user, savedID, 2)
	if err != nil {
		t.Fatalf("ListItems capped: %v", err)
	}
	if len(capped) != 2 || capped[0].Kind != "grammar" || capped[1].Ref != want[1].Ref {
		t.Errorf("capped read = %+v, want the first two in order", capped)
	}

	// Another user sees nothing in this list (the service 404s first, but the
	// store's own scoping must not leak labels either).
	other := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'listitems-b', 'x')`, other); err != nil {
		t.Fatalf("seed user b: %v", err)
	}
	mine, err := store.ListItems(ctx, other, savedID, 500)
	if err != nil {
		t.Fatalf("ListItems foreign: %v", err)
	}
	if len(mine) != 0 {
		t.Errorf("foreign read returned %d members, want 0", len(mine))
	}
}
