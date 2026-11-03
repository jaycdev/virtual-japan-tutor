package story

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Regression for "no matter how many times I generate, it fails: the passage
// is 203 characters, want between 400 and 1200". The prompt asked for 400+
// characters in at most 8 sentences, i.e. ~50 characters per sentence, while a
// model writes ~25. It filled the sentence cap, landed near 200 characters,
// and a retry that only said "want 400" made it merge sentences instead.

// naturalSentenceRunes is a generous length for one learner-level Japanese
// sentence; the prompt's sentence range must make MinChars reachable at it.
const naturalSentenceRunes = 40

func TestPromptSentenceRangeMakesMinCharsReachable(t *testing.T) {
	req := baseRequest()
	prompt := userPrompt(req, req.Settings.WithDefaults())
	m := regexp.MustCompile(`into (\d+) to (\d+) sentences`).FindStringSubmatch(prompt)
	if m == nil {
		t.Fatal("prompt has no sentence range")
	}
	maxSentences, _ := strconv.Atoi(m[2])
	if got := MinChars / maxSentences; got > naturalSentenceRunes {
		t.Fatalf("prompt asks for %d+ characters in at most %d sentences: %d characters per sentence, more than a natural %d",
			MinChars, maxSentences, got, naturalSentenceRunes)
	}
	// The ask must clear the gate's floor with room to spare, since models
	// undershoot, and stay inside its ceiling.
	if PromptMinChars <= MinChars || PromptMaxChars > MaxChars {
		t.Fatalf("prompt length ask %d-%d does not sit above the gate floor %d and under the ceiling %d",
			PromptMinChars, PromptMaxChars, MinChars, MaxChars)
	}
	if !strings.Contains(prompt, fmt.Sprintf("%d to %d characters total", PromptMinChars, PromptMaxChars)) {
		t.Fatalf("prompt does not ask for %d-%d characters", PromptMinChars, PromptMaxChars)
	}
	if maxSentences > MaxSentences {
		t.Fatalf("prompt asks for up to %d sentences but the gate rejects more than %d", maxSentences, MaxSentences)
	}
	if schema := string(Schema().Schema); !strings.Contains(schema, fmt.Sprintf(`"maxItems":%d`, MaxSentences)) {
		t.Fatalf("schema sentence cap disagrees with MaxSentences (%d)", MaxSentences)
	}
}

func TestShortPassageIsRetriedWithActionableFeedback(t *testing.T) {
	// 2 sentences x 156 = 312 characters: 88 short of the floor.
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", cleanClause, cleanClause),
		fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}

	st, err := NewGenerator(cleanLookup()).Generate(context.Background(), client, req)
	if err != nil || !st.Validated {
		t.Fatalf("want validated on attempt 2, got err=%v", err)
	}
	var feedback string
	for _, m := range client.msgs[1] {
		if strings.Contains(m.Content, "characters, want between") {
			feedback = m.Content
		}
	}
	for _, want := range []string{"88 characters too short", "Rewrite it as", "separate"} {
		if !strings.Contains(feedback, want) {
			t.Errorf("retry feedback lacks %q:\n%s", want, feedback)
		}
	}
}

func TestSentenceCapAdmitsAMinimumLengthPassageOfNaturalSentences(t *testing.T) {
	// 16 sentences x 26 characters = 416: what a model writes when it
	// follows a sentence-count target.
	s := &Story{Text: strings.Repeat("あ", 416)}
	for i := 0; i < 16; i++ {
		s.Sentences = append(s.Sentences, Sentence{Pos: i, JA: strings.Repeat("あ", 26), EN: "x"})
	}
	for i := 0; i < 3; i++ {
		s.Questions = append(s.Questions, Question{Pos: i, PromptJA: "q", OptionsJA: []string{"a", "b"}})
	}
	if err := s.Validate(); err != nil {
		t.Fatalf("a 416-character, 16-sentence passage is rejected: %v", err)
	}
}
