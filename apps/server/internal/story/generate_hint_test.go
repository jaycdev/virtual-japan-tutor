package story

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// Issue #136: つく in ため息をつく means 吐く, but FindVocabulary answers with every
// entry that shares the reading, 着く first. Without a hint the token follows
// whichever entry the Learner knows, so a Learner who knows only 着く got the
// token tagged Known. The generator now states the intended word for kana-only
// tokens (word_hints) and the linker follows it.

const (
	tsukuEntSeq int64 = 9301 // 着く
	hakuEntSeq  int64 = 9302 // 吐く
	homophoneJA       = "ため息をつく。"
)

// homophoneLookup answers for つく with 着く as the primary entry and both
// entries that read つく as alternatives. The nouns of the sentence are linked
// too, so the coverage gate counts the sentence's content words as known
// whenever their entries are known.
func homophoneLookup() fakeLookup {
	alts := []VocabHit{
		{EntSeq: tsukuEntSeq, JA: "着く", Readings: []string{"つく"}},
		{EntSeq: hakuEntSeq, JA: "吐く", Readings: []string{"つく"}},
	}
	return fakeLookup{
		"つく":  {EntSeq: tsukuEntSeq, JA: "着く", Readings: []string{"つく"}, Alts: alts},
		"ため息": {EntSeq: 9303, JA: "ため息", Readings: []string{"ためいき"}},
		"ため":  {EntSeq: 9304, JA: "ため"},
		"息":   {EntSeq: 9305, JA: "息", Readings: []string{"いき"}},
	}
}

// fHint is one word_hints entry as the model writes it.
type fHint struct {
	Surface string `json:"surface"`
	Word    string `json:"word"`
}

// fHintSent is a sentence as the model writes it, word_hints included.
type fHintSent struct {
	JA           string  `json:"ja"`
	EN           string  `json:"en"`
	GrammarSpans []fSpan `json:"grammar_spans"`
	WordHints    []fHint `json:"word_hints"`
}

