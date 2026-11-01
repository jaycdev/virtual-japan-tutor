package grammar_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar/grammartest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// The seeded catalogue. Kept deliberately small; every assertion is written
// against these rows. IDs are used verbatim by the memory store and returned
// (in the same order) by the Postgres seeding.
var seedPoints = []refdata.GrammarPoint{
	{ID: 2, Level: refdata.N5, Number: 20, Ordinal: 1, Pattern: "～ないでください", Romaji: "nai de kudasai", Meaning: "please don't do (please not)"},
	{ID: 1, Level: refdata.N5, Number: 12, Ordinal: 1, Pattern: "～てください", Romaji: "te kudasai", Meaning: "please do (please)"},
	{ID: 4, Level: refdata.N4, Number: 5, Ordinal: 1, Pattern: "～てしまう", Romaji: "te shimau", Meaning: "end up doing; accidentally do"},
	{ID: 3, Level: refdata.N5, Number: 1, Ordinal: 1, Pattern: "～は～です", Romaji: "wa ... desu", Meaning: "X is Y"},
}

func seedPoint(i int) refdata.GrammarPoint {
	p := seedPoints[i]
	p.Variants = refdata.SplitVariants(p.Pattern)
	p.NormalisedPattern = refdata.NormalisePattern(p.Pattern)
	p.NormalisedVariants = make([]string, len(p.Variants))
	for j, v := range p.Variants {
		p.NormalisedVariants[j] = refdata.NormalisePattern(v)
	}
	return p
}

// seedIDs maps seedPoint(i).ID positions to the ids the store actually serves.
type harness struct {
	store grammar.Store
	ids   []int64 // in seedPoints order
}

func goodCandidate() grammar.Candidate {
	// みずをのみました — "drink" (のみ) marked at runes [3,5).
	return grammar.Candidate{
		SentenceJA:  "みずをのみました",
		Translation: "I drank water.",
		SpanStart:   3,
		SpanEnd:     5,
		SpanText:    "のみ",
	}
}

func TestMemStoreContractSatisfiesTheContract(t *testing.T) {
	var ids []int64
	for i := range seedPoints {
		ids = append(ids, seedPoints[i].ID)
	}
	testStoreContract(t, harness{
		store: grammartest.NewMemStore(seedPoint(0), seedPoint(1), seedPoint(2), seedPoint(3)),
		ids:   ids,
	})
}

