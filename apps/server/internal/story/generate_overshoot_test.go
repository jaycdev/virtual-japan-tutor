package story

import (
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// Live, with a real account: a 256-character passage drew "add about 12 more
// sentences", and the model answered with 50 (then 49) very short ones; the gate
// rejected both for having more than 40 sentences though their length was in
// range. Later, length-only retries came back byte-identical (314, 314, 314,
// 314) because "make them longer" gave the model nothing concrete to change.
// The cap is only a sanity bound, and the hint now states exact targets.

func storyOfSentences(n, runesEach int) *Story {
	s := &Story{Text: strings.Repeat("あ", n*runesEach)}
	for i := 0; i < n; i++ {
		s.Sentences = append(s.Sentences, Sentence{Pos: i, JA: strings.Repeat("あ", runesEach), EN: "x"})
	}
	for i := 0; i < 3; i++ {
		s.Questions = append(s.Questions, Question{Pos: i, PromptJA: "q", OptionsJA: []string{"a", "b"}})
	}
	return s
}

func TestManyShortSentencesWithinTheLengthRangeAreAccepted(t *testing.T) {
	// 50 sentences x 10 characters = 500: in range, however many sentences.
	if err := storyOfSentences(50, 10).Validate(); err != nil {
		t.Fatalf("a 500-character passage of 50 sentences must pass the shape check: %v", err)
	}
	// ...but an absurd count is still refused as a sanity bound.
	if err := storyOfSentences(MaxSentences+1, 5).Validate(); err == nil || !strings.Contains(err.Error(), "sentences") {
		t.Fatalf("a passage of %d sentences should be refused as absurd, got %v", MaxSentences+1, err)
	}
}

func TestShortfallHintGivesExactTargets(t *testing.T) {
	rewrite := regexp.MustCompile(`Rewrite it as (\d+) sentences of at least (\d+) characters each, about (\d+) characters in total`)
	target := (MinChars + PromptMinChars) / 2 // a clear margin above the floor
	for _, c := range []struct {
		name         string
		n, each      int
		wantShort    string
		wantObserved string
	}{
		{"plenty of short sentences", 26, 10, "140 characters too short", "You wrote 26 sentences averaging 10 characters (260 in total)"},
		{"a few sentences", 4, 20, "320 characters too short", "You wrote 4 sentences averaging 20 characters (80 in total)"},
		{"just under the floor", 20, 19, "20 characters too short", "You wrote 20 sentences averaging 19 characters (380 in total)"},
		{"very short sentences", 3, 2, "394 characters too short", "You wrote 3 sentences averaging 2 characters (6 in total)"},
	} {
		t.Run(c.name, func(t *testing.T) {
			hint := shortfallHint(storyOfSentences(c.n, c.each))
			for _, want := range []string{c.wantShort, c.wantObserved, "separate entry"} {
				if !strings.Contains(hint, want) {
					t.Errorf("hint lacks %q:\n%s", want, hint)
				}
			}
			m := rewrite.FindStringSubmatch(hint)
			if m == nil {
				t.Fatalf("hint gives no exact target:\n%s", hint)
			}
			count, _ := strconv.Atoi(m[1])
			each, _ := strconv.Atoi(m[2])
			total, _ := strconv.Atoi(m[3])
			if count < 1 || count > PromptMaxSentences {
				t.Errorf("asks for %d sentences, outside 1..%d the prompt allows", count, PromptMaxSentences)
			}
			if each < 25 || each <= c.each {
				t.Errorf("asks for sentences of at least %d characters; they must be longer than the %d written, and at least 25", each, c.each)
			}
			if count*each < target || total != count*each {
				t.Errorf("targets %d x %d = %d (stated %d), want at least %d with the arithmetic stated honestly", count, each, count*each, total, target)
			}
		})
	}
}

func TestShortfallHintIsSilentOnceTheFloorIsMet(t *testing.T) {
	if hint := shortfallHint(storyOfSentences(20, MinChars/20)); hint != "" {
		t.Fatalf("a %d-character passage meets the floor, got hint %q", MinChars, hint)
	}
}
