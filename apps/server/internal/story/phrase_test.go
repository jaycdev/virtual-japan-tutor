package story

import (
	"reflect"
	"testing"
	"unicode/utf8"
)

// Phrase detection (issue #97) is a pure function over a sentence's linked
// tokens, so these tests build tokens by hand. The ent_seq values are fixture
// ids, not JMdict data: the detector only cares whether a form is in the map.

// ptok is one test token: a surface and its ent_seq, or 0 for an unlinked token.
type ptok struct {
	surface string
	ent     int64
}

// buildPhraseTokens lays the surfaces out back to back and counts positions in
// runes, the same way kagome reports them.
func buildPhraseTokens(parts ...ptok) ([]Token, string) {
	var tokens []Token
	ja := ""
	for i, p := range parts {
		start := utf8.RuneCountInString(ja)
		ja += p.surface
		end := utf8.RuneCountInString(ja)
		t := Token{Pos: i, Surface: p.surface, Start: start, End: end}
		if p.ent != 0 {
			e := p.ent
			t.EntSeq = &e
		}
		tokens = append(tokens, t)
	}
	return tokens, ja
}

// formMap is a fake JMdict written-form index: form -> ent_seq.
func formMap(forms map[string]int64) func(string) (int64, bool) {
	return func(form string) (int64, bool) {
		v, ok := forms[form]
		return v, ok
	}
}

// phraseSpans returns the detected phrases as (start, end, ent_seq) triples
// for comparison; nil when there are none.
func phraseSpans(ps []Phrase) [][3]int64 {
	var out [][3]int64
	for _, p := range ps {
		out = append(out, [3]int64{int64(p.Start), int64(p.End), p.EntSeq})
	}
	return out
}

func TestFindPhrasesMergesKonoGoro(t *testing.T) {
	// この頃: この (連体詞) + 頃 (名詞) joined, span [0,3).
	tokens, ja := buildPhraseTokens(ptok{"この", 1000100}, ptok{"頃", 1000101}, ptok{"は", 0})
	got := findPhrases(tokens, ja, nil, formMap(map[string]int64{"この頃": 1000001}))
	want := [][3]int64{{0, 3, 1000001}}
	if !reflect.DeepEqual(phraseSpans(got), want) {
		t.Fatalf("findPhrases(この頃は) = %v, want %v", phraseSpans(got), want)
	}
}

func TestFindPhrasesMergesSonoToki(t *testing.T) {
	// その時: その + 時, span [0,3) in 「その時、雨が降った。」.
	tokens, ja := buildPhraseTokens(ptok{"その", 1000200}, ptok{"時", 1000201}, ptok{"、", 0}, ptok{"雨", 1000202})
	got := findPhrases(tokens, ja, nil, formMap(map[string]int64{"その時": 1000002}))
	want := [][3]int64{{0, 3, 1000002}}
	if !reflect.DeepEqual(phraseSpans(got), want) {
		t.Fatalf("findPhrases(その時、雨) = %v, want %v", phraseSpans(got), want)
	}
}

func TestFindPhrasesMergesIppaiSplitAsOneAndNoun(t *testing.T) {
	// 一杯 split as 一 + 杯 in 「コップ一杯の水」: the phrase is runes [3,5).
	tokens, ja := buildPhraseTokens(
		ptok{"コップ", 1000300}, ptok{"一", 1000301}, ptok{"杯", 1000302}, ptok{"の", 0}, ptok{"水", 1000303})
	got := findPhrases(tokens, ja, nil, formMap(map[string]int64{"一杯": 1000003}))
	want := [][3]int64{{3, 5, 1000003}}
	if !reflect.DeepEqual(phraseSpans(got), want) {
		t.Fatalf("findPhrases(コップ一杯の水) = %v, want %v", phraseSpans(got), want)
	}
}

func TestFindPhrasesSingleTokenIsNotAPhrase(t *testing.T) {
	// 一杯 kagome already keeps as one adverb in 「お茶を一杯飲んだ」: a phrase
	// needs two or more tokens, so nothing is reported.
	tokens, ja := buildPhraseTokens(ptok{"お茶", 1000400}, ptok{"を", 0}, ptok{"一杯", 1000401})
	got := findPhrases(tokens, ja, nil, formMap(map[string]int64{"一杯": 1000003}))
	if len(got) != 0 {
		t.Fatalf("findPhrases(お茶を一杯) = %v, want none", phraseSpans(got))
	}
}

func TestFindPhrasesRunThatIsNotAFormStaysUnmerged(t *testing.T) {
	// 猫 + 中 is a linked run, but 猫中 is not a JMdict written form.
	tokens, ja := buildPhraseTokens(ptok{"猫", 1000500}, ptok{"中", 1000501}, ptok{"に", 0})
	got := findPhrases(tokens, ja, nil, formMap(map[string]int64{"この頃": 1000001}))
	if len(got) != 0 {
		t.Fatalf("findPhrases(猫中に) = %v, want none", phraseSpans(got))
	}
}

