package story

import (
	"reflect"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// issue #134 review: a token's furigana falls back to the entry's first reading,
// so the readings hitOf keeps must be the ones that apply to the matched form:
// no kana-only (no_kanji) reading for a kanji spelling, and no reading restricted
// to a different kanji form (the rule refdata.Store.FindVocabulary applies).

func TestHitOfKeepsOnlyReadingsThatApplyToTheMatchedForm(t *testing.T) {
	rd := func(text string, noKanji bool, restrict ...string) refdata.JMdictReading {
		return refdata.JMdictReading{Text: text, NoKanji: noKanji, RestrictTo: restrict}
	}
	kf := func(texts ...string) []refdata.JMdictKanji {
		var out []refdata.JMdictKanji
		for _, t := range texts {
			out = append(out, refdata.JMdictKanji{Text: t})
		}
		return out
	}
	cases := []struct {
		name    string
		entry   refdata.JMdictEntry
		written string
		want    []string
	}{
		{
			name:    "kanji form drops a kana-only reading",
			entry:   refdata.JMdictEntry{Kanji: kf("市場"), Readings: []refdata.JMdictReading{rd("いちば", false), rd("しじょう", false), rd("ヤ", true)}},
			written: "市場",
			want:    []string{"いちば", "しじょう"},
		},
		{
			name: "kanji form drops readings restricted to another kanji form",
			entry: refdata.JMdictEntry{
				Kanji:    kf("A", "B"),
				Readings: []refdata.JMdictReading{rd("r1", false, "A"), rd("r2", false, "B"), rd("r3", false)},
			},
			written: "B",
			want:    []string{"r2", "r3"},
		},
		{
			name: "kanji form keeps a reading restricted to that form",
			entry: refdata.JMdictEntry{
				Kanji:    kf("A", "B"),
				Readings: []refdata.JMdictReading{rd("r1", false, "A"), rd("r2", false, "B")},
			},
			written: "A",
			want:    []string{"r1"},
		},
		{
			name:    "kana spelling keeps every reading, kana-only ones included",
			entry:   refdata.JMdictEntry{Kanji: kf("市場"), Readings: []refdata.JMdictReading{rd("いちば", false), rd("ヤ", true)}},
			written: "いちば",
			want:    []string{"いちば", "ヤ"},
		},
		{
			name:    "kanji form that filters to nothing keeps every reading",
			entry:   refdata.JMdictEntry{Kanji: kf("K"), Readings: []refdata.JMdictReading{rd("x", true)}},
			written: "K",
			want:    []string{"x"},
		},
		{
			name:    "entry with no readings has none",
			entry:   refdata.JMdictEntry{Kanji: kf("K")},
			written: "K",
			want:    nil,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := hitOf(refdata.Vocabulary{JMdictEntry: c.entry}, c.written).Readings
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("Readings = %q, want %q", got, c.want)
			}
		})
	}
}
