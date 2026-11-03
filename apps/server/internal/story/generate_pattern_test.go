package story

import (
	"context"
	"strings"
	"testing"
)

// The "opens at a content word" rule exists to keep verb stems out of a span
// (食べてしまった must be spanned てしまった). It also rejected patterns that
// legitimately begin with a word: 必要がある, はずがない, どうやって, 意向形. The
// model's spans were right and the gate threw the passage away on every
// attempt. The rule now compares the span with the Grammar Point's own pattern.

func patternSpanRequest(point int64, pattern string) Request {
	req := spanRequest(point)
	req.Focus.Grammar = []GrammarFocus{{PointID: point, Pattern: pattern}}
	return req
}

func TestPatternThatBeginsWithAContentWordIsAccepted(t *testing.T) {
	// みつけ is a content word; the Grammar Point is みつけました itself.
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{textSpanFixture(t, "みつけました", point)}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, patternSpanRequest(point, "みつけました"))
	if err != nil || !st.Validated {
		t.Fatalf("a span that is the pattern itself must pass even when it opens at a content word: %v", err)
	}
	if sp := st.Sentences[0].Spans; len(sp) != 1 || sp[0].Start != 6 || sp[0].End != 12 {
		t.Fatalf("spans = %+v, want [6,12)", sp)
	}
}

func TestStemBeforeThePatternIsStillRejected(t *testing.T) {
	// The Grammar Point is ました; a span that also takes the stem みつけ is
	// the 食べてしまった mistake, and the pattern says so.
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{textSpanFixture(t, "みつけました", point)}}

	req := patternSpanRequest(point, "ました")
	req.Settings.MinFocusFraction = 1.0 // the discarded span is then what fails the passage
	_, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err == nil || !strings.Contains(err.Error(), "opens at the content word") {
		t.Fatalf("a stem before the pattern must not count, and the feedback must say why, got %v", err)
	}
}

func TestSpanStartsTheWayThePatternStarts(t *testing.T) {
	for _, c := range []struct {
		span, pattern string
		want          bool
	}{
		{"必要がある", "必要がある", true},
		{"はずがない", "はずがない", true},
		{"どうやって", "どうやって", true},
		{"意向形", "意向形", true},
		{"いたしました", "いたします", true}, // conjugated; shares the stem the pattern starts with
		{"いらっしゃいました", "いらっしゃる", true},
		{"みつけました", "ました", false}, // stem before the pattern
		{"食べてしまった", "てしまった", false},
		{"みつけました", "", false}, // pattern unknown: stay strict
		{"必要がある", "～必要がある", true},
	} {
		if got := spanStartsLikePattern(c.span, c.pattern); got != c.want {
			t.Errorf("spanStartsLikePattern(%q, %q) = %v, want %v", c.span, c.pattern, got, c.want)
		}
	}
}
