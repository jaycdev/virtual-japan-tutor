package story

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
)

// fakeChat is the stand-in LLM (no live AI in tests): it answers with a
// scripted sequence of JSON payloads, repeating the last one, and records
// every message list it saw so tests can inspect the retry feedback.
type fakeChat struct {
	responses [][]byte
	calls     int
	msgs      [][]llm.Message
}

func (f *fakeChat) ChatJSON(_ context.Context, msgs []llm.Message, _ llm.Schema, _ llm.Options) (llm.JSONResult, error) {
	f.calls++
	f.msgs = append(f.msgs, msgs)
	i := f.calls - 1
	if i >= len(f.responses) {
		i = len(f.responses) - 1
	}
	return llm.JSONResult{JSON: f.responses[i]}, nil
}

// fakeLookup links surfaces to jmdict entries; anything absent links to no
// entry at all — an unlinked Vocabulary Item, which counts as unknown.
type fakeLookup map[string]VocabHit

func (f fakeLookup) Lookup(_ context.Context, surface, _ string) (VocabHit, bool, error) {
	h, ok := f[surface]
	return h, ok, nil
}

// fakeKnown answers the gate's membership question per ent_seq.
type fakeKnown map[int64]KnownView

func (f fakeKnown) KnownVocab(_ context.Context, _ uuid.UUID, seqs []int64) (map[int64]KnownView, error) {
	out := map[int64]KnownView{}
	for _, s := range seqs {
		if v, ok := f[s]; ok {
			out[s] = v
		}
	}
	return out, nil
}

// The fixture sentences: only ねこ and みつけ are content words (13 runes per
// repetition), so the gate's counts are predictable, and ほん is the plant:
// absent from the lookup it stays unlinked and unknown.
const cleanClause = "ねこはねこをみつけました。"
const dirtyClause = "ねこはほんをみつけました。"

func sentence(n int, clause string) string { return strings.Repeat(clause, n) }

func fixture(t *testing.T, genre string, clauses ...string) []byte {
	t.Helper()
	type span struct {
		Start          int   `json:"start"`
		End            int   `json:"end"`
		GrammarPointID int64 `json:"grammar_point_id"`
	}
	type sent struct {
		JA           string `json:"ja"`
		EN           string `json:"en"`
		GrammarSpans []span `json:"grammar_spans"`
	}
	type q struct {
		PromptJA  string   `json:"prompt_ja"`
		OptionsJA []string `json:"options_ja"`
		AnswerIdx int      `json:"answer_index"`
	}
	out := struct {
		Genre     string `json:"genre"`
		Sentences []sent `json:"sentences"`
		Questions []q    `json:"questions"`
	}{Genre: genre}
	for _, c := range clauses {
		out.Sentences = append(out.Sentences, sent{JA: sentence(12, c), EN: "The cat found it.", GrammarSpans: []span{}})
	}
	for i := 0; i < 3; i++ {
		out.Questions = append(out.Questions, q{PromptJA: "ねこは何を見つけましたか。", OptionsJA: []string{"ねこ", "ほん"}, AnswerIdx: 0})
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	return b
}

func baseRequest() Request {
	return Request{
		UserID:     uuid.New(),
		Settings:   Settings{MinCoverage: 0.95, MinFocusFraction: 0.5, MaxAttempts: 3},
		KnownWords: []VocabFocus{{EntSeq: 1, JA: "ねこ", EN: "cat"}, {EntSeq: 2, JA: "つける", EN: "find"}},
	}
}

func cleanLookup() fakeLookup {
	return fakeLookup{
		"ねこ":  {EntSeq: 1, JA: "ねこ", EN: "cat"},
		"みつけ": {EntSeq: 2, JA: "つける", EN: "find"},
	}
}

func TestGenerateRetryThenAccept(t *testing.T) {
	// First attempt smuggles ほん, an unlinked word: coverage drops below the
	// gate. The retry gets the complaint fed back and produces a clean story.
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", dirtyClause, cleanClause, cleanClause, cleanClause),
		fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if !st.Validated || st.Attempts != 2 {
		t.Fatalf("validated=%v attempts=%d, want validated on attempt 2", st.Validated, st.Attempts)
	}
	if client.calls != 2 {
		t.Fatalf("provider calls = %d, want 2", client.calls)
	}
	// The retry prompt must carry the gate's complaint — that is what steers
	// the model, per ADR 0002's feedback loop.
	second := client.msgs[1]
	found := false
	for _, m := range second {
		if strings.Contains(m.Content, "known-word coverage") {
			found = true
		}
	}
	if !found {
		t.Fatal("retry feedback did not mention the coverage failure")
	}
	if st.KnownWords != st.ContentWords || st.ContentWords == 0 {
		t.Fatalf("counts known=%d content=%d, want all known and nonzero", st.KnownWords, st.ContentWords)
	}
}

func TestGenerateExhaustionStoresCounts(t *testing.T) {
	// Failed-story policy: every attempt fails, but the last candidate is
	// returned with Validated false and its gate counts, alongside an error.
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", dirtyClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 2
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("want an error when every attempt fails the gate")
	}
	if st == nil {
		t.Fatal("want the final candidate returned even on exhaustion")
	}
	if st.Validated || st.Attempts != 2 {
		t.Fatalf("validated=%v attempts=%d, want unvalidated after 2 attempts", st.Validated, st.Attempts)
	}
	if st.ContentWords == 0 || st.KnownWords >= st.ContentWords {
		t.Fatalf("stored counts known=%d content=%d look wrong", st.KnownWords, st.ContentWords)
	}
}

