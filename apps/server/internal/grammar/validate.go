// Package grammar generates and checks the Grammar Catalogue's content
// (GLOSSARY.md): the explanation and the example sentences with their Grammar
// Spans (issue #8, ADR-0005).
package grammar

import (
	"context"
	"fmt"
	"strings"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// Rejection reasons for a candidate example sentence. Stable machine-readable
// codes; they appear in logs and in generation results.
type Reason string

const (
	ReasonTooShort         Reason = "too_short"
	ReasonTooLong          Reason = "too_long"
	ReasonDisallowedChars  Reason = "disallowed_characters"
	ReasonSpanBounds       Reason = "span_out_of_bounds"
	ReasonSpanTextMismatch Reason = "span_text_mismatch"
	ReasonSpanNotInPattern Reason = "span_not_in_pattern"
	ReasonUnknownWord      Reason = "unknown_word"
	ReasonSpanNotTokenised Reason = "span_not_in_tokenisation"
	ReasonNoTranslation    Reason = "missing_translation"
)

// Candidate is one example sentence as returned by the model. SpanStart/SpanEnd
// are rune offsets into SentenceJA.
type Candidate struct {
	SentenceJA  string
	Translation string
	SpanStart   int
	SpanEnd     int
	SpanText    string
}

// Rejection says why one candidate was not stored.
type Rejection struct {
	Reason Reason
	Detail string
}

func (r Rejection) String() string {
	if r.Detail == "" {
		return string(r.Reason)
	}
	return string(r.Reason) + ": " + r.Detail
}

// Dictionary reports whether a surface form exists in the JMdict reference
// data. Content words must be found here; particles and auxiliary forms go
// through the validator's allow-list instead.
type Dictionary interface {
	Known(ctx context.Context, surface string) (bool, error)
}

// Bounds for an accepted sentence, in runes.
const (
	minSentenceRunes = 5
	maxSentenceRunes = 40
)

// Validator checks candidate sentences against fixed rules and the reference
// data. It never trusts the model: everything is re-derived from SentenceJA.
type Validator struct {
	dict Dictionary
}

func NewValidator(dict Dictionary) *Validator { return &Validator{dict: dict} }

// disallowed reports the characters an example sentence must not contain:
// markdown markers, quotes, brackets/parentheses (used as commentary wrappers
// by chatty models) and control characters. Japanese punctuation such as 、。！？ is fine.
const disallowed = "*_#`~<>|[]()\"'「」『』（）“”‘’"

// Validate returns every rule the candidate breaks; an empty slice means the
// sentence is accepted. A non-nil error is a lookup failure (dictionary or
// database), not a rejection.
//
// The rules run in stages. When the surface rules (length, translation,
// forbidden characters) or the span basics (bounds, claimed text) fail, the
// deeper checks are skipped: a sentence that fails them is rejected for those
// reasons, and reading meaning out of its tokenisation would be noise.
func (v *Validator) Validate(ctx context.Context, point refdata.GrammarPoint, c Candidate) ([]Rejection, error) {
	var rejs []Rejection
	runes := []rune(c.SentenceJA)

	// Stage 1: surface rules.
	if len(runes) < minSentenceRunes {
		rejs = append(rejs, Rejection{Reason: ReasonTooShort, Detail: "sentence is shorter than 5 characters"})
	}
	if len(runes) > maxSentenceRunes {
		rejs = append(rejs, Rejection{Reason: ReasonTooLong, Detail: "sentence is longer than 40 characters"})
	}
	if strings.TrimSpace(c.Translation) == "" {
		rejs = append(rejs, Rejection{Reason: ReasonNoTranslation, Detail: "the English translation is empty"})
	}
	for _, r := range c.SentenceJA {
		if r < 0x20 || r == 0x7f || strings.ContainsRune(disallowed, r) {
			rejs = append(rejs, Rejection{
				Reason: ReasonDisallowedChars,
				Detail: fmt.Sprintf("sentence contains %q", string(r)),
			})
			break
		}
	}
	if len(rejs) > 0 {
		return rejs, nil
	}

	// Stage 2: the span as reported by the model.
	if c.SpanStart < 0 || c.SpanEnd > len(runes) || c.SpanStart >= c.SpanEnd {
		return []Rejection{{
			Reason: ReasonSpanBounds,
			Detail: fmt.Sprintf("span [%d,%d) is not a part of a %d-character sentence", c.SpanStart, c.SpanEnd, len(runes)),
		}}, nil
	}
	if string(runes[c.SpanStart:c.SpanEnd]) != c.SpanText {
		return []Rejection{{
			Reason: ReasonSpanTextMismatch,
			Detail: fmt.Sprintf("span [%d,%d) holds %q, not %q", c.SpanStart, c.SpanEnd, string(runes[c.SpanStart:c.SpanEnd]), c.SpanText),
		}}, nil
	}

	// Stage 3: tokenisation-backed rules.
	tokens, err := tokenise(c.SentenceJA)
	if err != nil {
		return nil, err
	}
	wordRejs, err := v.checkWords(ctx, tokens)
	if err != nil {
		return nil, err
	}
	rejs = append(rejs, wordRejs...)
	patternRejs, err := checkSpanPattern(c.SentenceJA, point, tokens, c.SpanStart, c.SpanEnd)
	if err != nil {
		return nil, err
	}
	rejs = append(rejs, patternRejs...)
	rejs = append(rejs, checkSpanTokenised(c.SpanStart, c.SpanEnd, tokens)...)
	return rejs, nil
}
