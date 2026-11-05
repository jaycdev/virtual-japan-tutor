package story

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
)

// storyFromJA materialises a Story from its sentences, so each token carries
// the tags the style check reads (conjunction, linked or not).
func storyFromJA(t *testing.T, ja ...string) *Story {
	t.Helper()
	var sents []fSent
	for _, s := range ja {
		sents = append(sents, fSent{JA: s, EN: "x"})
	}
	b, err := json.Marshal(struct {
		Sentences []fSent `json:"sentences"`
	}{sents})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var raw storyJSON
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	st, err := NewGenerator(fakeLookup{}).materialise(context.Background(), &raw, baseRequest())
	if err != nil {
		t.Fatalf("materialise: %v", err)
	}
	return st
}

func repeatSentence(n int, ja string) []string {
	out := make([]string, n)
	for i := range out {
		out[i] = ja
	}
	return out
}

func TestTokeniserTagsSentenceOpeningConjunctions(t *testing.T) {
	for _, w := range []string{"でも", "しかし", "ところが", "けれども", "だが", "そして", "それから"} {
		st := storyFromJA(t, w+"、ねこはねこをみつけました。")
		word, contrastive, ok := openingConjunction(st.Sentences[0])
		if !ok {
			t.Errorf("%s opens a sentence but is not detected as a conjunction", w)
			continue
		}
		if word != w {
			t.Errorf("detected opener %q, want %q", word, w)
		}
		wantContrastive := w != "そして" && w != "それから"
		if contrastive != wantContrastive {
			t.Errorf("%s: contrastive=%v, want %v", w, contrastive, wantContrastive)
		}
	}
}

func TestStyleCheckIgnoresSentencesWithoutAnOpeningConjunction(t *testing.T) {
	st := storyFromJA(t, repeatSentence(10, "ねこはねこをみつけました。")...)
	if problems := styleProblems(st); len(problems) != 0 {
		t.Fatalf("a passage with no conjunctions got style problems: %v", problems)
	}
}

func TestStyleCheckAllowsTwoContrastiveOpeners(t *testing.T) {
	ja := append([]string{"でも、ねこはねこをみつけました。", "しかし、ねこはねこをみつけました。"},
		repeatSentence(8, "ねこはねこをみつけました。")...)
	if problems := styleProblems(storyFromJA(t, ja...)); len(problems) != 0 {
		t.Fatalf("two contrastive openers in ten sentences should pass, got %v", problems)
	}
}

func TestStyleCheckFlagsThirdContrastiveOpener(t *testing.T) {
	ja := append([]string{
		"でも、ねこはねこをみつけました。",
		"しかし、ねこはねこをみつけました。",
		"ところが、ねこはねこをみつけました。",
	}, repeatSentence(7, "ねこはねこをみつけました。")...)
	problems := styleProblems(storyFromJA(t, ja...))
	if len(problems) == 0 || !strings.Contains(strings.Join(problems, "\n"), "contrastive conjunction") {
		t.Fatalf("three contrastive openers should be flagged, got %v", problems)
	}
	if !strings.Contains(strings.Join(problems, "\n"), "ところが") {
		t.Errorf("feedback should quote the offending sentence:\n%v", problems)
	}
}

func TestStyleCheckFlagsConjunctionShareOverTwentyPercent(t *testing.T) {
	// Three そして openers in ten sentences is 30%: not contrastive, but
	// still too many conjunctions.
	ja := append([]string{
		"そして、ねこはねこをみつけました。",
		"そして、ねこはねこをみつけました。",
		"そして、ねこはねこをみつけました。",
	}, repeatSentence(7, "ねこはねこをみつけました。")...)
	problems := styleProblems(storyFromJA(t, ja...))
	joined := strings.Join(problems, "\n")
	if !strings.Contains(joined, "open with a conjunction") {
		t.Fatalf("30%% conjunction openers should be flagged, got %v", problems)
	}
	if strings.Contains(joined, "contrastive") {
		t.Errorf("そして is not contrastive, got %v", problems)
	}
}

func TestStyleCheckAcceptsConjunctionShareAtTwentyPercent(t *testing.T) {
	ja := append([]string{"そして、ねこはねこをみつけました。", "そして、ねこはねこをみつけました。"},
		repeatSentence(8, "ねこはねこをみつけました。")...)
	if problems := styleProblems(storyFromJA(t, ja...)); len(problems) != 0 {
		t.Fatalf("2 of 10 sentences (20%%) should pass, got %v", problems)
	}
}

