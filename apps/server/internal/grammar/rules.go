package grammar

import (
	"context"
	"fmt"
	"strings"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// This file holds the tokenisation-backed rules: every content word of the
// sentence must exist in the reference data, the Grammar Span must hold part
// of the point's pattern, and the span must lie on token boundaries.

// posExempt are POS categories treated as grammatical glue: particles,
// auxiliaries, conjunctions, adverbs and the like never go through the JMdict
// check. Nouns, verbs and adjectives do.
var posExempt = map[string]bool{
	"助詞": true, "助動詞": true, "接続詞": true, "副詞": true, "連体詞": true,
	"感動詞": true, "接頭詞": true, "記号": true, "補助記号": true, "空白": true,
}

// posCategory returns the outermost POS element of a token, "" when absent.
func posCategory(t Token) string {
	if len(t.POS) == 0 {
		return ""
	}
	return t.POS[0]
}

// posSubCategory returns the second POS element, "" when absent.
func posSubCategory(t Token) string {
	if len(t.POS) < 2 {
		return ""
	}
	return t.POS[1]
}

// isContent reports whether a token's vocabulary must be found in JMdict.
// Numerals (名詞,数) are exempt: JMdict is not a number list.
func isContent(t Token) bool {
	switch posCategory(t) {
	case "名詞", "動詞", "形容詞":
		return posSubCategory(t) != "数"
	default:
		return false
	}
}

// checkWords rejects content tokens that neither appear in JMdict as written
// nor as their dictionary form. A token the morphological dictionary itself
// does not know (no Base) is judged by its surface alone.
func (v *Validator) checkWords(ctx context.Context, tokens []Token) ([]Rejection, error) {
	var rejs []Rejection
	for _, t := range tokens {
		if !isContent(t) {
			continue
		}
		known, err := v.dict.Known(ctx, t.Surface)
		if err != nil {
			return nil, err
		}
		if !known && t.Base != "" && t.Base != t.Surface {
			known, err = v.dict.Known(ctx, t.Base)
			if err != nil {
				return nil, err
			}
		}
		if !known {
			word := t.Surface
			if t.Base != "" && t.Base != t.Surface {
				word += " (" + t.Base + ")"
			}
			rejs = append(rejs, Rejection{
				Reason: ReasonUnknownWord,
				Detail: fmt.Sprintf("%q is not in JMdict", word),
			})
		}
	}
	return rejs, nil
}

// baseFormSeq projects tokens to their dictionary forms, dropping
// punctuation-like tokens; it is what pattern matching compares.
func baseFormSeq(tokens []Token) []string {
	var out []string
	for _, t := range tokens {
		if posCategory(t) == "" || posCategory(t) == "記号" || posCategory(t) == "補助記号" || posCategory(t) == "空白" {
			continue
		}
		if t.Base != "" {
			out = append(out, t.Base)
		} else {
			out = append(out, t.Surface)
		}
	}
	return out
}

// isSubseq reports whether needle appears in hay in order, not necessarily
// contiguously ("てしまう" is fulfilled by "て・しまう・ます").
func isSubseq(needle, hay []string) bool {
	i := 0
	for _, h := range hay {
		if i < len(needle) && needle[i] == h {
			i++
		}
	}
	return i == len(needle)
}

// checkSpanPattern rejects a span that holds no part of the Grammar Point.
// A span matches a normalised variant when one contains the other, or when
// the variant's dictionary-form sequence is fulfilled in order by the span —
// which lets an inflected span (てしまいました) match its pattern (てしまった).
func checkSpanPattern(sentence string, point refdata.GrammarPoint, tokens []Token, start, end int) ([]Rejection, error) {
	variants := point.NormalisedVariants
	if len(variants) == 0 && point.NormalisedPattern != "" {
		variants = []string{point.NormalisedPattern}
	}
	spanTokens := make([]Token, 0, len(tokens))
	for _, t := range tokens {
		if t.Start < end && t.End > start { // overlaps the span
			spanTokens = append(spanTokens, t)
		}
	}
	spanSeq := baseFormSeq(spanTokens)
	span := spanText(sentence, start, end)
	for _, variant := range variants {
		if strings.Contains(span, variant) || strings.Contains(variant, span) {
			return nil, nil
		}
		variantTokens, err := tokenise(variant)
		if err != nil {
			return nil, err
		}
		variantSeq := baseFormSeq(variantTokens)
		if len(variantSeq) > 0 && isSubseq(variantSeq, spanSeq) {
			return nil, nil
		}
	}
	return []Rejection{{
		Reason: ReasonSpanNotInPattern,
		Detail: fmt.Sprintf("span %q does not match any variant of %q", span, point.Pattern),
	}}, nil
}

func spanText(sentence string, start, end int) string {
	return string([]rune(sentence)[start:end])
}

// checkSpanTokenised rejects a span whose rune offsets do not line up with a
// run of whole tokens: some token must start exactly at the span start and a
// later one must end exactly at the span end. (kagome reports Start/End as
// rune offsets, the same unit the API uses for spans.)
func checkSpanTokenised(start, end int, tokens []Token) []Rejection {
	for i, t := range tokens {
		if t.Start != start {
			continue
		}
		for j := i; j < len(tokens); j++ {
			if tokens[j].End == end {
				return nil
			}
			if tokens[j].End > end {
				break
			}
		}
		break
	}
	return []Rejection{{
		Reason: ReasonSpanNotTokenised,
		Detail: fmt.Sprintf("span [%d,%d) cuts across word boundaries", start, end),
	}}
}
