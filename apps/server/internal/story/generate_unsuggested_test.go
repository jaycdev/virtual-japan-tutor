package story

import (
	"context"
	"strings"
	"testing"
)

// Live, one run failed all five attempts purely on spans that cited grammar
// point IDs outside the suggested list (9-12 per attempt, nothing else wrong
// after the second). Like a mis-cut span, such a span is discarded: it is
// never stored or shown, and it does not count towards the Focus Set, so a
// validated Story's spans are still all Focus Set spans.

func TestSpanCitingAnUnsuggestedPointIsDiscardedNotFatal(t *testing.T) {
	const suggested, other = int64(900001), int64(777)
	req := miscutRequest(suggested)
	client := &fakeChat{responses: [][]byte{
		// each sentence: a well-cut span for the suggested point and one for another point
		fixtureSpans(t, "classroom",
			[]fSpan{{Start: 9, End: 12, GrammarPointID: suggested}, {Start: 9, End: 12, GrammarPointID: other}},
			cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err != nil || !st.Validated {
		t.Fatalf("a span citing an unsuggested point must not fail the passage: %v", err)
	}
	for _, sen := range st.Sentences {
		if len(sen.Spans) != 1 || sen.Spans[0].GrammarPointID != suggested || !sen.Spans[0].IsFocus {
			t.Fatalf("sentence %d spans = %+v, want only the span for the suggested point", sen.Pos, sen.Spans)
		}
	}
}

func TestUnsuggestedPointSpansAreExplainedWhenThePassageFails(t *testing.T) {
	const suggested, other = int64(900001), int64(777)
	req := miscutRequest(suggested)
	req.Settings.MinFocusFraction = 1.0
	client := &fakeChat{responses: [][]byte{
		fixtureSpans(t, "classroom", []fSpan{{Start: 9, End: 12, GrammarPointID: other}},
			cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	_, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("the suggested grammar point never appears, so the passage must fail")
	}
	for _, want := range []string{"0 of 1 focus grammar points", "not in the suggested list", "was discarded"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("feedback lacks %q: %v", want, err)
		}
	}
}
