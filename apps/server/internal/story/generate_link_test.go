package story

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/google/uuid"
)

// materialiseJA runs the generator's materialise over the given Japanese
// sentences (no Grammar Spans), with the lookup the test supplies.
func materialiseJA(t *testing.T, userID uuid.UUID, lookup VocabLookup, sentences ...string) *Story {
	t.Helper()
	var body struct {
		Sentences []fSent `json:"sentences"`
	}
	for _, ja := range sentences {
		body.Sentences = append(body.Sentences, fSent{JA: ja, GrammarSpans: []fSpan{}})
	}
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

// tokenNamed returns the first token of the sentence with the given surface.
func tokenNamed(t *testing.T, s *Story, sentence int, surface string) Token {
	t.Helper()
	for _, tok := range s.Sentences[sentence].Tokens {
		if tok.Surface == surface {
			return tok
		}
	}
	t.Fatalf("sentence %d has no token %q (tokens: %+v)", sentence, surface, s.Sentences[sentence].Tokens)
	return Token{}
}

// wordLookup links every word the regression cases use, each to its own
// entry, including the particles and the full stop, so a test can tell "not
// asked" apart from "asked and not linked".
func wordLookup() fakeLookup {
	words := []string{"この", "その", "頃", "時", "一", "杯", "一杯", "暑い", "水", "コップ", "お茶", "は", "。"}
	out := fakeLookup{}
	for i, w := range words {
		out[w] = VocabHit{EntSeq: int64(9100 + i), JA: w}
	}
	return out
}

// recordingLookup wraps a lookup and records every surface it is asked about.
type recordingLookup struct {
	inner fakeLookup
	asked map[string]bool
}

func (r *recordingLookup) Lookup(ctx context.Context, surface, base string) (VocabHit, bool, error) {
	if r.asked == nil {
		r.asked = map[string]bool{}
	}
	r.asked[surface] = true
	return r.inner.Lookup(ctx, surface, base)
}

// The words generation used to leave unlinked (the coverage gate skips them)
// must now carry a dictionary link, so the reader can look them up (issue
// #94). 一杯 is linked only when kagome reads it as one token.
func TestMaterialiseLinksWordsTheCoverageGateDoesNotCount(t *testing.T) {
	for _, tc := range []struct {
		name   string
		ja     string
		linked []string
	}{
		{"この頃 links both words", "この頃は暑い。", []string{"この", "頃"}},
		{"その時 links both words", "その時は暑い。", []string{"その", "時"}},
		{"一杯 is split into 一 and 杯", "一杯の水。", []string{"一", "杯"}},
		{"コップ一杯の水 links 一 and 杯", "コップ一杯の水。", []string{"一", "杯"}},
		{"一杯 read as one adverb is linked", "お茶を一杯飲んだ。", []string{"一杯"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := materialiseJA(t, uuid.New(), wordLookup(), tc.ja)
			for _, surface := range tc.linked {
				tok := tokenNamed(t, s, 0, surface)
				if tok.EntSeq == nil {
					t.Errorf("%q in %q is not linked, want an ent_seq so it can be looked up", surface, tc.ja)
				}
			}
		})
	}
}

// Particles, auxiliaries and symbols stay unlinked on purpose, and the lookup
// is never asked about them at all.
func TestMaterialiseLeavesParticlesAndSymbolsUnlinked(t *testing.T) {
	rec := &recordingLookup{inner: wordLookup()}
	s := materialiseJA(t, uuid.New(), rec, "この頃は暑い。")

	for _, surface := range []string{"は", "。"} {
		if tok := tokenNamed(t, s, 0, surface); tok.EntSeq != nil {
			t.Errorf("%q is linked to %d, want no link", surface, *tok.EntSeq)
		}
		if rec.asked[surface] {
			t.Errorf("the lookup was asked about %q, want it never asked for particles or symbols", surface)
		}
	}
}

// Linking more tokens must not move the coverage gate: only content words
// count, so in 「この頃は暑い。」 only 暑い is content, and この and 頃 are linked
// without being counted.
func TestMaterialiseCoverageFlagUnchanged(t *testing.T) {
	s := materialiseJA(t, uuid.New(), wordLookup(), "この頃は暑い。")

	for _, c := range []struct {
		surface string
		content bool
	}{
		{"この", false},
		{"頃", false},
		{"暑い", true},
	} {
		tok := tokenNamed(t, s, 0, c.surface)
		if tok.content != c.content {
			t.Errorf("%q content = %v, want %v", c.surface, tok.content, c.content)
		}
	}
	if tok := tokenNamed(t, s, 0, "この"); tok.EntSeq == nil {
		t.Error("この is not linked; it should be, while staying out of the coverage count")
	}
}

// A word repeated across sentences costs one lookup per surface, hit or miss.
func TestMaterialiseLooksUpARepeatedWordOnce(t *testing.T) {
	counting := &countingLookup{inner: wordLookup()}
	materialiseJA(t, uuid.New(), counting, "この頃は暑い。", "この頃は暑い。", "この頃は暑い。")

	for _, surface := range []string{"この", "頃", "暑い"} {
		if counting.counts[surface] != 1 {
			t.Errorf("lookup of %q called %d times, want 1", surface, counting.counts[surface])
		}
	}
}

// linkClause's その and 時 are linkable but not content words: the coverage gate
// must count the same whether or not they get a link.
const linkClause = "その時ねこはねこをみつけました。"

// The acceptance criterion of issue #94: linking non-content words leaves the
// gate's counts, verdict and error-ness identical for the same passage.
func TestGenerateGateCountsIgnoreLinksOnNonContentWords(t *testing.T) {
	run := func(lookup VocabLookup, known fakeKnown) (*Story, error) {
		client := &fakeChat{responses: [][]byte{fixture(t, "travel", linkClause, linkClause, linkClause, linkClause)}}
		req := baseRequest()
		req.Known = known
		return NewGenerator(lookup).Generate(context.Background(), client, req)
	}
	// Run 1: the lookup knows only the content words.
	plain, errPlain := run(cleanLookup(), fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}})
	// Run 2: the lookup also knows その and 時, and 時 is a Known Item.
	extended := cleanLookup()
	extended["その"] = VocabHit{EntSeq: 9201, JA: "その"}
	extended["時"] = VocabHit{EntSeq: 9202, JA: "時"}
	linked, errLinked := run(extended, fakeKnown{
		1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}, 9202: {IsKnown: true, SRSLevel: 3},
	})

	if (errPlain == nil) != (errLinked == nil) {
		t.Fatalf("error-ness differs: plain=%v linked=%v", errPlain, errLinked)
	}
	if plain == nil || linked == nil {
		t.Fatalf("Generate returned no story: plain=%v linked=%v", plain, linked)
	}
	if plain.ContentWords != linked.ContentWords || plain.KnownWords != linked.KnownWords ||
		plain.FocusItems != linked.FocusItems || plain.FocusHit != linked.FocusHit ||
		plain.Validated != linked.Validated {
		t.Fatalf("gate counts differ: plain content=%d known=%d focus=%d/%d validated=%v; linked content=%d known=%d focus=%d/%d validated=%v",
			plain.ContentWords, plain.KnownWords, plain.FocusHit, plain.FocusItems, plain.Validated,
			linked.ContentWords, linked.KnownWords, linked.FocusHit, linked.FocusItems, linked.Validated)
	}

	for _, surface := range []string{"その", "時"} {
		if tok := tokenNamed(t, plain, 0, surface); tok.EntSeq != nil {
			t.Errorf("run 1: %q is linked, but its lookup knows nothing of it", surface)
		}
		if tok := tokenNamed(t, linked, 0, surface); tok.EntSeq == nil {
			t.Errorf("run 2: %q is not linked, want its link", surface)
		}
	}
}

