package story

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

// Regression for the second failure behind "I can never generate a story":
// once passages were long enough, every attempt still died on
// "span [17,22) for grammar point 105 is outside sentence 4 (20 characters)".
// The model was asked to count character offsets and cannot; one bad offset
// discarded the whole passage and the retry repeated it. The model now cites
// the span's text and the server finds the offsets.

func TestLocateSpanCountsRunesNotBytes(t *testing.T) {
	// The sentence from the failed run: the model said じゃないか was [17,23),
	// past the end of a 20-character sentence. It is [14,19).
	const s = "でも、彼処から聞こえる音は変じゃないか。"
	start, end, ok := locateSpan(s, "じゃないか")
	if !ok || start != 14 || end != 19 {
		t.Fatalf("locateSpan = [%d,%d) ok=%v, want [14,19)", start, end, ok)
	}
	if got := runeSlice(s, start, end); got != "じゃないか" {
		t.Fatalf("runeSlice = %q", got)
	}
	if _, _, ok := locateSpan(s, "はずです"); ok {
		t.Fatal("text that is not in the sentence must not be located")
	}
}

// textSpanFixture is fixtureSpans with spans given as text, no offsets.
func textSpanFixture(t *testing.T, spanText string, point int64) []byte {
	t.Helper()
	type span struct {
		Text           string `json:"text"`
		GrammarPointID int64  `json:"grammar_point_id"`
	}
	type sent struct {
		JA           string `json:"ja"`
		EN           string `json:"en"`
		GrammarSpans []span `json:"grammar_spans"`
	}
	out := struct {
		Title, TitleEN, Theme, Genre string
		Sentences                    []sent `json:"sentences"`
		Questions                    []fQ   `json:"questions"`
	}{Title: "ねこ", TitleEN: "Cats", Theme: "Cats", Genre: "classroom"}
	for i := 0; i < 4; i++ {
		out.Sentences = append(out.Sentences, sent{
			JA: sentence(12, cleanClause), EN: "The cat found it.",
			GrammarSpans: []span{{Text: spanText, GrammarPointID: point}},
		})
	}
	for i := 0; i < 3; i++ {
		out.Questions = append(out.Questions, fQ{PromptJA: "ねこは何を見つけましたか。", OptionsJA: []string{"ねこ", "ほん"}})
	}
	b, err := json.Marshal(map[string]any{
		"title": out.Title, "title_en": out.TitleEN, "theme": out.Theme, "genre": out.Genre,
		"sentences": out.Sentences, "questions": out.Questions,
	})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func spanRequest(point int64) Request {
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}
	req.Focus = FocusSet{
		Vocab:   []VocabFocus{{EntSeq: 1}, {EntSeq: 2}},
		Grammar: []GrammarFocus{{PointID: point}},
	}
	return req
}

func TestGenerateLocatesSpanByText(t *testing.T) {
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{textSpanFixture(t, "ました", point)}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, spanRequest(point))
	if err != nil || !st.Validated {
		t.Fatalf("a span given only as text must be accepted: %v", err)
	}
	for _, sen := range st.Sentences {
		if len(sen.Spans) != 1 {
			t.Fatalf("sentence %d spans %+v", sen.Pos, sen.Spans)
		}
		sp := sen.Spans[0]
		if sp.Start != 9 || sp.End != 12 || !sp.IsFocus {
			t.Fatalf("sentence %d span = [%d,%d) focus=%v, want the server to resolve ました to [9,12)", sen.Pos, sp.Start, sp.End, sp.IsFocus)
		}
	}
}

func TestSpanTextMissingFromSentenceIsDroppedNotFatal(t *testing.T) {
	// The model cites a pattern the sentence does not contain (seen live:
	// "いらっしゃ" in a sentence without it, on every attempt). That span is
	// unverifiable, so it is discarded, never stored or counted; it must not
	// sink an otherwise good passage.
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{textSpanFixture(t, "ましょう", point)}}
	req := spanRequest(point) // 2 of 3 focus items still appear: 67% >= the 50% bar

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err != nil || !st.Validated {
		t.Fatalf("a fabricated span must be dropped, not fail the passage: %v", err)
	}
	for _, sen := range st.Sentences {
		if len(sen.Spans) != 0 {
			t.Fatalf("sentence %d kept spans %+v, want the unplaceable span dropped", sen.Pos, sen.Spans)
		}
	}
	if st.FocusItems != 3 || st.FocusHit != 2 {
		t.Fatalf("focus items=%d hit=%d, want the dropped grammar point not counted (2 of 3)", st.FocusItems, st.FocusHit)
	}
}

func TestDroppedSpanStillFailsWhenTheGrammarIsRequired(t *testing.T) {
	// When the fraction needs that grammar point, losing the fabricated span
	// fails the gate with feedback the model can act on, and the rejected
	// candidate stays storable (no zero-width span).
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{textSpanFixture(t, "ましょう", point)}}
	req := spanRequest(point)
	req.Settings.MinFocusFraction = 1.0

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err == nil || st == nil || st.Validated {
		t.Fatalf("want rejection on the focus fraction, got err=%v", err)
	}
	if !strings.Contains(err.Error(), "0 of 1 focus grammar points") {
		t.Fatalf("error should name the missing grammar point: %v", err)
	}
	for _, sen := range st.Sentences {
		for _, sp := range sen.Spans {
			if sp.Start >= sp.End {
				t.Fatalf("sentence %d keeps unstorable span [%d,%d)", sen.Pos, sp.Start, sp.End)
			}
		}
	}
}
