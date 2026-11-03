package story

import (
	"context"
	"strings"
	"testing"
)

// Live, every retry came back with the identical "known-word coverage is 75%
// (90 of 120 ...)": the feedback said to use only known words but never named
// the offenders, so the model had nothing to change.
func TestCoverageFeedbackNamesTheUnknownWords(t *testing.T) {
	client := &fakeChat{responses: [][]byte{
		fixture(t, "travel", dirtyClause, cleanClause, cleanClause, cleanClause),
		fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause),
	}}
	req := baseRequest()
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}
	// ほん is linked but not known: a real word the learner has not learned.
	lookup := cleanLookup()
	lookup["ほん"] = VocabHit{EntSeq: 3, JA: "本", EN: "book"}

	st, err := NewGenerator(lookup).Generate(context.Background(), client, req)
	if err != nil || !st.Validated {
		t.Fatalf("want validated on attempt 2, got %v", err)
	}
	var feedback string
	for _, m := range client.msgs[1] {
		if strings.Contains(m.Content, "known-word coverage") {
			feedback = m.Content
		}
	}
	if !strings.Contains(feedback, "本") {
		t.Fatalf("coverage feedback does not name the unknown word 本:\n%s", feedback)
	}
}

func TestRefdataLookupPrefersTheDictionaryForm(t *testing.T) {
	// The surface of a conjugated stem (あり, from ある) is also an unrelated
	// noun (蟻, ant). Asking for the surface first linked the token to the
	// wrong entry, which is never in the learner's Known Items, so ordinary
	// verbs counted as unknown and sank the coverage gate.
	got := lookupForms("あり", "ある")
	if len(got) != 2 || got[0] != "ある" || got[1] != "あり" {
		t.Fatalf("lookupForms(あり, ある) = %v, want the dictionary form first", got)
	}
	if got := lookupForms("本", "本"); len(got) != 1 || got[0] != "本" {
		t.Fatalf("lookupForms for an uninflected word = %v, want it once", got)
	}
	if got := lookupForms("ミケ", ""); len(got) != 1 || got[0] != "ミケ" {
		t.Fatalf("lookupForms with no dictionary form = %v, want the surface", got)
	}
}
