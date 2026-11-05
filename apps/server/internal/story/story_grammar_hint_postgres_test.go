package story

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// The Grammar hint (issue #98) against the real schema: an unlinked token whose
// surface is exactly a catalogue pattern gets the point at its lowest level,
// a particle with no row gets nothing, and a linked token never gets one.
func TestPostgresStoryLoadsGrammarHintForParticles(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	st := NewPostgresStore(pool)

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, user, user.String()); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	// は at N5 and N4 (the N5 row must win), の at N5 only, へ with no row.
	// Catalogue numbers are high so they cannot clash with a seeded catalogue.
	insertPoint := func(level string, number int, pattern, meaning string) int64 {
		t.Helper()
		var id int64
		err := pool.QueryRow(ctx, `
			INSERT INTO grammar_points (jlpt_level, catalogue_number, pattern, romaji, meaning, variants, normalised_pattern, normalised_variants)
			VALUES ($1, $2, $3, 'x', $4, ARRAY[$3], $3, ARRAY[$3])
			RETURNING id`, level, number, pattern, meaning).Scan(&id)
		if err != nil {
			t.Fatalf("seed grammar point %s %q: %v", level, pattern, err)
		}
		return id
	}
	const wa = "は"
	insertPoint("N4", 990102, wa, "wa at N4")
	waN5 := insertPoint("N5", 990101, wa, "topic marker")
	noPat := "の"
	noID := insertPoint("N5", 990103, noPat, "possessive particle")

	var ent int64 = 990199
	if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES ($1, true)`, ent); err != nil {
		t.Fatalf("seed jmdict: %v", err)
	}

	saved := saveStory(t, ctx, st, user, "grammar hint", true)
	var sentence uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM story_sentences WHERE story_id = $1`, saved.ID).Scan(&sentence); err != nil {
		t.Fatal(err)
	}
	insert := func(pos int, surface string, ent *int64) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO story_tokens (id, story_id, sentence_id, position, surface, start, "end", reading, dictionary, ent_seq, tag)
			VALUES ($1,$2,$3,$4,$5,0,1,$5,$5,$6,'unknown')`,
			uuid.New(), saved.ID, sentence, pos, surface, ent); err != nil {
			t.Fatalf("insert token %q: %v", surface, err)
		}
	}
	insert(100, wa, nil)
	insert(101, noPat, nil)
	insert(102, "へ", nil)
	insert(103, wa, &ent) // linked: a dictionary link wins, so no hint

	got, err := st.Get(ctx, saved.ID, user)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	byPos := map[int]Token{}
	for _, s := range got.Sentences {
		for _, tok := range s.Tokens {
			byPos[tok.Pos] = tok
		}
	}

	ha := byPos[100].Hint
	if ha == nil {
		t.Fatal("は got no grammar hint")
	}
	if ha.GrammarPointID != waN5 || ha.JLPTLevel != "N5" || ha.Meaning != "topic marker" {
		t.Errorf("は hint = %+v, want the N5 point %d", *ha, waN5)
	}
	if h := byPos[101].Hint; h == nil || h.GrammarPointID != noID {
		t.Errorf("の hint = %+v, want point %d", h, noID)
	}
	if h := byPos[102].Hint; h != nil {
		t.Errorf("へ (no catalogue row) hint = %+v, want none", *h)
	}
	if h := byPos[103].Hint; h != nil {
		t.Errorf("linked は hint = %+v, want none: a dictionary link is never replaced by a hint", *h)
	}
}