func TestGenerateFocusFractionEnforced(t *testing.T) {
	// Coverage passes (every word known) but only 2 of 5 focus words appear:
	// the focus-inclusion half of the gate must reject it.
	client := &fakeChat{responses: [][]byte{
		fixture(t, "classroom", cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}
	req.Focus = FocusSet{Vocab: []VocabFocus{
		{EntSeq: 1}, {EntSeq: 2}, {EntSeq: 3}, {EntSeq: 4}, {EntSeq: 5},
	}}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("want rejection when too few focus words appear")
	}
	if !strings.Contains(err.Error(), "focus words") {
		t.Fatalf("error %q should name the focus-word problem", err)
	}
	if st == nil || st.FocusItems != 5 || st.FocusHit != 2 {
		t.Fatalf("focus counts not stored: %+v", st)
	}
	// The vocab list must flag which items were focus items: practice
	// records are written for exactly these.
	var focusCount int
	for _, v := range st.VocabItems {
		if v.IsFocus {
			focusCount++
		}
	}
	if focusCount != 2 {
		t.Fatalf("IsFocus flagged on %d vocab items, want 2", focusCount)
	}
}

func TestGenerateUnlinkedCountsUnknown(t *testing.T) {
	// ほん links to no jmdict entry, so it cannot be a Known Item even if the
	// gate's membership map had room for it: it counts as unknown (issue #10).
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", dirtyClause, dirtyClause, dirtyClause, dirtyClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}, 99: {IsKnown: true, SRSLevel: 7}}

	gen := NewGenerator(cleanLookup()) // no ほん in the lookup at all
	st, err := gen.Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("unlinked words must count as unknown and sink coverage")
	}
	for _, sen := range st.Sentences {
		for _, tok := range sen.Tokens {
			if tok.Surface == "ほん" {
				if tok.Tag != TagUnknown || tok.EntSeq != nil {
					t.Fatalf("unlinked token tagged %+v, want unknown with no ent_seq", tok)
				}
			}
		}
	}
}

func TestPickGenreSteeredByRatings(t *testing.T) {
	got := PickGenre(map[string]map[Rating]int{
		"travel":  {RatingUp: 3, RatingDown: 1},
		"cooking": {RatingUp: 1},
		"mystery": {RatingDown: 2},
	}, []string{"fairy tale"})
	if got != "travel" {
		t.Fatalf("PickGenre = %q, want the most-upvoted genre", got)
	}
	// No ratings: recent reading history seeds the choice.
	got = PickGenre(map[string]map[Rating]int{}, []string{"fairy tale"})
	if got != "fairy tale" {
		t.Fatalf("PickGenre = %q, want the recent genre", got)
	}
	// Nothing known: empty string means "surprise me".
	if got = PickGenre(nil, nil); got != "" {
		t.Fatalf("PickGenre = %q, want surprise-me (empty)", got)
	}
	// Ties pick randomly among the tied genres.
	got = PickGenre(map[string]map[Rating]int{"a": {RatingUp: 1}, "b": {RatingUp: 1}}, nil)
	if got != "a" && got != "b" {
		t.Fatalf("PickGenre = %q, want one of the tied upvoted genres", got)
	}
}

func TestFuriganaThreshold(t *testing.T) {
	known := func(level int) Token {
		l := level
		return Token{Tag: TagKnown, SRSLevel: &l}
	}
	if Furigana(known(5), 3) {
		t.Fatal("known item at/above the threshold should hide furigana")
	}
	if Furigana(known(3), 3) {
		t.Fatal("the threshold itself is inclusive: at it, furigana stays hidden")
	}
	if !Furigana(known(2), 3) {
		t.Fatal("known item below the threshold should show furigana")
	}
	if !Furigana(Token{Tag: TagUnknown}, 3) {
		t.Fatal("unknown tokens always show furigana")
	}
}

func TestFocusChangedSignificance(t *testing.T) {
	if FocusChanged([]string{"a", "b", "c"}, []string{"a", "b", "c"}) {
		t.Fatal("unchanged focus set must not re-arm generation")
	}
	if FocusChanged([]string{"a", "b", "c"}, []string{"a", "b", "c", "d"}) {
		t.Fatal("one new member of four (25%) is below the one-third rule")
	}
	if !FocusChanged([]string{"a"}, []string{"a", "b", "c"}) {
		t.Fatal("two new members of three (67%) is a significant change")
	}
	if !FocusChanged(nil, []string{"a"}) {
		t.Fatal("no snapshot means generation has never run: always changed")
	}
	if FocusChanged([]string{"a"}, nil) {
		t.Fatal("an empty current set is not a change")
	}
}
