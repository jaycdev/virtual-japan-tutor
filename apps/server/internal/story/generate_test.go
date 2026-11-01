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

type fSpan struct {
	Start          int   `json:"start"`
	End            int   `json:"end"`
	GrammarPointID int64 `json:"grammar_point_id"`
}

type fSent struct {
	JA           string  `json:"ja"`
	EN           string  `json:"en"`
	GrammarSpans []fSpan `json:"grammar_spans"`
}

type fQ struct {
	PromptJA  string   `json:"prompt_ja"`
	OptionsJA []string `json:"options_ja"`
	AnswerIdx int      `json:"answer_index"`
}

func fixture(t *testing.T, genre string, clauses ...string) []byte {
	t.Helper()
	return fixtureSpans(t, genre, nil, clauses...)
}

// fixtureSpans is the variant where every sentence carries the given
// Grammar Spans (coordinates inside each sentence): the gate's span rules
// and the grammar half of the focus fraction are tested through it.
func fixtureSpans(t *testing.T, genre string, spans []fSpan, clauses ...string) []byte {
	t.Helper()
	out := struct {
		Genre     string  `json:"genre"`
		Sentences []fSent `json:"sentences"`
		Questions []fQ    `json:"questions"`
	}{Genre: genre}
	for _, c := range clauses {
		out.Sentences = append(out.Sentences, fSent{JA: sentence(12, c), EN: "The cat found it.", GrammarSpans: spans})
	}
	for i := 0; i < 3; i++ {
		out.Questions = append(out.Questions, fQ{PromptJA: "ねこは何を見つけましたか。", OptionsJA: []string{"ねこ", "ほん"}, AnswerIdx: 0})
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
	// The story keeps the brief that was asked of the model, so a stored
	// story can be debugged against what it was told to do. (Retry
	// feedback is conversation history, not the brief.)
	if st.Prompt == "" || !strings.Contains(st.Prompt, "ねこ") || !strings.Contains(st.Prompt, "Genre/theme") {
		t.Fatalf("story.Prompt is not the generation brief: %q", st.Prompt)
	}
}

// TestGenerateBoostingListMemberStillUnknown locks the story half of the
// issue #12 invariant: Boosting Lists feed Practice and Mastery only — the
// coverage gate asks exactly one membership question (KnownSource, backed by
// the knowledge tables; see TestPostgresMasteryFocusIgnoresItemLists for the
// Postgres lock), and a not-yet-Known Item sitting in a Boosting List stays
// UNKNOWN there. Unlike the usual dirty-climate plant ほん in these tests,
// ほん here is LINKED: the only channel that could have marked it Known is
// list membership — and the gate never consults it.
func TestGenerateBoostingListMemberStillUnknown(t *testing.T) {
	const bookClause = "ねこはほんをみつけました。"
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", bookClause, bookClause, bookClause, bookClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	lookup := cleanLookup()
	lookup["ほん"] = VocabHit{EntSeq: 3, JA: "ほん", EN: "book"}
	st, err := NewGenerator(lookup).Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("want rejection while ほん stays unknown")
	}
	if !strings.Contains(err.Error(), "known-word coverage") {
		t.Fatalf("error = %q, want the coverage rejection", err)
	}
	if st == nil {
		t.Fatal("want the rejected candidate with its counts")
	}
	// 4 sentences x 12 clauses x 3 content words = 144, 96 known: coverage is
	// exactly 2/3 under the 0.95 bar, membership in a Boosting List or not.
	if st.ContentWords != 144 || st.KnownWords != 96 {
		t.Fatalf("counts known=%d content=%d, want 96/144", st.KnownWords, st.ContentWords)
	}
	if cov := float64(st.KnownWords) / float64(st.ContentWords); cov != 2.0/3.0 {
		t.Fatalf("coverage = %v, want exactly 2/3 — list membership must never lift it", cov)
	}

	// The counterexample the invariant demands: make ほん genuinely Known and
	// nothing else changes — the story passes. It was exactly that one item
	// keeping coverage under the threshold.
	client2 := &fakeChat{responses: [][]byte{
		fixture(t, "travel", bookClause, bookClause, bookClause, bookClause),
	}}
	req2 := baseRequest()
	req2.Known = fakeKnown{
		1: {IsKnown: true, SRSLevel: 5},
		2: {IsKnown: true, SRSLevel: 4},
		3: {IsKnown: true, SRSLevel: 3},
	}
	st2, err2 := NewGenerator(lookup).Generate(context.Background(), client2, req2)
	if err2 != nil {
		t.Fatalf("want acceptance once ほん is Known: %v", err2)
	}
	if !st2.Validated {
		t.Fatalf("validated=false after acceptance, want true: %v", err2)
	}
	if st2.KnownWords != st2.ContentWords || st2.ContentWords != 144 {
		t.Fatalf("accepted story counts known=%d content=%d, want 144/144", st2.KnownWords, st2.ContentWords)
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
	if !strings.Contains(err.Error(), "focus items") {
		t.Fatalf("error %q should name the focus-item problem (words AND grammar)", err)
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

func TestGateFocusFractionCountsGrammarPoints(t *testing.T) {
	// Every focus WORD appears, but a suggested grammar point is never
	// realised: with the fraction counting both halves of the Focus Set
	// that is 2 of 3 and must fail, where words alone would pass.
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{
		fixture(t, "classroom", cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Settings.MinFocusFraction = 1.0
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}
	req.Focus = FocusSet{
		Vocab:   []VocabFocus{{EntSeq: 1}, {EntSeq: 2}},
		Grammar: []GrammarFocus{{PointID: point}},
	}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("want rejection when a suggested grammar point is missing")
	}
	if !strings.Contains(err.Error(), "grammar") {
		t.Fatalf("error %q should name the grammar half of the fraction", err)
	}
	if st == nil || st.FocusItems != 3 || st.FocusHit != 2 {
		t.Fatalf("focus counts not stored: %+v", st)
	}
}

func TestGateAcceptsPatternOnlySpan(t *testing.T) {
	// The same passage with a span over the auxiliary only (しました at
	// runes [9,12)) is accepted, flagged IsFocus, and counted as a hit on
	// the Focus Set's grammar point.
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{
		fixtureSpans(t, "classroom", []fSpan{{Start: 9, End: 12, GrammarPointID: point}},
			cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Settings.MinFocusFraction = 1.0
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}
	req.Focus = FocusSet{
		Vocab:   []VocabFocus{{EntSeq: 1}, {EntSeq: 2}},
		Grammar: []GrammarFocus{{PointID: point}},
	}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if !st.Validated {
		t.Fatal("a span covering the pattern's own characters must pass the gate")
	}
	if st.FocusItems != 3 || st.FocusHit != 3 {
		t.Fatalf("focus items=%d hit=%d, want the grammar point counted (3 of 3)", st.FocusItems, st.FocusHit)
	}
	for _, sen := range st.Sentences {
		if len(sen.Spans) != 1 || !sen.Spans[0].IsFocus {
			t.Fatalf("sentence %d spans %+v, want one focus-flagged span", sen.Pos, sen.Spans)
		}
	}
}

func TestGateRejectsSpanIncludingVerbStem(t *testing.T) {
	// The pattern-only rule: 食べてしまった must be spanned てしまった,
	// not from 食べ. Here the span starts at the verb stem みつけ ([6,12)
	// instead of [9,12)): token boundaries alone are not enough, and the
	// retry feedback must say so in those terms.
	const point = int64(900001)
	client := &fakeChat{responses: [][]byte{
		fixtureSpans(t, "classroom", []fSpan{{Start: 6, End: 12, GrammarPointID: point}},
			cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}
	req.Focus = FocusSet{
		Vocab:   []VocabFocus{{EntSeq: 1}, {EntSeq: 2}},
		Grammar: []GrammarFocus{{PointID: point}},
	}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("a span opening at the verb stem must be rejected")
	}
	if !strings.Contains(err.Error(), "content word") || !strings.Contains(err.Error(), "てしまった") {
		t.Fatalf("error %q should name the stem inclusion with the pattern example", err)
	}
	if st == nil || st.Validated {
		t.Fatalf("candidate %+v, want stored unvalidated", st)
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

func TestGenerateRejectsTooManyQuestionOptions(t *testing.T) {
	// The prompt asks for exactly four options; the gate caps them, so a
	// completion that rambles extra options is rejected (and its retry
	// feedback says why) rather than stored with an unbounded list.
	out := struct {
		Genre     string  `json:"genre"`
		Sentences []fSent `json:"sentences"`
		Questions []fQ    `json:"questions"`
	}{Genre: "travel"}
	for range 4 {
		out.Sentences = append(out.Sentences, fSent{JA: sentence(12, cleanClause), EN: "The cat found it."})
	}
	for range 3 {
		out.Questions = append(out.Questions, fQ{
			PromptJA:  "ねこは何を見つけましたか。",
			OptionsJA: []string{"ねこ", "いぬ", "ほん", "さかな", "とり"},
			AnswerIdx: 0,
		})
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("payload: %v", err)
	}

	client := &fakeChat{responses: [][]byte{b}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("five options must be rejected")
	}
	if !strings.Contains(err.Error(), "options") {
		t.Fatalf("error %q should name the options problem", err)
	}
	if st == nil || st.Validated {
		t.Fatalf("candidate %+v, want stored unvalidated", st)
	}
}

func TestGenerateStoresHiraganaReadings(t *testing.T) {
	// Kagome reports surface readings in katakana (ネコ, ノミ); furigana is
	// hiragana everywhere else in the app, so stored readings are converted
	// to one script.
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	var checked int
	for _, sen := range st.Sentences {
		for _, tok := range sen.Tokens {
			if tok.Reading == "" {
				continue
			}
			for _, r := range tok.Reading {
				if r >= 0x30A1 && r <= 0x30FA {
					t.Fatalf("token %q reading %q still holds katakana", tok.Surface, tok.Reading)
				}
			}
			checked++
		}
	}
	if checked == 0 {
		t.Fatal("no readings to check")
	}
	if tok := st.Sentences[0].Tokens[0]; tok.Surface == "ねこ" && tok.Reading != "ねこ" {
		t.Fatalf("reading for ねこ = %q, want hiragana", tok.Reading)
	}
}

func TestToHiraganaKeepsMarksAndKana(t *testing.T) {
	if got := toHiragana("コーヒー"); got != "こーひー" {
		t.Fatalf("コーヒー -> %q, want こーひー (long-vowel mark stays)", got)
	}
	if got := toHiragana("ネコ"); got != "ねこ" {
		t.Fatalf("ネコ -> %q, want ねこ", got)
	}
	if got := toHiragana("ねこ"); got != "ねこ" {
		t.Fatalf("ねこ -> %q, want unchanged", got)
	}
	if got := toHiragana(""); got != "" {
		t.Fatalf("empty -> %q", got)
	}
}

func TestMaterialiseStripsNullsFromStoryText(t *testing.T) {
	// End-to-end: a NUL inside a model sentence must not survive into the
	// paragraph either. stories.text is assembled from the stripped
	// sentences, so Text and the Sentences stay identical, NUL-free strings
	// (Postgres would reject the NUL at the store anyway).
	nulClause := "ねこは\x00ねこをみつけました。"
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", cleanClause, nulClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	if strings.ContainsRune(st.Sentences[1].JA, 0) {
		t.Fatal("the stripped sentence still holds a NUL")
	}
	if st.Sentences[1].JA != sentence(12, cleanClause) {
		t.Fatalf("stripped sentence lost more than the NUL: %q", st.Sentences[1].JA)
	}
	if strings.ContainsRune(st.Text, 0) {
		t.Fatal("stories.text still holds a NUL: Text must be built from the stripped sentences")
	}
	if st.Text != st.Sentences[0].JA+st.Sentences[1].JA+st.Sentences[2].JA+st.Sentences[3].JA {
		t.Fatal("Text is not the stripped sentences joined: paragraph and sentences drifted apart")
	}
}

func TestStripNulls(t *testing.T) {
	// Postgres rejects \u0000 in text: a stray NUL from the model must not
	// turn a storable story into a save failure.
	if got := stripNulls("ねこ\x00はねこをみつけ\x00ました。"); got != "ねこはねこをみつけました。" {
		t.Fatalf("stripNulls = %q", got)
	}
	if got := stripNulls("clean"); got != "clean" {
		t.Fatalf("clean text changed: %q", got)
	}
}

func TestGenerateAttemptsCountEveryModelCall(t *testing.T) {
	// Attempts records what the candidate cost, including attempts that never
	// produced a candidate: a gate failure followed by unparsable output
	// spent two model calls, and the stored story says so.
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", dirtyClause, dirtyClause, dirtyClause, dirtyClause),
		[]byte("{not json at all"),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 2
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err == nil {
		t.Fatal("want the gate's rejection surfaced as an error")
	}
	if st == nil {
		t.Fatal("want the last usable candidate returned")
	}
	if st.Attempts != 2 || client.calls != 2 {
		t.Fatalf("attempts=%d calls=%d, want 2 of each", st.Attempts, client.calls)
	}
}

func TestMaterialiseCachesLookupMisses(t *testing.T) {
	// The lookup cache covers misses as well as hits: a repeated unlinked
	// word costs one query, not one per occurrence.
	counting := &countingLookup{inner: cleanLookup()}
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", dirtyClause, dirtyClause, dirtyClause, dirtyClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	gen := NewGenerator(counting)
	if _, err := gen.Generate(context.Background(), client, req); err == nil {
		t.Fatal("the unlinked ほん should have sunk coverage")
	}
	// ほん appears four times (once per sentence) but must be queried once;
	// the two linked surfaces likewise once each.
	for surface, n := range counting.counts {
		if n != 1 {
			t.Fatalf("lookup of %q called %d times, want 1 (misses are cached too)", surface, n)
		}
	}
	if counting.counts["ほん"] != 1 {
		t.Fatalf("ほん lookups = %d, want 1", counting.counts["ほん"])
	}
}

// countingLookup counts how often each surface is queried.
type countingLookup struct {
	inner  fakeLookup
	counts map[string]int
}

func (c *countingLookup) Lookup(ctx context.Context, surface, base string) (VocabHit, bool, error) {
	if c.counts == nil {
		c.counts = map[string]int{}
	}
	c.counts[surface]++
	return c.inner.Lookup(ctx, surface, base)
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
	// Disliked genres drop out of the recent-reading fallback: ratings
	// steer away even from what the learner just read.
	got = PickGenre(map[string]map[Rating]int{"mystery": {RatingDown: 1}}, []string{"mystery", "fairy tale"})
	if got != "fairy tale" {
		t.Fatalf("PickGenre = %q, want the disliked recent genre skipped", got)
	}
	// All recent genres disliked: surprise me rather than re-serve them.
	if got = PickGenre(map[string]map[Rating]int{"mystery": {RatingDown: 1}}, []string{"mystery"}); got != "" {
		t.Fatalf("PickGenre = %q, want surprise-me when every recent genre is disliked", got)
	}
	// dislikedGenres lists the net-down genres for the prompt's avoid
	// line, sorted for a stable prompt. Net-neutral genres are not listed.
	ds := dislikedGenres(map[string]map[Rating]int{
		"mystery": {RatingDown: 2}, "horror": {RatingDown: 1}, "travel": {RatingUp: 1}, "fable": {RatingUp: 1, RatingDown: 1},
	})
	if len(ds) != 2 || ds[0] != "horror" || ds[1] != "mystery" {
		t.Fatalf("dislikedGenres = %v, want [horror mystery]", ds)
	}
}

func TestFuriganaThreshold(t *testing.T) {
	known := func(level int, surface string) Token {
		l := level
		return Token{Surface: surface, Tag: TagKnown, SRSLevel: &l}
	}
	if Furigana(known(5, "猫"), 3) {
		t.Fatal("known item at/above the threshold should hide furigana")
	}
	if Furigana(known(3, "猫"), 3) {
		t.Fatal("the threshold itself is inclusive: at it, furigana stays hidden")
	}
	if !Furigana(known(2, "猫"), 3) {
		t.Fatal("known item below the threshold should show furigana")
	}
	if !Furigana(Token{Surface: "猫", Tag: TagUnknown}, 3) {
		t.Fatal("unknown tokens with kanji always show furigana")
	}
	// Ruby is only worth rendering over kanji: a kana-only surface's
	// "reading" is just its own surface, so no ruby at any level.
	if Furigana(known(1, "ねこ"), 3) {
		t.Fatal("kana-only known surface must not get ruby")
	}
	if Furigana(Token{Surface: "ねこ", Tag: TagUnknown}, 3) {
		t.Fatal("kana-only unknown surface must not get ruby either")
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