func TestStylePromptAsksForTheNewShape(t *testing.T) {
	req := baseRequest()
	req.Focus = FocusSet{Vocab: []VocabFocus{{EntSeq: 1, JA: "ねこ", EN: "cat"}}}
	prompt := userPrompt(req, req.Settings.WithDefaults())
	for _, want := range []string{
		"split into 20 to 30 sentences",
		"about 20 to 50 characters per sentence",
		"Use at most 2 contrastive conjunctions",
		"Join closely related clauses",
		"name or relationship",
		"leave a word out rather than force it",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt lacks %q", want)
		}
	}
}

// styleOnly is a passage whose only failure is the style check: three
// sentences open with でも, and everything else passes the hard gate.
var styleOnly = []string{"でも、ねこはねこをみつけました。", "でも、ねこはねこをみつけました。", "でも、ねこはねこをみつけました。", cleanClause}

func TestStyleOnlyFailureIsAcceptedOnTheLastAttempt(t *testing.T) {
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", styleOnly...),
		fixture(t, "travel", styleOnly...),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 2
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err != nil {
		t.Fatalf("a style-only failure on the last attempt must be accepted, got %v", err)
	}
	if !st.Validated || st.Attempts != 2 || client.calls != 2 {
		t.Fatalf("validated=%v attempts=%d calls=%d, want validated after 2 attempts", st.Validated, st.Attempts, client.calls)
	}
}

func TestStyleOnlyFailureMidRunTriggersARetryWithFeedback(t *testing.T) {
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", styleOnly...),
		fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 2
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err != nil || !st.Validated || st.Attempts != 2 {
		t.Fatalf("want validated on attempt 2, got err=%v validated=%v attempts=%d", err, st.Validated, st.Attempts)
	}
	var feedback string
	for _, m := range client.msgs[1] {
		if strings.Contains(m.Content, "contrastive conjunction") {
			feedback = m.Content
		}
	}
	if feedback == "" {
		t.Fatal("retry feedback did not mention the conjunction problem")
	}
}

// failAfterFirst answers the first attempt, then fails at the provider level.
type failAfterFirst struct {
	first []byte
	calls int
}

func (f *failAfterFirst) ChatJSON(_ context.Context, _ []llm.Message, _ llm.Schema, _ llm.Options) (llm.JSONResult, error) {
	f.calls++
	if f.calls == 1 {
		return llm.JSONResult{JSON: f.first}, nil
	}
	return llm.JSONResult{}, errors.New("provider down")
}

func TestStyleOnlyCandidateSurvivesAProviderFailure(t *testing.T) {
	client := &failAfterFirst{first: fixture(t, "travel", styleOnly...)}
	req := baseRequest()
	req.Settings.MaxAttempts = 3
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err != nil || st == nil || !st.Validated {
		t.Fatalf("a style-only candidate must survive a later provider failure, got st=%v err=%v", st, err)
	}
	if !strings.HasPrefix(st.Sentences[0].JA, "でも") || st.Attempts != 1 {
		t.Fatalf("want the first attempt's passage after 1 answered attempt, got %q attempts=%d", st.Sentences[0].JA, st.Attempts)
	}
}

func TestStyleOnlyCandidateSurvivesALaterHardFailure(t *testing.T) {
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", styleOnly...),
		fixture(t, "travel", dirtyClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 2
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err != nil || !st.Validated {
		t.Fatalf("a style-only candidate must not be lost to a later hard failure, got err=%v validated=%v", err, st.Validated)
	}
	if !strings.HasPrefix(st.Sentences[0].JA, "でも") {
		t.Fatalf("want the style-only passage, got %q", st.Sentences[0].JA)
	}
}

func TestStyleOnlyFailureOnASingleAttemptIsAccepted(t *testing.T) {
	client := &fakeChat{responses: [][]byte{fixture(t, "travel", styleOnly...)}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err != nil || !st.Validated || st.Attempts != 1 {
		t.Fatalf("want validated after one attempt, got err=%v validated=%v attempts=%d", err, st.Validated, st.Attempts)
	}
}

func TestHardFailureStillRejectsAPassageWithStyleProblems(t *testing.T) {
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", dirtyClause, styleOnly[0], styleOnly[1], styleOnly[2]),
	}}
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err == nil || !strings.Contains(err.Error(), "known-word coverage") {
		t.Fatalf("want rejection on coverage, got %v", err)
	}
	if st == nil || st.Validated {
		t.Fatalf("want the rejected candidate, not validated; got %+v", st)
	}
}