// materialiseWithHints runs materialise over one sentence carrying the given
// word hints, with the lookup the test supplies.
func materialiseWithHints(t *testing.T, userID uuid.UUID, lookup VocabLookup, ja string, hints ...fHint) *Story {
	t.Helper()
	var body struct {
		Sentences []fHintSent `json:"sentences"`
	}
	body.Sentences = []fHintSent{{JA: ja, GrammarSpans: []fSpan{}, WordHints: hints}}
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var raw storyJSON
	if err := json.Unmarshal(b, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	s, err := NewGenerator(lookup).materialise(context.Background(), &raw, Request{UserID: userID})
	if err != nil {
		t.Fatalf("materialise: %v", err)
	}
	return s
}

// tagWithKnown runs tagKnown over a materialised story for the given Known Items.
func tagWithKnown(t *testing.T, s *Story, owner uuid.UUID, lookup VocabLookup, known fakeKnown) {
	t.Helper()
	if err := NewGenerator(lookup).tagKnown(context.Background(), s, Request{UserID: owner, Known: known}); err != nil {
		t.Fatalf("tagKnown: %v", err)
	}
}

// With the hint 吐く, a Learner who knows only 着く must not get つく tagged
// Known: the token links to 吐く and stays unknown.
func TestHintLinksKanaTokenToHintedEntryEvenWhenLearnerKnowsOnlyOtherSense(t *testing.T) {
	owner := uuid.New()
	lookup := homophoneLookup()
	s := materialiseWithHints(t, owner, lookup, homophoneJA, fHint{Surface: "つく", Word: "吐く"})
	tagWithKnown(t, s, owner, lookup, fakeKnown{tsukuEntSeq: {IsKnown: true, SRSLevel: 5}})

	got := tokenNamed(t, s, 0, "つく")
	if got.EntSeq == nil || *got.EntSeq != hakuEntSeq || got.Dictionary != "吐く" {
		t.Fatalf("つく linked to %v %q, want the hinted entry 吐く (%d)", got.EntSeq, got.Dictionary, hakuEntSeq)
	}
	if got.Tag != TagUnknown || got.SRSLevel != nil {
		t.Fatalf("つく tag=%q srs=%v, want unknown with no SRS level", got.Tag, got.SRSLevel)
	}
}

// When the Learner knows the hinted entry, the token is Known with that
// entry's SRS Level, even if they also know the other sense.
func TestHintTagsKanaTokenKnownWhenHintedEntryIsKnown(t *testing.T) {
	for _, tc := range []struct {
		name  string
		known fakeKnown
	}{
		{"knows only 吐く", fakeKnown{hakuEntSeq: {IsKnown: true, SRSLevel: 4}}},
		{"knows 着く and 吐く", fakeKnown{tsukuEntSeq: {IsKnown: true, SRSLevel: 5}, hakuEntSeq: {IsKnown: true, SRSLevel: 4}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			owner := uuid.New()
			lookup := homophoneLookup()
			s := materialiseWithHints(t, owner, lookup, homophoneJA, fHint{Surface: "つく", Word: "吐く"})
			tagWithKnown(t, s, owner, lookup, tc.known)

			got := tokenNamed(t, s, 0, "つく")
			if got.EntSeq == nil || *got.EntSeq != hakuEntSeq {
				t.Fatalf("つく linked to %v, want the hinted entry 吐く", got.EntSeq)
			}
			if got.Tag != TagKnown || got.SRSLevel == nil || *got.SRSLevel != 4 {
				t.Fatalf("つく tag=%q srs=%v, want known at SRS level 4", got.Tag, got.SRSLevel)
			}
		})
	}
}

// Tokens without a hint behave exactly as before: the Learner's known entry
// of the spelling decides, first the primary entry, then the alternatives.
func TestWithoutHintKanaTokenFollowsKnownEntry(t *testing.T) {
	for _, tc := range []struct {
		name    string
		known   fakeKnown
		wantSeq int64
		level   int
	}{
		{"knows 着く", fakeKnown{tsukuEntSeq: {IsKnown: true, SRSLevel: 5}}, tsukuEntSeq, 5},
		{"knows only 吐く", fakeKnown{hakuEntSeq: {IsKnown: true, SRSLevel: 4}}, hakuEntSeq, 4},
	} {
		t.Run(tc.name, func(t *testing.T) {
			owner := uuid.New()
			lookup := homophoneLookup()
			s := materialiseJA(t, owner, lookup, homophoneJA)
			tagWithKnown(t, s, owner, lookup, tc.known)

			got := tokenNamed(t, s, 0, "つく")
			if got.EntSeq == nil || *got.EntSeq != tc.wantSeq || got.Tag != TagKnown || got.SRSLevel == nil || *got.SRSLevel != tc.level {
				t.Fatalf("つく = seq %v tag %q srs %v, want seq %d known at level %d", got.EntSeq, got.Tag, got.SRSLevel, tc.wantSeq, tc.level)
			}
		})
	}
}

// A hint that names none of the token's entries is untrusted model output and
// is ignored: the token keeps today's behaviour.
func TestHintMatchingNoEntryIsIgnored(t *testing.T) {
	owner := uuid.New()
	lookup := homophoneLookup()

	s := materialiseWithHints(t, owner, lookup, homophoneJA, fHint{Surface: "つく", Word: "突く"})
	tagWithKnown(t, s, owner, lookup, fakeKnown{tsukuEntSeq: {IsKnown: true, SRSLevel: 5}})
	if got := tokenNamed(t, s, 0, "つく"); got.EntSeq == nil || *got.EntSeq != tsukuEntSeq || got.Tag != TagKnown {
		t.Fatalf("with an unmatched hint and 着く known: つく = seq %v tag %q, want known 着く", got.EntSeq, got.Tag)
	}

	s = materialiseWithHints(t, owner, lookup, homophoneJA, fHint{Surface: "つく", Word: "突く"})
	tagWithKnown(t, s, owner, lookup, fakeKnown{})
	if got := tokenNamed(t, s, 0, "つく"); got.EntSeq == nil || *got.EntSeq != tsukuEntSeq || got.Tag != TagUnknown {
		t.Fatalf("with an unmatched hint and nothing known: つく = seq %v tag %q, want unknown on the primary 着く", got.EntSeq, got.Tag)
	}
}

// A hint for a surface the sentence does not contain is not carried to any
// token, so the token follows the known entry as it did before.
func TestHintForSurfaceNotInSentenceIsIgnored(t *testing.T) {
	owner := uuid.New()
	lookup := homophoneLookup()
	s := materialiseWithHints(t, owner, lookup, homophoneJA, fHint{Surface: "はな", Word: "花"})

	if got := tokenNamed(t, s, 0, "つく"); got.hint != "" {
		t.Fatalf("つく carries hint %q from a surface that is not in the sentence", got.hint)
	}
	tagWithKnown(t, s, owner, lookup, fakeKnown{tsukuEntSeq: {IsKnown: true, SRSLevel: 5}})
	if got := tokenNamed(t, s, 0, "つく"); got.EntSeq == nil || *got.EntSeq != tsukuEntSeq || got.Tag != TagKnown {
		t.Fatalf("つく = seq %v tag %q, want known 着く", got.EntSeq, got.Tag)
	}
}

// Hints only apply to kana-only tokens. A token whose surface contains kanji
// never takes one, even when a hint names its surface.
func TestHintOnKanjiTokenIsIgnored(t *testing.T) {
	s := materialiseWithHints(t, uuid.New(), homophoneLookup(), homophoneJA,
		fHint{Surface: "ため息", Word: "溜め息"}, fHint{Surface: "息", Word: "いき"})

	kanji := 0
	for _, tok := range s.Sentences[0].Tokens {
		if !hasKanji(tok.Surface) {
			continue
		}
		kanji++
		if tok.hint != "" {
			t.Errorf("kanji token %q carries hint %q, want none", tok.Surface, tok.hint)
		}
	}
	if kanji == 0 {
		t.Fatalf("sentence %q has no kanji token to check (tokens: %+v)", homophoneJA, s.Sentences[0].Tokens)
	}
}

// The hint reaches the token it names, and only that token.
func TestHintIsCarriedToTheKanaTokenItNames(t *testing.T) {
	s := materialiseWithHints(t, uuid.New(), homophoneLookup(), homophoneJA, fHint{Surface: "つく", Word: "吐く"})
	if got := tokenNamed(t, s, 0, "つく"); got.hint != "吐く" {
		t.Fatalf("つく hint = %q, want 吐く", got.hint)
	}
	for _, tok := range s.Sentences[0].Tokens {
		if tok.Surface != "つく" && tok.hint != "" {
			t.Errorf("token %q carries hint %q, want none", tok.Surface, tok.hint)
		}
	}
}

// The coverage gate counts the corrected tag: a hinted つく the Learner does
// not know is an unknown content word, so the passage is rejected and the
// retry feedback names the hinted word 吐く. The same passage without the hint
// validates, because つく then follows the known 着く.
func TestGenerateGateSeesHintedKanaWordAsUnknown(t *testing.T) {
	gen := func(known fakeKnown, hinted bool) (*Story, error) {
		hints := []fHint(nil)
		if hinted {
			hints = []fHint{{Surface: "つく", Word: "吐く"}}
		}
		client := &fakeChat{responses: [][]byte{hintedFixture(t, homophoneJA, hints, 4)}}
		req := baseRequest()
		req.Settings.MaxAttempts = 1
		req.Known = known
		return NewGenerator(homophoneLookup()).Generate(context.Background(), client, req)
	}
	learnerKnowsSpellings := fakeKnown{9303: {IsKnown: true, SRSLevel: 3}, 9304: {IsKnown: true, SRSLevel: 3}, 9305: {IsKnown: true, SRSLevel: 3}}
	withTsuku := fakeKnown{tsukuEntSeq: {IsKnown: true, SRSLevel: 5}}
	for k, v := range learnerKnowsSpellings {
		withTsuku[k] = v
	}

	st, err := gen(withTsuku, true)
	if err == nil || st == nil || st.Validated || !strings.Contains(err.Error(), "吐く") {
		t.Fatalf("hinted つく with only 着く known: want rejection naming 吐く, got validated=%v err=%v", st != nil && st.Validated, err)
	}

	st, err = gen(withTsuku, false)
	if err != nil || st == nil || !st.Validated {
		t.Fatalf("unhinted つく follows the known 着く: want validated, got %v", err)
	}
}

// hintedFixture is a scripted model reply: n sentences of clause, each carrying
// the given word hints, and the three questions every reply needs.
func hintedFixture(t *testing.T, clause string, hints []fHint, n int) []byte {
	t.Helper()
	out := struct {
		Title     string      `json:"title"`
		TitleEN   string      `json:"title_en"`
		Theme     string      `json:"theme"`
		Genre     string      `json:"genre"`
		Sentences []fHintSent `json:"sentences"`
		Questions []fQ        `json:"questions"`
	}{Title: "ためいき", TitleEN: "A Sigh", Theme: "Sighs", Genre: "travel"}
	for i := 0; i < n; i++ {
		// 20 repetitions keep the passage inside the length rule (400 to 1200
		// characters in total) with the short clause.
		out.Sentences = append(out.Sentences, fHintSent{JA: sentence(20, clause), EN: "She sighed.", GrammarSpans: []fSpan{}, WordHints: hints})
	}
	for i := 0; i < 3; i++ {
		out.Questions = append(out.Questions, fQ{PromptJA: "ためいき？", OptionsJA: []string{"はい", "いいえ"}, AnswerIdx: 0})
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("fixture: %v", err)
	}
	return b
}

// The model's reply shape carries word_hints per sentence.
func TestStoryJSONParsesWordHints(t *testing.T) {
	reply := `{"title":"t","sentences":[{"ja":"ため息をつく。","en":"x","grammar_spans":[],"word_hints":[{"surface":"つく","word":"吐く"}]}]}`
	var raw storyJSON
	if err := json.Unmarshal([]byte(reply), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	hints := raw.Sentences[0].WordHints
	if len(hints) != 1 || hints[0].Surface != "つく" || hints[0].Word != "吐く" {
		t.Fatalf("word_hints = %+v, want one hint つく -> 吐く", hints)
	}
}

// The schema asks for word_hints on every sentence, in strict mode: listed as
// required, each entry closed with exactly surface and word. The prompt names
// the field so the model knows to fill it.
func TestStorySchemaDeclaresWordHints(t *testing.T) {
	type object struct {
		Properties           map[string]json.RawMessage `json:"properties"`
		Required             []string                   `json:"required"`
		AdditionalProperties *bool                      `json:"additionalProperties"`
	}
	var schema struct {
		Properties struct {
			Sentences struct {
				Items object `json:"items"`
			} `json:"sentences"`
		} `json:"properties"`
	}
	if err := json.Unmarshal([]byte(storySchemaJSON), &schema); err != nil {
		t.Fatalf("schema JSON: %v", err)
	}
	sentence := schema.Properties.Sentences.Items
	raw, ok := sentence.Properties["word_hints"]
	if !ok {
		t.Fatal("sentence schema has no word_hints property")
	}
	if !containsString(sentence.Required, "word_hints") {
		t.Errorf("sentence required = %v, want word_hints listed (strict mode needs every property required)", sentence.Required)
	}

	var hints struct {
		Type  string `json:"type"`
		Items object `json:"items"`
	}
	if err := json.Unmarshal(raw, &hints); err != nil {
		t.Fatalf("word_hints schema: %v", err)
	}
	if hints.Type != "array" {
		t.Errorf("word_hints type = %q, want array", hints.Type)
	}
	for _, k := range []string{"surface", "word"} {
		if _, ok := hints.Items.Properties[k]; !ok || !containsString(hints.Items.Required, k) {
			t.Errorf("word_hints item must have %q as a required property", k)
		}
	}
	if hints.Items.AdditionalProperties == nil || *hints.Items.AdditionalProperties {
		t.Error("word_hints item must set additionalProperties to false")
	}
	if !strings.Contains(userPrompt(baseRequest(), Settings{}), `"word_hints"`) {
		t.Error("the prompt's Return JSON shape does not mention word_hints")
	}
}
