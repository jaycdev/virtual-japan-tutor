package story

import (
	"context"
	"strings"
	"testing"
)

// Live, mis-cut grammar spans ("のが", "にも", "続け") failed otherwise good
// passages on every attempt. A mis-cut span is now discarded: never stored or
// shown (so no wrong highlight), never counted towards the Focus Set (so the
// focus fraction still decides whether enough grammar appears).

// In cleanClause (ねこはねこをみつけました。) the tokens are
// ねこ[0,2) は[2,3) ねこ[3,5) を[5,6) みつけ[6,9) まし[9,11) た[11,12).
func miscutRequest(point int64) Request {
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}
	req.Focus = FocusSet{
		Vocab:   []VocabFocus{{EntSeq: 1}, {EntSeq: 2}},
		Grammar: []GrammarFocus{{PointID: point, Pattern: "ました"}},
	}
	return req
}

func TestMiscutSpanIsDiscardedAndDoesNotSinkThePassage(t *testing.T) {
	const point = int64(900001)
	for name, span := range map[string]fSpan{
		"across a word boundary":       {Start: 4, End: 7, GrammarPointID: point}, // こをみ
		"including the verb stem":      {Start: 6, End: 12, GrammarPointID: point},
		"across a boundary and a stem": {Start: 7, End: 12, GrammarPointID: point},
	} {
		t.Run(name, func(t *testing.T) {
			req := miscutRequest(point)
			client := &fakeChat{responses: [][]byte{
				fixtureSpans(t, "classroom", []fSpan{span}, cleanClause, cleanClause, cleanClause, cleanClause),
			}}
			st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
			if err != nil || !st.Validated {
				t.Fatalf("a mis-cut span must not fail an otherwise good passage: %v", err)
			}
			for _, sen := range st.Sentences {
				if len(sen.Spans) != 0 {
					t.Fatalf("sentence %d kept %+v, want the mis-cut span discarded", sen.Pos, sen.Spans)
				}
			}
			// 2 vocab words appear; the discarded grammar span must not count.
			if st.FocusItems != 3 || st.FocusHit != 2 {
				t.Fatalf("focus items=%d hit=%d, want 2 of 3 (the discarded span is not a hit)", st.FocusItems, st.FocusHit)
			}
		})
	}
}

func TestDiscardedSpansAreExplainedWhenThePassageFailsForAnotherReason(t *testing.T) {
	const point = int64(900001)
	req := miscutRequest(point)
	req.Settings.MinFocusFraction = 1.0
	client := &fakeChat{responses: [][]byte{
		fixtureSpans(t, "classroom", []fSpan{{Start: 4, End: 7, GrammarPointID: point}}, cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	_, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("the passage needs that grammar point, so it must fail")
	}
	for _, want := range []string{"0 of 1 focus grammar points", "cuts across word boundaries", "was discarded"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("feedback lacks %q: %v", want, err)
		}
	}
}

func TestAPassingPassageIsNotNaggedAboutDiscardedSpans(t *testing.T) {
	// The valid span keeps the focus fraction up; the mis-cut one is dropped
	// silently because nothing failed.
	const point = int64(900001)
	req := miscutRequest(point)
	client := &fakeChat{responses: [][]byte{
		fixtureSpans(t, "classroom", []fSpan{{Start: 9, End: 12, GrammarPointID: point}, {Start: 4, End: 7, GrammarPointID: point}},
			cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err != nil || !st.Validated {
		t.Fatalf("want validated: %v", err)
	}
	for _, sen := range st.Sentences {
		if len(sen.Spans) != 1 || sen.Spans[0].Start != 9 || sen.Spans[0].End != 12 {
			t.Fatalf("sentence %d spans = %+v, want only the well-cut ました [9,12)", sen.Pos, sen.Spans)
		}
	}
	if st.FocusHit != 3 {
		t.Fatalf("focus hit = %d, want the valid grammar span counted (3 of 3)", st.FocusHit)
	}
}

func TestDefaultAttemptsGiveTheRetriesRoomToConverge(t *testing.T) {
	if DefaultMaxAttempts != 5 {
		t.Fatalf("DefaultMaxAttempts = %d, want 5", DefaultMaxAttempts)
	}
	if got := (Settings{}).WithDefaults().MaxAttempts; got != 5 {
		t.Fatalf("zero Settings default to %d attempts, want 5", got)
	}
}