func TestPostgresStoreContractSatisfiesTheContract(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	var ids []int64
	for i := range seedPoints {
		p := seedPoint(i)
		var id int64
		err := pool.QueryRow(ctx, `
			INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
			                            variants, normalised_pattern, normalised_variants)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
			string(p.Level), p.Number, p.Ordinal, p.Pattern, p.Romaji, p.Meaning,
			p.Variants, p.NormalisedPattern, p.NormalisedVariants).Scan(&id)
		if err != nil {
			t.Fatalf("seed grammar point: %v", err)
		}
		ids = append(ids, id)
	}
	testStoreContract(t, harness{store: grammar.NewPostgresStore(pool), ids: ids})
}

func testStoreContract(t *testing.T, h harness) {
	t.Helper()
	ctx := context.Background()
	p1, p2, p3, p4 := h.ids[1], h.ids[0], h.ids[3], h.ids[2] // seed order → p1=てください, p2=ないで, p3=は です, p4=てしまう

	t.Run("Point returns the catalogue entry", func(t *testing.T) {
		got, err := h.store.Point(ctx, p1)
		if err != nil {
			t.Fatalf("Point: %v", err)
		}
		if got.Pattern != "～てください" || got.Level != refdata.N5 || got.Number != 12 {
			t.Errorf("got %+v", got)
		}
		if len(got.NormalisedVariants) == 0 || got.NormalisedVariants[0] != "てください" {
			t.Errorf("normalised variants = %v", got.NormalisedVariants)
		}
	})

	t.Run("Point on an unknown id is ErrPointNotFound", func(t *testing.T) {
		if _, err := h.store.Point(ctx, 999999); !errors.Is(err, grammar.ErrPointNotFound) {
			t.Fatalf("err = %v, want ErrPointNotFound", err)
		}
	})

	t.Run("Points returns catalogue order and the total", func(t *testing.T) {
		got, total, err := h.store.Points(ctx, grammar.Filter{Limit: 10})
		if err != nil {
			t.Fatalf("Points: %v", err)
		}
		if total != 4 {
			t.Fatalf("total = %d, want 4", total)
		}
		want := []int64{p3, p1, p2, p4} // N5#1, N5#12, N5#20, N4#5
		if len(got) != 4 || got[0].ID != want[0] || got[1].ID != want[1] || got[2].ID != want[2] || got[3].ID != want[3] {
			t.Fatalf("order = %+v", got)
		}
	})

	t.Run("Points filters by level", func(t *testing.T) {
		got, total, err := h.store.Points(ctx, grammar.Filter{Level: "N4", Limit: 10})
		if err != nil {
			t.Fatalf("Points: %v", err)
		}
		if total != 1 || len(got) != 1 || got[0].ID != p4 {
			t.Fatalf("got %d/%+v, want just the N4 point", total, got)
		}
	})

	t.Run("Points searches pattern, romaji and meaning case-insensitively", func(t *testing.T) {
		cases := []struct {
			q    string
			want []int64
		}{
			{"ください", []int64{p1, p2}},     // in the patterns
			{"kudasai", []int64{p1, p2}},  // in the romaji
			{"accidentally", []int64{p4}}, // in the meaning
			{"KUDASAI", []int64{p1, p2}},  // case-insensitive romaji
			{"nomatch", nil},
		}
		for _, c := range cases {
			got, total, err := h.store.Points(ctx, grammar.Filter{Query: c.q, Limit: 10})
			if err != nil {
				t.Fatalf("Points(%q): %v", c.q, err)
			}
			if total != len(c.want) || len(got) != len(c.want) {
				t.Errorf("Points(%q): total=%d got=%+v, want %d hits", c.q, total, got, len(c.want))
				continue
			}
			for i := range c.want {
				if got[i].ID != c.want[i] {
					t.Errorf("Points(%q)[%d] = %d, want %d", c.q, i, got[i].ID, c.want[i])
				}
			}
		}
	})

	t.Run("Points paginates with a stable total", func(t *testing.T) {
		first, total, err := h.store.Points(ctx, grammar.Filter{Limit: 2, Offset: 0})
		if err != nil {
			t.Fatalf("Points: %v", err)
		}
		second, total2, err := h.store.Points(ctx, grammar.Filter{Limit: 2, Offset: 2})
		if err != nil {
			t.Fatalf("Points: %v", err)
		}
		if total != 4 || total2 != 4 {
			t.Fatalf("totals = %d/%d, want 4/4", total, total2)
		}
		if len(first) != 2 || len(second) != 2 || first[0].ID == second[0].ID {
			t.Fatalf("pages = %+v / %+v", first, second)
		}
		if _, _, err := h.store.Points(ctx, grammar.Filter{Limit: 10_000}); err != nil {
			t.Fatalf("clamped limit: %v", err)
		}
	})

	t.Run("Content starts empty, SetExplanation fills and stamps it", func(t *testing.T) {
		c, err := h.store.Content(ctx, p1)
		if err != nil {
			t.Fatalf("Content: %v", err)
		}
		if c.Explanation != nil || c.ExplanationUpdatedAt != nil || c.ExplanationEdited {
			t.Fatalf("fresh content = %+v", c)
		}
		if err := h.store.SetExplanation(ctx, p1, "generated text", false); err != nil {
			t.Fatalf("SetExplanation: %v", err)
		}
		c, err = h.store.Content(ctx, p1)
		if err != nil {
			t.Fatalf("Content: %v", err)
		}
		if c.Explanation == nil || *c.Explanation != "generated text" || c.ExplanationEdited {
			t.Fatalf("content = %+v", c)
		}
		if c.ExplanationUpdatedAt == nil {
			t.Fatal("explanation_updated_at not stamped")
		}
		if err := h.store.SetExplanation(ctx, p1, "hand edited", true); err != nil {
			t.Fatalf("SetExplanation: %v", err)
		}
		c, _ = h.store.Content(ctx, p1)
		if c.Explanation == nil || *c.Explanation != "hand edited" || !c.ExplanationEdited {
			t.Fatalf("content after edit = %+v", c)
		}
	})

	t.Run("Content and SetExplanation on unknown ids are ErrPointNotFound", func(t *testing.T) {
		if _, err := h.store.Content(ctx, 999999); !errors.Is(err, grammar.ErrPointNotFound) {
			t.Errorf("Content err = %v", err)
		}
		if err := h.store.SetExplanation(ctx, 999999, "x", false); !errors.Is(err, grammar.ErrPointNotFound) {
			t.Errorf("SetExplanation err = %v", err)
		}
	})

	t.Run("HasExplanation and ExampleCount show up in summaries", func(t *testing.T) {
		if err := h.store.SetExplanation(ctx, p2, "an explanation", false); err != nil {
			t.Fatal(err)
		}
		if _, err := h.store.AddExample(ctx, p2, goodCandidate()); err != nil {
			t.Fatal(err)
		}
		got, _, err := h.store.Points(ctx, grammar.Filter{Limit: 10})
		if err != nil {
			t.Fatal(err)
		}
		var hit *grammar.PointSummary
		for i := range got {
			if got[i].ID == p2 {
				hit = &got[i]
			}
		}
		if hit == nil || !hit.HasExplanation || hit.ExampleCount != 1 {
			t.Fatalf("summary for seeded point = %+v", hit)
		}
	})

	t.Run("AddExample stores, dedupes per point, and rejects unknown points", func(t *testing.T) {
		added, err := h.store.AddExample(ctx, p1, goodCandidate())
		if err != nil {
			t.Fatalf("AddExample: %v", err)
		}
		if !added {
			t.Fatal("first insert should report added")
		}
		again, err := h.store.AddExample(ctx, p1, goodCandidate())
		if err != nil {
			t.Fatalf("duplicate AddExample: %v", err)
		}
		if again {
			t.Fatal("duplicate sentence reported as added")
		}

		examples, err := h.store.Examples(ctx, p1)
		if err != nil {
			t.Fatalf("Examples: %v", err)
		}
		if len(examples) != 1 {
			t.Fatalf("len(Examples) = %d, want 1", len(examples))
		}
		e := examples[0]
		if e.GrammarPointID != p1 || e.SentenceJA != "みずをのみました" || e.TranslationEN != "I drank water." ||
			e.SpanStart != 3 || e.SpanEnd != 5 || e.SpanText != "のみ" {
			t.Fatalf("example = %+v", e)
		}
		if e.ID == uuid.Nil || e.CreatedAt.IsZero() {
			t.Fatalf("example identity = %+v", e)
		}
		if e.Source != "ai" || e.LanguageCheck != "jmdict_tokenised" {
			t.Fatalf("example provenance = %+v", e)
		}

		// The same sentence is allowed on a different point.
		other, err := h.store.AddExample(ctx, p3, goodCandidate())
		if err != nil || !other {
			t.Fatalf("same sentence on another point: added=%v err=%v", other, err)
		}

		if _, err := h.store.AddExample(ctx, 999999, goodCandidate()); !errors.Is(err, grammar.ErrPointNotFound) {
			t.Fatalf("unknown point err = %v", err)
		}
	})

	t.Run("CountExamples counts and guards", func(t *testing.T) {
		if _, err := h.store.AddExample(ctx, p4, grammar.Candidate{
			SentenceJA: "てれてしまった", Translation: "I accidentally got lost.",
			SpanStart: 2, SpanEnd: 6, SpanText: "てしまった",
		}); err != nil {
			t.Fatal(err)
		}
		n, err := h.store.CountExamples(ctx, p4)
		if err != nil || n != 1 {
			t.Fatalf("CountExamples = %d/%v, want 1", n, err)
		}
		if _, err := h.store.CountExamples(ctx, 999999); !errors.Is(err, grammar.ErrPointNotFound) {
			t.Fatalf("unknown point err = %v", err)
		}
	})
}