func TestFindPhrasesUnlinkedParticleBreaksARun(t *testing.T) {
	// 一 + 杯 would form 一杯, but 杯 is unlinked (a particle-like token), so the
	// run never joins, even though the form is in the index.
	tokens, ja := buildPhraseTokens(ptok{"一", 1000600}, ptok{"杯", 0})
	got := findPhrases(tokens, ja, nil, formMap(map[string]int64{"一杯": 1000003}))
	if len(got) != 0 {
		t.Fatalf("findPhrases(一 + unlinked 杯) = %v, want none", phraseSpans(got))
	}
}

func TestFindPhrasesSkipsRunOverlappingGrammarSpan(t *testing.T) {
	// The grammar span [0,1) covers the first part of この頃, so the run is
	// skipped and Grammar Span wins.
	tokens, ja := buildPhraseTokens(ptok{"この", 1000100}, ptok{"頃", 1000101})
	spans := []Span{{Start: 0, End: 1, GrammarPointID: 7}}
	got := findPhrases(tokens, ja, spans, formMap(map[string]int64{"この頃": 1000001}))
	if len(got) != 0 {
		t.Fatalf("findPhrases with an overlapping grammar span = %v, want none", phraseSpans(got))
	}
}

func TestFindPhrasesLongestMatchWins(t *testing.T) {
	// その時 (2 tokens) is a prefix of その時々 (3 tokens): the longer form wins.
	tokens, ja := buildPhraseTokens(ptok{"その", 1000200}, ptok{"時", 1000201}, ptok{"々", 1000203})
	forms := map[string]int64{"その時": 1000002, "その時々": 1000020}
	got := findPhrases(tokens, ja, nil, formMap(forms))
	want := [][3]int64{{0, 4, 1000020}}
	if !reflect.DeepEqual(phraseSpans(got), want) {
		t.Fatalf("findPhrases(その時々) = %v, want %v", phraseSpans(got), want)
	}
}

func TestFindPhrasesScanContinuesAfterAPhrase(t *testing.T) {
	// この頃 and その時 are adjacent: both are found, in order.
	tokens, ja := buildPhraseTokens(
		ptok{"この", 1000100}, ptok{"頃", 1000101}, ptok{"その", 1000200}, ptok{"時", 1000201})
	forms := map[string]int64{"この頃": 1000001, "その時": 1000002}
	got := findPhrases(tokens, ja, nil, formMap(forms))
	want := [][3]int64{{0, 3, 1000001}, {3, 6, 1000002}}
	if !reflect.DeepEqual(phraseSpans(got), want) {
		t.Fatalf("findPhrases(この頃その時) = %v, want %v", phraseSpans(got), want)
	}
}

// linkedTok is one linked test token at an explicit rune range, for the cases
// buildPhraseTokens cannot express (a gap between tokens, a surface that does
// not match the text).
func linkedTok(pos int, surface string, start, end int, ent int64) Token {
	e := ent
	return Token{Pos: pos, Surface: surface, Start: start, End: end, EntSeq: &e}
}

func TestFindPhrasesNonContiguousTokensDoNotMerge(t *testing.T) {
	// 猫 [0,1) and 中 [2,3) are both linked and 猫中 is a form, but the の at
	// rune 1 belongs to no token, so the two tokens are not back to back.
	tokens := []Token{linkedTok(0, "猫", 0, 1, 1000500), linkedTok(1, "中", 2, 3, 1000501)}
	got := findPhrases(tokens, "猫の中", nil, formMap(map[string]int64{"猫中": 1000050}))
	if len(got) != 0 {
		t.Fatalf("findPhrases(猫 + gap + 中) = %v, want none", phraseSpans(got))
	}
}

func TestFindPhrasesSurfacesNotMatchingTheTextDoNotMerge(t *testing.T) {
	// 一 [0,1) and 杯 [1,2) are linked and back to back, and 一杯 is a form, but
	// the sentence text over [0,2) is 一つ, so the run does not spell 一杯.
	tokens := []Token{linkedTok(0, "一", 0, 1, 1000301), linkedTok(1, "杯", 1, 2, 1000302)}
	got := findPhrases(tokens, "一つ", nil, formMap(map[string]int64{"一杯": 1000003}))
	if len(got) != 0 {
		t.Fatalf("findPhrases(一 + 杯 over the text 一つ) = %v, want none", phraseSpans(got))
	}
}

func TestFindPhrasesMergesFourTokenForm(t *testing.T) {
	// 一生懸命 is four linked tokens that together form one entry, span [0,4).
	tokens, ja := buildPhraseTokens(ptok{"一", 1000701}, ptok{"生", 1000702}, ptok{"懸", 1000703}, ptok{"命", 1000704})
	got := findPhrases(tokens, ja, nil, formMap(map[string]int64{"一生懸命": 1000070}))
	want := [][3]int64{{0, 4, 1000070}}
	if !reflect.DeepEqual(phraseSpans(got), want) {
		t.Fatalf("findPhrases(一生懸命) = %v, want %v", phraseSpans(got), want)
	}
}