// formRecordingLookup records every (surface, dictionary form) pair it is asked.
type formRecordingLookup struct {
	inner fakeLookup
	forms [][2]string
}

func (f *formRecordingLookup) Lookup(ctx context.Context, surface, base string) (VocabHit, bool, error) {
	f.forms = append(f.forms, [2]string{surface, base})
	return f.inner.Lookup(ctx, surface, base)
}

// An inflected word is looked up by its dictionary form, not only by the
// surface kagome produced.
func TestMaterialiseLooksUpTheDictionaryForm(t *testing.T) {
	toks, err := tokenise("暑かった。")
	if err != nil {
		t.Fatalf("tokenise: %v", err)
	}
	wantSurface := ""
	for _, kt := range toks {
		if base, _ := kt.BaseForm(); base == "暑い" {
			wantSurface = kt.Surface
		}
	}
	if wantSurface == "" {
		t.Fatalf("kagome gave no 暑い dictionary form for 暑かった: %+v", toks)
	}

	rec := &formRecordingLookup{inner: fakeLookup{}}
	materialiseJA(t, uuid.New(), rec, "暑かった。")
	for _, f := range rec.forms {
		if f == [2]string{wantSurface, "暑い"} {
			return
		}
	}
	t.Errorf("lookups %v, want one for surface %q with dictionary form 暑い", rec.forms, wantSurface)
}
