package grammar_test

import (
	"context"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
)

// The database enforces the span basics the Validator promises: a non-negative
// start strictly before the end.
func TestPostgresExampleSpanBoundsAreEnforced(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	var id int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
		                            variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 1, 1, '～です', 'desu', 'is', ARRAY['～です'], 'です', ARRAY['です'])
		RETURNING id`).Scan(&id); err != nil {
		t.Fatalf("seed: %v", err)
	}

	cases := []struct {
		name       string
		start, end int
	}{
		{"start negative", -1, 2},
		{"end equals start", 2, 2},
		{"end before start", 3, 1},
	}
	for _, c := range cases {
		_, err := pool.Exec(ctx, `
			INSERT INTO grammar_examples (grammar_point_id, sentence_ja, translation_en, span_start, span_end, span_text)
			VALUES ($1, 'みずをのみました', 'I drank water.', $2, $3, 'み')`, id, c.start, c.end)
		if err == nil {
			t.Errorf("%s: insert unexpectedly succeeded", c.name)
		}
	}
}

// The same store answers Dictionary lookups against the JMdict tables.
func TestPostgresDictionaryKnowsFormsAndReadings(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	seed := []struct {
		ent   int64
		kanji []string
		reads []string
	}{
		{9001, []string{"水"}, []string{"みず"}},
		{9002, nil, []string{"ごはん"}}, // kana-only word: reading only
	}
	for _, s := range seed {
		if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES ($1, true)`, s.ent); err != nil {
			t.Fatalf("seed entry: %v", err)
		}
		for i, k := range s.kanji {
			if _, err := pool.Exec(ctx, `INSERT INTO jmdict_kanji_forms (ent_seq, ord, text) VALUES ($1, $2, $3)`, s.ent, i+1, k); err != nil {
				t.Fatalf("seed kanji: %v", err)
			}
		}
		for i, r := range s.reads {
			if _, err := pool.Exec(ctx, `INSERT INTO jmdict_readings (ent_seq, ord, text) VALUES ($1, $2, $3)`, s.ent, i+1, r); err != nil {
				t.Fatalf("seed reading: %v", err)
			}
		}
	}

	dict := grammar.NewPostgresStore(pool)
	for _, want := range []struct {
		word  string
		known bool
	}{{"水", true}, {"みず", true}, {"ごはん", true}, {"みずを", false}, {"ほげほげ", false}} {
		got, err := dict.Known(ctx, want.word)
		if err != nil {
			t.Fatalf("Known(%q): %v", want.word, err)
		}
		if got != want.known {
			t.Errorf("Known(%q) = %v, want %v", want.word, got, want.known)
		}
	}
}
