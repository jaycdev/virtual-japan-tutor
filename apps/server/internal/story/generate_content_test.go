package story

import "testing"

// Live, coverage stalled at 92-94% with れる in the "unknown" list of every
// stalled run. れる (passive/potential) is a verb suffix; さん, こと, の, よう,
// はず are suffix and formal nouns. They are grammar, not vocabulary: the model
// cannot "replace" them, and each one cost about 1% of the 95% bar.

func TestGrammaticalSuffixesAndFormalNounsAreNotVocabulary(t *testing.T) {
	cases := []struct {
		sentence string
		content  map[string]bool // surface -> must (not) count as a content word
	}{
		{"友達さんが先生に叱られることを話した。", map[string]bool{
			"友達": true, "先生": true, "叱ら": true, "話し": true,
			"さん": false, "れる": false, "こと": false,
		}},
		{"彼は泣いている。", map[string]bool{"彼": true, "泣い": true, "いる": false}},
		{"彼女がここに来るはずだ。", map[string]bool{"彼女": true, "来る": true, "はず": false}},
		{"私たちは静かな部屋で本を読んだ。", map[string]bool{
			"私": true, "静か": true, "部屋": true, "本": true, "読ん": true, "たち": false,
		}},
	}
	for _, c := range cases {
		toks, err := tokenise(c.sentence)
		if err != nil {
			t.Fatal(err)
		}
		seen := map[string]bool{}
		for _, tok := range toks {
			want, asked := c.content[tok.Surface]
			if !asked {
				continue
			}
			seen[tok.Surface] = true
			if got := isContent(tok); got != want {
				t.Errorf("%q: isContent(%q) = %v, want %v (POS %v)", c.sentence, tok.Surface, got, want, tok.POS())
			}
		}
		for surface := range c.content {
			if !seen[surface] {
				t.Errorf("%q: the tokenizer produced no token %q; adjust the test's expectations", c.sentence, surface)
			}
		}
	}
}
