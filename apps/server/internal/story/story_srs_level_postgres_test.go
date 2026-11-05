package story

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// A Grammar Point's current SRS Level is read on load (not stored): the highest
// level among the MaruMori grammar items matched to it, nil when none has one.
// It applies to both a Grammar Span and a particle's hint.
func TestPostgresStoryLoadsCurrentGrammarSRSLevel(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	st := NewPostgresStore(pool)

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, user, user.String()); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	point := func(level string, number int, pattern string) int64 {
		t.Helper()
		var id int64
		if err := pool.QueryRow(ctx, `
			INSERT INTO grammar_points (jlpt_level, catalogue_number, pattern, romaji, meaning, variants, normalised_pattern, normalised_variants)
			VALUES ($1, $2, $3, 'x', 'm', ARRAY[$3], $3, ARRAY[$3]) RETURNING id`, level, number, pattern).Scan(&id); err != nil {
			t.Fatalf("seed point %q: %v", pattern, err)
		}
		return id
	}
	// は (particle, hinted) has two matched MaruMori items at levels 3 and 6: 6 wins.
	wa := point("N5", 990301, "は")
	// について (span) has one matched item with no level yet and one at 4: 4 wins.
	nitsuite := point("N4", 990302, "について")
	// あまり has only a lesson-only item (no level): nil.
	amari := point("N3", 990303, "あまり")

	observe := func(marumoriID string, matched int64, level *int) {
		t.Helper()
		if _, err := pool.Exec(ctx, `
			INSERT INTO known_grammar_observations (user_id, marumori_id, pattern, matched_point)
			VALUES ($1, $2, 'p', $3)`, user, marumoriID, matched); err != nil {
			t.Fatalf("seed observation %s: %v", marumoriID, err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO marumori_grammar_observations (user_id, marumori_id, srs_level, suspended, first_seen_at, last_seen_at)
			VALUES ($1, $2, $3, NULL, now(), now())`, user, marumoriID, level); err != nil {
			t.Fatalf("seed marumori observation %s: %v", marumoriID, err)
		}
	}
	three, six, four := 3, 6, 4
	observe("Grammar/a", wa, &three)
	observe("Grammar/b", wa, &six)
	observe("Grammar/c", nitsuite, nil)
	observe("Grammar/d", nitsuite, &four)
	observe("Grammar/e", amari, nil)

	// Another Learner's level on the same point must never leak in.
	other := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, other, other.String()); err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	nine := 9
	if _, err := pool.Exec(ctx, `
		INSERT INTO known_grammar_observations (user_id, marumori_id, pattern, matched_point)
		VALUES ($1, 'Grammar/x', 'p', $2)`, other, wa); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_grammar_observations (user_id, marumori_id, srs_level, suspended, first_seen_at, last_seen_at)
		VALUES ($1, 'Grammar/x', $2, NULL, now(), now())`, other, nine); err != nil {
		t.Fatal(err)
	}

	const ja = "はについて"
	// The token's stored level is furigana material and must come back unchanged.
	stored := 2
	s := &Story{
		UserID: user, Genre: "srs", Prompt: "p", Text: ja,
		Sentences: []Sentence{{
			Pos: 0, JA: ja, EN: "x",
			Tokens: []Token{{Pos: 0, Surface: "は", Start: 0, End: 1, Tag: TagUnknown, SRSLevel: &stored}},
			Spans:  []Span{{Start: 1, End: 5, GrammarPointID: nitsuite, IsFocus: true}},
		}},
		Questions: []Question{
			{Pos: 0, PromptJA: "q", OptionsJA: []string{"a", "b"}},
			{Pos: 1, PromptJA: "q", OptionsJA: []string{"a", "b"}},
			{Pos: 2, PromptJA: "q", OptionsJA: []string{"a", "b"}},
		},
		Validated: true, Attempts: 1,
	}
	if err := st.Save(ctx, s); err != nil {
		t.Fatalf("save: %v", err)
	}
	got, err := st.Get(ctx, s.ID, user)
	if err != nil {
		t.Fatalf("get: %v", err)
	}

	hint := got.Sentences[0].Tokens[0].Hint
	if hint == nil || hint.GrammarPointID != wa {
		t.Fatalf("は hint = %+v, want point %d", hint, wa)
	}
	if hint.SRSLevel == nil || *hint.SRSLevel != 6 {
		t.Errorf("は hint SRSLevel = %v, want 6 (the highest matched level, not the other Learner's 9)", hint.SRSLevel)
	}
	if tok := got.Sentences[0].Tokens[0]; tok.SRSLevel == nil || *tok.SRSLevel != stored {
		t.Errorf("token SRSLevel = %v, want the stored %d unchanged", tok.SRSLevel, stored)
	}

	spans := got.Sentences[0].Spans
	if len(spans) != 1 || spans[0].GrammarPointID != nitsuite {
		t.Fatalf("spans = %+v, want the について span", spans)
	}
	if spans[0].SRSLevel == nil || *spans[0].SRSLevel != 4 {
		t.Errorf("について span SRSLevel = %v, want 4 (the level-less match is ignored)", spans[0].SRSLevel)
	}

	// A point with only a lesson-only match has no level: nil, not zero. The
	// helper is queried directly because no Story in this test uses that point.
	var level *int
	if err := pool.QueryRow(ctx, `
		SELECT sl.srs_level FROM (SELECT 1) x
		LEFT JOIN LATERAL (`+currentGrammarSRSLevel("$1::uuid", "$2::bigint")+`) sl ON true`,
		user, amari).Scan(&level); err != nil {
		t.Fatal(err)
	}
	if level != nil {
		t.Errorf("lesson-only point level = %d, want nil", *level)
	}
}
