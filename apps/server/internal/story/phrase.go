package story

// maxPhraseTokens bounds a Phrase's length: kagome splits the compounds this
// layer exists for (この頃, その時, 一杯) into two or three morphemes, and four
// leaves room for a three-part form without matching long runs by accident.
const maxPhraseTokens = 4

// findPhrases detects the Phrases of one sentence (issue #97), pure so it can
// be tested without a database. tokens are the sentence's stored tokens in
// position order, ja is the sentence text, spans are its Grammar Spans, and
// formEntSeq reports the JMdict entry of a written form (kanji or kana).
//
// Scanning left to right, at each token it tries run lengths from
// maxPhraseTokens down to two and keeps the first (longest) run that is a
// Phrase; after a match the scan resumes past the run, otherwise it moves one
// token on. A run is a Phrase only when every token in it is linked (EntSeq
// set, so particles and other unlinked tokens never join), the tokens are
// contiguous and their surfaces spell the sentence's text over that range, and
// the spelling is a JMdict form. A run overlapping a Grammar Span is skipped,
// so the Grammar Span keeps its tokens and a shorter run may still match.
//
// The returned phrases carry Start, End and EntSeq only; the caller fills in
// the headword and gloss.
func findPhrases(tokens []Token, ja string, spans []Span, formEntSeq func(form string) (int64, bool)) []Phrase {
	var out []Phrase
	for i := 0; i < len(tokens); {
		matched := false
		for n := min(maxPhraseTokens, len(tokens)-i); n >= 2; n-- {
			run := tokens[i : i+n]
			start, end := run[0].Start, run[n-1].End
			if overlapsAnySpan(start, end, spans) {
				continue
			}
			form, ok := runForm(run, ja)
			if !ok {
				continue
			}
			ent, ok := formEntSeq(form)
			if !ok {
				continue
			}
			out = append(out, Phrase{Start: start, End: end, EntSeq: ent})
			i += n
			matched = true
			break
		}
		if !matched {
			i++
		}
	}
	return out
}

// runForm returns the written form a run spells, and whether the run is a
// candidate at all: every token linked, the tokens back to back, and their
// surfaces equal the sentence text over the run's range.
func runForm(run []Token, ja string) (string, bool) {
	form := ""
	for k, t := range run {
		if t.EntSeq == nil {
			return "", false
		}
		if k > 0 && run[k-1].End != t.Start {
			return "", false
		}
		form += t.Surface
	}
	if form != runeSlice(ja, run[0].Start, run[len(run)-1].End) {
		return "", false
	}
	return form, true
}

// overlapsAnySpan reports whether rune range [start,end) overlaps any of the
// spans. Touching ranges do not overlap, as for coveringSpan in the reader.
func overlapsAnySpan(start, end int, spans []Span) bool {
	for _, sp := range spans {
		if start < sp.End && sp.Start < end {
			return true
		}
	}
	return false
}
