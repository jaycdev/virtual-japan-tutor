package story

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// A candidate the gate rejected is still saved for analysis. A model can cite
// a grammar point ID that does not exist (the gate rejects that, too), and the
// span insert then hit story_grammar_spans' foreign key: Save failed, the run
// ended in an internal error, and the Learner never got the normal retry line.
func TestPostgresSaveSkipsSpansCitingUnknownGrammarPoints(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	st := NewPostgresStore(pool)

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, user, user.String()); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	var real int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning, variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 990201, 1, '～ました', 'mashita', 'past tense (polite)', ARRAY['ました'], 'ました990201', ARRAY['ました'])
		RETURNING id`).Scan(&real); err != nil {
		t.Fatalf("seed grammar: %v", err)
	}

	s := &Story{
		UserID: user, Genre: "mystery", Prompt: "p", Text: "ました。",
		Sentences: []Sentence{{
			Pos: 0, JA: "ました。", EN: "past.",
			Tokens: []Token{{Pos: 0, Surface: "ました", Start: 0, End: 3, Tag: TagUnknown}},
			Spans: []Span{
				{Start: 0, End: 3, GrammarPointID: real},
				{Start: 0, End: 3, GrammarPointID: 987654321}, // no such grammar point
			},
		}},
		Questions: []Question{
			{Pos: 0, PromptJA: "q", OptionsJA: []string{"a", "b"}},
			{Pos: 1, PromptJA: "q", OptionsJA: []string{"a", "b"}},
			{Pos: 2, PromptJA: "q", OptionsJA: []string{"a", "b"}},
		},
		Validated: false, Attempts: 3,
	}
	if err := st.Save(ctx, s); err != nil {
		t.Fatalf("a rejected candidate citing an unknown grammar point must still save: %v", err)
	}
	var n int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM story_grammar_spans WHERE story_id = $1`, s.ID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("stored %d spans, want only the one citing a real grammar point", n)
	}
}
