package story

import (
	"context"
	"strings"
	"testing"
)

// Live, with a real MaruMori account, 6 of 9 "unknown" spellings were words the
// learner knows, linked to the wrong dictionary entry: いる (to be) to 射る (to
// shoot), よう to 酔う, こと to 琴, の to 乃. The lookup took the first entry
// for a spelling and the gate asked only about that one, so coverage sat at
// 87% against a 95% bar. A spelling now counts as known when the learner
// knows ANY entry that shares it.

// homographLookup makes ほん ambiguous: entry 3 (穂, the first hit) and the
// alternatives the dictionary also holds for the spelling.
func homographLookup(alts ...VocabHit) fakeLookup {
	l := cleanLookup()
	l["ほん"] = VocabHit{EntSeq: 3, JA: "穂", Alts: append([]VocabHit{{EntSeq: 3, JA: "穂"}}, alts...)}
	return l
}

func homographRequest(known fakeKnown) Request {
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = known
	return req
}

func dirtyFixture(t *testing.T) []byte {
	return fixture(t, "travel", dirtyClause, dirtyClause, dirtyClause, dirtyClause)
}

func TestSpellingIsKnownWhenAnyMatchingEntryIsKnown(t *testing.T) {
	known := fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}, 4: {IsKnown: true, SRSLevel: 6}}
	client := &fakeChat{responses: [][]byte{dirtyFixture(t)}}

	st, err := NewGenerator(homographLookup(VocabHit{EntSeq: 4, JA: "本"})).Generate(context.Background(), client, homographRequest(known))
	if err != nil || !st.Validated {
		t.Fatalf("ほん is known under entry 4 (本), so the passage must pass coverage: %v", err)
	}
	if st.KnownWords != st.ContentWords {
		t.Fatalf("known=%d content=%d, want every content word known", st.KnownWords, st.ContentWords)
	}
	var seen bool
	for _, sen := range st.Sentences {
		for _, tok := range sen.Tokens {
			if tok.Surface != "ほん" {
				continue
			}
			seen = true
			if tok.EntSeq == nil || *tok.EntSeq != 4 || tok.Tag != TagKnown || tok.Dictionary != "本" || tok.SRSLevel == nil || *tok.SRSLevel != 6 {
				t.Fatalf("ほん token = %+v, want linked to the known entry 4 (本) with its SRS level", tok)
			}
		}
	}
	if !seen {
		t.Fatal("fixture has no ほん token")
	}
	// The Story's vocabulary list follows the token's final entry: 本, known,
	// and not the entry the lookup returned first.
	var has3, has4 bool
	for _, v := range st.VocabItems {
		has3 = has3 || v.EntSeq == 3
		if v.EntSeq == 4 {
			has4 = true
			if !v.IsKnown || v.JA != "本" {
				t.Fatalf("vocab item for entry 4 = %+v, want known 本", v)
			}
		}
	}
	if has3 || !has4 {
		t.Fatalf("vocab items %+v, want entry 4 and not entry 3", st.VocabItems)
	}
}

func TestSpellingStaysUnknownWhenNoMatchingEntryIsKnown(t *testing.T) {
	known := fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}
	client := &fakeChat{responses: [][]byte{dirtyFixture(t)}}

	st, err := NewGenerator(homographLookup(VocabHit{EntSeq: 4, JA: "本"})).Generate(context.Background(), client, homographRequest(known))
	if err == nil || st == nil || st.Validated || !strings.Contains(err.Error(), "known-word coverage") {
		t.Fatalf("no entry for ほん is known, so coverage must reject it: %v", err)
	}
	if !strings.Contains(err.Error(), "穂") {
		t.Fatalf("the feedback should name the word (as its first entry): %v", err)
	}
}

func TestKnownPrimaryEntryWinsOverKnownAlternatives(t *testing.T) {
	known := fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}, 3: {IsKnown: true, SRSLevel: 7}, 4: {IsKnown: true, SRSLevel: 6}}
	client := &fakeChat{responses: [][]byte{dirtyFixture(t)}}

	st, err := NewGenerator(homographLookup(VocabHit{EntSeq: 4, JA: "本"})).Generate(context.Background(), client, homographRequest(known))
	if err != nil {
		t.Fatal(err)
	}
	for _, sen := range st.Sentences {
		for _, tok := range sen.Tokens {
			if tok.Surface == "ほん" && (tok.EntSeq == nil || *tok.EntSeq != 3) {
				t.Fatalf("a known first entry must stay linked, got %+v", tok)
			}
		}
	}
}

func TestFocusWordIsPreferredAmongKnownAlternatives(t *testing.T) {
	// Entries 4 and 5 are both known; 5 is a Focus Set word, so the token
	// links to 5 and the Story covers that focus item.
	known := fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}, 4: {IsKnown: true, SRSLevel: 6}, 5: {IsKnown: true, SRSLevel: 2}}
	client := &fakeChat{responses: [][]byte{dirtyFixture(t)}}
	req := homographRequest(known)
	req.Focus = FocusSet{Vocab: []VocabFocus{{EntSeq: 5}}}

	st, err := NewGenerator(homographLookup(VocabHit{EntSeq: 4, JA: "本"}, VocabHit{EntSeq: 5, JA: "盆"})).Generate(context.Background(), client, req)
	if err != nil || !st.Validated {
		t.Fatalf("want validated: %v", err)
	}
	if st.FocusItems != 1 || st.FocusHit != 1 {
		t.Fatalf("focus items=%d hit=%d, want the focus word 5 covered through its spelling", st.FocusItems, st.FocusHit)
	}
	for _, v := range st.VocabItems {
		if v.EntSeq == 5 && !v.IsFocus {
			t.Fatalf("vocab item 5 = %+v, want flagged as a focus item", v)
		}
	}
}
