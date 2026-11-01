package grammar_test

import (
	"context"
	"strings"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar/grammartest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// The だけ at N5 as imported from the catalogue.
var dake = refdata.GrammarPoint{
	ID: 1, Level: refdata.N5, Number: 10, Ordinal: 1,
	Pattern: "〜だけ", Romaji: "dake", Meaning: "just, only",
	Variants:           []string{"〜だけ"},
	NormalisedPattern:  "だけ",
	NormalisedVariants: []string{"だけ"},
}

// A fixed mini-dictionary of JMdict surface forms for the pure validation tests.
func memDict(words ...string) *grammartest.MemDictionary {
	return grammartest.NewMemDictionary(words...)
}

func candidate(sentence, translation string, start, end int, span string) grammar.Candidate {
	return grammar.Candidate{
		SentenceJA:  sentence,
		Translation: translation,
		SpanStart:   start,
		SpanEnd:     end,
		SpanText:    span,
	}
}

// runeOff finds [start,end) rune offsets of sub in s; fails the test when absent.
func runeOff(t *testing.T, s, sub string) (int, int) {
	t.Helper()
	i := strings.Index(s, sub)
	if i < 0 {
		t.Fatalf("%q not found in %q", sub, s)
	}
	start := len([]rune(s[:i]))
	return start, start + len([]rune(sub))
}

func validate(t *testing.T, dict grammar.Dictionary, point refdata.GrammarPoint, c grammar.Candidate) []grammar.Rejection {
	t.Helper()
	v := grammar.NewValidator(dict)
	rejs, err := v.Validate(context.Background(), point, c)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	return rejs
}

func wantRejections(t *testing.T, rejs []grammar.Rejection, reasons ...grammar.Reason) {
	t.Helper()
	got := map[grammar.Reason]bool{}
	for _, r := range rejs {
		got[r.Reason] = true
	}
	for _, want := range reasons {
		if !got[want] {
			t.Fatalf("rejections = %v, want %s among them", rejs, want)
		}
	}
	if len(rejs) != len(reasons) {
		t.Fatalf("got %d rejections %v, want exactly %d (%v)", len(rejs), rejs, len(reasons), reasons)
	}
}

func TestSentenceTooShortIsRejected(t *testing.T) {
	rejs := validate(t, memDict("ねこ"), dake, candidate("ねこ。", "Cat.", 0, 0, ""))
	wantRejections(t, rejs, grammar.ReasonTooShort)
}

func TestSentenceTooLongIsRejected(t *testing.T) {
	long := "ねこが " + strings.Repeat("かわいい ", 10) + "だけ。"
	rejs := validate(t, memDict("ねこ", "かわいい", "だけ"), dake, candidate(long, "Only cute cats.", 0, 0, ""))
	wantRejections(t, rejs, grammar.ReasonTooLong)
}

func TestMissingTranslationIsRejected(t *testing.T) {
	rejs := validate(t, memDict("これ", "だけ", "ください"), dake,
		candidate("これだけください。", "", 2, 4, "だけ"))
	wantRejections(t, rejs, grammar.ReasonNoTranslation)
}

func TestMarkdownWrappedSentenceIsRejected(t *testing.T) {
	rejs := validate(t, memDict("これ", "だけ", "ください"), dake,
		candidate("**これだけください。**", "Please give me only this.", 4, 6, "だけ"))
	wantRejections(t, rejs, grammar.ReasonDisallowedChars)
}

func TestQuotedOrParentheticalCommentaryIsRejected(t *testing.T) {
	rejs := validate(t, memDict("これ", "だけ", "ください"), dake,
		candidate(`"これだけください。(only this)"`, "Please give me only this.", 3, 5, "だけ"))
	wantRejections(t, rejs, grammar.ReasonDisallowedChars)
}

// --- span rules ---

func TestSpanTextMustMatchTheSliceItClaims(t *testing.T) {
	s := "これだけください。"
	start, end := runeOff(t, s, "だけ")
	rejs := validate(t, memDict("これ", "だけ", "ください"), dake, candidate(s, "Only this, please.", start, end, "これ"))
	wantRejections(t, rejs, grammar.ReasonSpanTextMismatch)
}

func TestSpanOutsideTheSentenceIsRejected(t *testing.T) {
	rejs := validate(t, memDict("これ", "だけ", "ください"), dake,
		candidate("これだけください。", "Only this, please.", 3, 99, "だけ"))
	wantRejections(t, rejs, grammar.ReasonSpanBounds)
}

// A span that lies on the pattern's span offsets but holds other words.
func TestSpanMustContainPartOfThePattern(t *testing.T) {
	s := "これだけください。"
	start, end := runeOff(t, s, "これ")
	rejs := validate(t, memDict("これ", "だけ", "ください"), dake, candidate(s, "Only this, please.", start, end, "これ"))
	wantRejections(t, rejs, grammar.ReasonSpanNotInPattern)
}

// --- tokenisation and dictionary membership ---

func TestUnknownWordIsRejected(t *testing.T) {
	// ぴかぽかをみた is gibberish: kagome reports it as one UNKNOWN token,
	// which no JMdict lookup can rescue.
	s := "ねこだけぴかぽかをみた。"
	start, end := runeOff(t, s, "だけ")
	rejs := validate(t, memDict("ねこ", "みる"), dake, candidate(s, "The cat only saw gibberish.", start, end, "だけ"))
	wantRejections(t, rejs, grammar.ReasonUnknownWord)
}

func TestValidSentenceIsAccepted(t *testing.T) {
	s := "これだけください。"
	start, end := runeOff(t, s, "だけ")
	rejs := validate(t, memDict("これ", "だけ", "ください"), dake, candidate(s, "Only this, please.", start, end, "だけ"))
	if len(rejs) != 0 {
		t.Fatalf("accepted sentence got rejections: %v", rejs)
	}
}

func TestInflectedVerbIsCheckedAgainstItsDictionaryForm(t *testing.T) {
	// たべた is the past of たべる. The dictionary holds only the dictionary form.
	s := "ねこがだけさかなをたべた。"
	start, end := runeOff(t, s, "だけ")
	if rejs := validate(t, memDict("ねこ", "さかな", "たべる"), dake, candidate(s, "The cat only ate fish.", start, end, "だけ")); len(rejs) != 0 {
		t.Fatalf("accepted sentence got rejections: %v", rejs)
	}
}

func TestPoliteInflectedVerbIsCheckedAgainstItsDictionaryForm(t *testing.T) {
	// みました splits into み+まし+た. The verb stem み is not a JMdict
	// headword, but its base form みる is, so the words pass; only the span
	// (ねこ, not on the pattern) is rejected.
	s := "ねこをみました。"
	start, end := runeOff(t, s, "ねこ")
	rejs := validate(t, memDict("ねこ", "みる"), dake, candidate(s, "I saw the cat.", start, end, "ねこ"))
	wantRejections(t, rejs, grammar.ReasonSpanNotInPattern)
}

func TestSpanMustLieOnTokenBoundaries(t *testing.T) {
	// The span cuts しまっ in half, which no tokenisation of the sentence produces.
	s := "ねこをてしまった。"
	start, end := runeOff(t, s, "てしま")
	rejs := validate(t, memDict("ねこ", "しまう"), teShimau, candidate(s, "I (regrettably) saw the cat.", start, end, "てしま"))
	wantRejections(t, rejs, grammar.ReasonSpanNotTokenised)
}

// An inflected span (てしまいました) that is not a literal variant of
// 〜てしまった still demonstrates it: the verbs' base forms match.
func TestInflectedSpanStillMatchesPattern(t *testing.T) {
	s := "ねこをてしまいました。"
	start, end := runeOff(t, s, "てしまいました")
	rejs := validate(t, memDict("ねこ", "しまう"), teShimau, candidate(s, "I regrettably did it with the cat.", start, end, "てしまいました"))
	if len(rejs) != 0 {
		t.Fatalf("accepted sentence got rejections: %v", rejs)
	}
}

// 〜てしまう as imported at N5.
var teShimau = refdata.GrammarPoint{
	ID: 2, Level: refdata.N5, Number: 42, Ordinal: 1,
	Pattern: "〜てしまった", Romaji: "te shimau", Meaning: "did (regrettably)",
	Variants:           []string{"〜てしまった"},
	NormalisedPattern:  "てしまった",
	NormalisedVariants: []string{"てしまった"},
}
