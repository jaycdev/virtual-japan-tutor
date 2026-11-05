package story

import (
	"context"
	"strings"
	"testing"
)

// Regression for the particle Lookups after #98: hovering と showed がり and
// について showed あまり. The model had put Grammar Spans over those particles
// citing other Focus Set points, and the gate only compared a span with its
// point's pattern when the span opened at a content word, so a span opening at
// a particle was kept whatever it cited. Every span is now checked against the
// pattern of the point it cites.

func TestSpanCitingAnotherPointIsDiscarded(t *testing.T) {
	// を is a particle; the point it cites is あまり.
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{textSpanFixture(t, "を", point)}}

	req := patternSpanRequest(point, "あまり")
	req.Settings.MinFocusFraction = 1.0 // the discarded span is then what fails the passage
	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err == nil || !strings.Contains(err.Error(), "does not express") {
		t.Fatalf("a span over を citing あまり must be discarded, and the feedback must say why, got %v", err)
	}
	if st != nil {
		for _, sen := range st.Sentences {
			if len(sen.Spans) != 0 {
				t.Fatalf("sentence %d kept spans %+v", sen.Pos, sen.Spans)
			}
		}
	}
}

func TestSpanOverAParticleItsPointNamesIsKept(t *testing.T) {
	// The same particle span, citing the point that is that particle.
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{textSpanFixture(t, "を", point)}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, patternSpanRequest(point, "を"))
	if err != nil || !st.Validated {
		t.Fatalf("a span that is its point's pattern must pass: %v", err)
	}
	if len(st.Sentences[0].Spans) != 1 {
		t.Fatalf("spans = %+v, want the を span kept", st.Sentences[0].Spans)
	}
}

func TestSpanExpressesPattern(t *testing.T) {
	for _, c := range []struct {
		span, pattern string
		want          bool
	}{
		// The live failures.
		{"について", "あまり", false},
		{"と", "がり", false},
		// A span that is its pattern, or one of its variants.
		{"について", "について", true},
		{"と", "と", true},
		{"です", "だ / です", true},
		{"ことがある", "～ことがある", true},
		// Inflected or partial spans of the pattern.
		{"てしまいました", "てしまう", true},
		{"いらっしゃいました", "いらっしゃる", true},
		{"なければならない", "なければならない・なくてはいけない", true},
		// No pattern to compare against: nothing to judge, so keep the span.
		{"を", "", true},
	} {
		if got := spanExpressesPattern(c.span, c.pattern); got != c.want {
			t.Errorf("spanExpressesPattern(%q, %q) = %v, want %v", c.span, c.pattern, got, c.want)
		}
	}
}
