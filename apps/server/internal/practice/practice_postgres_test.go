package practice_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
)

// Postgres-side proof of the Stretch Item read (issue #12): Boosting List
// members that are not yet Known Items, oldest membership first, capped —
// with "known" meaning exactly what mastery's read model means.

func TestPostgresContentStretchItems(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'stretch', 'x')`, user); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES (1000, true), (2000, true)`); err != nil {
		t.Fatalf("seed jmdict entries: %v", err)
	}
	// vocabulary 1000 is Known: it must not be a Stretch Item even when it
	// sits in a Boosting List. 2000 and 3000 are unknown.
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, first_synced_at, last_seen_at, jmdict_ent_seq)
		VALUES ($1, 'vocabulary', 'Vocab/1', 2, '2026-01-01', '2026-02-01', 1000)`, user); err != nil {
		t.Fatalf("seed known vocab: %v", err)
	}

	// Two Boosting Lists (one item shared) and one quiet list.
	var boostA, boostB, quiet uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO item_lists (id, user_id, name, boosting) VALUES (gen_random_uuid(), $1, 'Shaky', true) RETURNING id`, user).Scan(&boostA); err != nil {
		t.Fatalf("seed boost list A: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO item_lists (id, user_id, name, boosting) VALUES (gen_random_uuid(), $1, 'Verbs too', true) RETURNING id`, user).Scan(&boostB); err != nil {
		t.Fatalf("seed boost list B: %v", err)
	}
	if err := pool.QueryRow(ctx, `INSERT INTO item_lists (id, user_id, name, boosting) VALUES (gen_random_uuid(), $1, 'Notes', false) RETURNING id`, user).Scan(&quiet); err != nil {
		t.Fatalf("seed quiet list: %v", err)
	}

	add := func(list uuid.UUID, kind, ref string, at string) {
		if _, err := pool.Exec(ctx,
			`INSERT INTO item_list_items (list_id, item_kind, item_ref, added_at) VALUES ($1, $2, $3, $4)`,
			list, kind, ref, at); err != nil {
			t.Fatalf("add %s %s: %v", kind, ref, err)
		}
	}
	add(boostA, "vocabulary", "2000", "2026-03-01")
	add(boostA, "vocabulary", "1000", "2026-03-02") // Known: excluded
	add(boostA, "kanji", "食", "2026-03-04")
	add(boostB, "vocabulary", "2000", "2026-03-03") // duplicate membership
	add(boostB, "vocabulary", "3000", "2026-03-05")
	add(quiet, "kanji", "飲", "2026-03-06") // not boosting: excluded

	content := practice.NewPostgresContent(pool)

	got, err := content.StretchItems(ctx, user, 10)
	if err != nil {
		t.Fatalf("StretchItems: %v", err)
	}
	// Deduped across lists, oldest membership first, unknown only.
	want := []mastery.ItemKey{
		{Kind: mastery.KindVocabulary, Ref: "2000"},
		{Kind: mastery.KindKanji, Ref: "食"},
		{Kind: mastery.KindVocabulary, Ref: "3000"},
	}
	if len(got) != len(want) {
		t.Fatalf("StretchItems = %+v, want %+v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("stretch[%d] = %+v, want %+v (deduped, added_at order)", i, got[i], want[i])
		}
	}

	// The limit is honoured: the oldest memberships only.
	limited, err := content.StretchItems(ctx, user, 2)
	if err != nil {
		t.Fatalf("StretchItems limit: %v", err)
	}
	if len(limited) != 2 || limited[0] != want[0] || limited[1] != want[1] {
		t.Errorf("limited = %+v, want the first two of %+v", limited, want)
	}

	// Another user's lists do not leak.
	other := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'other', 'x')`, other); err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	mine, err := content.StretchItems(ctx, other, 10)
	if err != nil {
		t.Fatalf("StretchItems(other): %v", err)
	}
	if len(mine) != 0 {
		t.Errorf("other user stretch = %+v, want none", mine)
	}
}

// Known grammar members of Boosting Lists are excluded through the same
// predicate mastery uses (point id as text).
func TestPostgresStretchItemsExcludesKnownAndCaps(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'gram', 'x')`, user); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	var pointID int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
			variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 1, 1, 'だけ', '', 'only', ARRAY[]::text[], 'だけ', ARRAY[]::text[]) RETURNING id`).Scan(&pointID); err != nil {
		t.Fatalf("seed grammar point: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO known_grammar_points (user_id, grammar_point_id, source, mastery) VALUES ($1, $2, 'seeded', 'medium')`,
		user, pointID); err != nil {
		t.Fatalf("seed known grammar: %v", err)
	}

	var boost uuid.UUID
	if err := pool.QueryRow(ctx, `INSERT INTO item_lists (id, user_id, name, boosting) VALUES (gen_random_uuid(), $1, 'Grammar shaky', true) RETURNING id`, user).Scan(&boost); err != nil {
		t.Fatalf("seed boost list: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO item_list_items (list_id, item_kind, item_ref) VALUES ($1, 'grammar', $2)`,
		boost, itoa(pointID)); err != nil {
		t.Fatalf("add known grammar to list: %v", err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO item_list_items (list_id, item_kind, item_ref) VALUES ($1, 'grammar', '999')`,
		boost); err != nil {
		t.Fatalf("add unknown grammar to list: %v", err)
	}

	content := practice.NewPostgresContent(pool)
	got, err := content.StretchItems(ctx, user, 10)
	if err != nil {
		t.Fatalf("StretchItems: %v", err)
	}
	want := []mastery.ItemKey{{Kind: mastery.KindGrammar, Ref: "999"}}
	if len(got) != 1 || got[0] != want[0] {
		t.Errorf("StretchItems = %+v, want %+v (known point excluded)", got, want)
	}
}
