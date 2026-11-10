package story

import (
	"context"
	"testing"

	"github.com/google/uuid"
)

// issue #134: kagome reads 市場 as しじょう in every sentence, but the entry a
// token links to (市場【いちば】) decides what the furigana shows. The reading
// must agree with the linked entry, so the reader's furigana and Dictionary
// Entry never disagree.

const marketSentence = "市場で野菜を買った。"

// marketLookup links 市場 to one entry with the given readings, in JMdict order.
func marketLookup(readings ...string) fakeLookup {
	return fakeLookup{"市場": {EntSeq: 1409850, JA: "市場", Readings: readings}}
}

// tokenReading materialises the market sentence with the lookup and returns
// the reading of its 市場 token.
func tokenReading(t *testing.T, lookup VocabLookup) string {
	t.Helper()
	s := materialiseJA(t, uuid.New(), lookup, marketSentence)
	return tokenNamed(t, s, 0, "市場").Reading
}

func TestFuriganaFollowsLinkedEntryReading(t *testing.T) {
	cases := []struct {
		name     string
		readings []string
		want     string
	}{
		{
			// kagome says しじょう, which is not a reading of 市場【いちば】: the
			// entry's first reading wins.
			name:     "kagome reading not among the entry's readings",
			readings: []string{"いちば"},
			want:     "いちば",
		},
		{
			// しじょう is a reading of the linked entry, so kagome's reading
			// stays even though いちば comes first.
			name:     "kagome reading among the entry's readings is kept",
			readings: []string{"いちば", "しじょう"},
			want:     "しじょう",
		},
		{
			// Katakana entry readings compare in hiragana: シジョウ is しじょう.
			name:     "katakana entry reading matching kagome is kept",
			readings: []string{"シジョウ"},
			want:     "しじょう",
		},
		{
			// A katakana first reading is stored in hiragana, as furigana always is.
			name:     "katakana entry reading is converted to hiragana",
			readings: []string{"イチバ"},
			want:     "いちば",
		},
		{
			// No reading info on the entry: kagome's reading is all there is.
			name:     "entry without readings keeps kagome's reading",
			readings: nil,
			want:     "しじょう",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := tokenReading(t, marketLookup(c.readings...)); got != c.want {
				t.Fatalf("reading of 市場 = %q, want %q", got, c.want)
			}
		})
	}
}

// When the Learner knows a different sense of the spelling, tagKnown links the
// token to that entry, and its furigana follows the entry it now opens.
func TestKnownSenseReconcilesFuriganaToItsEntry(t *testing.T) {
	lookup := fakeLookup{"市場": {EntSeq: 1409850, JA: "市場", Readings: []string{"いちば"},
		Alts: []VocabHit{
			{EntSeq: 1409850, JA: "市場", Readings: []string{"いちば"}},
			{EntSeq: 1409851, JA: "市場", Readings: []string{"しじょう"}},
		}}}
	owner := uuid.New()
	s := materialiseJA(t, owner, lookup, marketSentence)
	known := fakeKnown{1409851: {IsKnown: true}}
	if err := NewGenerator(lookup).tagKnown(context.Background(), s, Request{UserID: owner, Known: known}); err != nil {
		t.Fatalf("tagKnown: %v", err)
	}
	got := tokenNamed(t, s, 0, "市場")
	if got.EntSeq == nil || *got.EntSeq != 1409851 {
		t.Fatalf("市場 linked to %v, want the known sense 1409851", got.EntSeq)
	}
	if got.Reading != "しじょう" {
		t.Fatalf("reading of 市場 = %q, want しじょう (the known sense's reading)", got.Reading)
	}
}

// The relink run fills in links on stored Stories, so a token it newly links
// must take the linked entry's reading too.
func TestRelinkFollowsLinkedEntryReading(t *testing.T) {
	owner := uuid.New()
	s := materialiseJA(t, owner, fakeLookup{}, marketSentence)
	s.ID = uuid.New()
	for i := range s.Sentences {
		s.Sentences[i].ID = uuid.New()
	}
	if tok := tokenNamed(t, s, 0, "市場"); tok.EntSeq != nil || tok.Reading != "しじょう" {
		t.Fatalf("stored 市場 = %+v, want unlinked with kagome's しじょう", tok)
	}
	f := newRelinkFake(s)

	lookup := fakeLookup{"市場": {EntSeq: 1409850, JA: "市場", Readings: []string{"いちば"}}}
	if _, err := newRelinker(f, lookup, fakeKnown{}).Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := findTok(t, f.stored[s.ID], 0, "市場"); got.EntSeq == nil || got.Reading != "いちば" {
		t.Fatalf("relinked 市場 = %+v, want linked with reading いちば", got)
	}
}
