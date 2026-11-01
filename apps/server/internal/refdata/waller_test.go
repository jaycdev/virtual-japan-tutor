package refdata_test

import (
	"os"
	"reflect"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

func TestParseWallerVocab(t *testing.T) {
	f, err := os.Open("testdata/source/waller/n5_vocab.csv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	rows, dups, err := refdata.ParseWallerVocab(refdata.N5, f)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 3 || dups != 1 {
		t.Fatalf("rows=%d duplicates=%d, want 3 and 1 (%+v)", len(rows), dups, rows)
	}
	if rows[0] != (refdata.WallerVocab{Level: refdata.N5, Written: "会う", Reading: "あう", Meaning: "to meet"}) {
		t.Errorf("row 0 = %+v", rows[0])
	}
	// A kana-only word has an empty written form; the first of two identical rows is kept.
	if rows[1].Written != "" || rows[1].Reading != "あの" || rows[1].Meaning != "that" {
		t.Errorf("row 1 = %+v", rows[1])
	}
	if rows[2].Meaning != "Saturday, Saturday (day)" {
		t.Errorf("quoted meaning = %q", rows[2].Meaning)
	}
}

func TestParseWallerKanji(t *testing.T) {
	f, err := os.Open("testdata/source/waller/n5_kanji.csv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	got, err := refdata.ParseWallerKanji(f)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []string{"日", "食", "国"}) {
		t.Errorf("kanji = %v", got)
	}
}

func TestWallerWrittenCandidates(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"食べる", []string{"食べる"}},
		{"", nil},
		{"伯父/叔父", []string{"伯父", "叔父"}},
		{"堅/硬/固い", []string{"堅", "硬", "固い"}},
		{"二十（歳）", []string{"二十歳", "二十"}},
		{"他（外）", []string{"他外", "他"}},
		{"お・金持ち", []string{"お金持ち"}},
		{"見る  観る", []string{"見る", "観る"}},
	}
	for _, c := range cases {
		got := refdata.WallerVocab{Written: c.in}.WrittenCandidates()
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("WrittenCandidates(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestWallerReadingCandidates(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"たべる", []string{"たべる"}},
		{"きゅう / く", []string{"きゅう", "く"}},
		{"じゅう  とお", []string{"じゅう", "とお"}},
		{"べんきょう・する", []string{"べんきょうする", "べんきょう", "する"}},
		{"あす・あした", []string{"あすあした", "あす", "あした"}},
		{"あたたか(い)", []string{"あたたかい", "あたたか"}},
		{"より、ほう", []string{"より", "ほう"}},
		{"= 副 junk", nil},
		{"", nil},
	}
	for _, c := range cases {
		got := refdata.WallerVocab{Reading: c.in}.ReadingCandidates()
		if !reflect.DeepEqual(got, c.want) {
			t.Errorf("ReadingCandidates(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func newIndex() *refdata.FormIndex {
	idx := refdata.NewFormIndex()
	// 1: 会う/あう. 2: 合う/あう. 3 and 4: 土曜/どよう, 土曜日/どようび.
	idx.AddPair(refdata.FormRow{EntSeq: 1, Written: "会う", Reading: "あう", HasKanji: true, Common: true})
	idx.AddPair(refdata.FormRow{EntSeq: 2, Written: "合う", Reading: "あう", HasKanji: true, Common: true})
	idx.AddPair(refdata.FormRow{EntSeq: 3, Written: "土曜", Reading: "どよう", HasKanji: true})
	idx.AddPair(refdata.FormRow{EntSeq: 4, Written: "土曜日", Reading: "どようび", HasKanji: true})
	idx.AddPair(refdata.FormRow{EntSeq: 5, Written: "橋", Reading: "はし", HasKanji: true})
	idx.AddPair(refdata.FormRow{EntSeq: 6, Written: "橋", Reading: "きょう", HasKanji: true})
	// Reading rows (one per entry reading), used for kana-only list entries.
	idx.AddReading(refdata.FormRow{EntSeq: 10, Reading: "あの", HasKanji: true, UsuallyKana: true, Common: true})
	idx.AddReading(refdata.FormRow{EntSeq: 11, Reading: "あの", HasKanji: false, Common: false})
	idx.AddReading(refdata.FormRow{EntSeq: 12, Reading: "はし", HasKanji: true, Common: true})
	idx.AddReading(refdata.FormRow{EntSeq: 13, Reading: "ふと", HasKanji: true, UsuallyKana: true})
	idx.AddReading(refdata.FormRow{EntSeq: 1, Reading: "あう", HasKanji: true, Common: true})
	idx.AddReading(refdata.FormRow{EntSeq: 2, Reading: "あう", HasKanji: true, Common: true})
	return idx
}

func TestMatchVocab(t *testing.T) {
	idx := newIndex()
	cases := []struct {
		name       string
		row        refdata.WallerVocab
		wantEnts   []int64
		wantMethod refdata.MatchMethod
	}{
		{"written form and reading agree", refdata.WallerVocab{Written: "会う", Reading: "あう"}, []int64{1}, refdata.MatchExact},
		{"the reading tells homographs apart", refdata.WallerVocab{Written: "合う", Reading: "あう"}, []int64{2}, refdata.MatchExact},
		{"slash alternatives can land on separate entries",
			refdata.WallerVocab{Written: "土曜/土曜日", Reading: "どよう/どようび"}, []int64{3, 4}, refdata.MatchExact},
		{"a reading that matches nothing falls back to a unique written form",
			refdata.WallerVocab{Written: "土曜", Reading: "ドヨウ"}, []int64{3}, refdata.MatchWritten},
		{"a wrong reading still resolves when the written form identifies one entry",
			refdata.WallerVocab{Written: "会う", Reading: "ぜんぜん"}, []int64{1}, refdata.MatchWritten},
		{"no fallback when the written form is shared by several entries",
			refdata.WallerVocab{Written: "橋", Reading: "ぜんぜん"}, nil, refdata.MatchNone},
		{"kana-only word prefers usually-kana or kana-only entries, then common ones",
			refdata.WallerVocab{Reading: "あの"}, []int64{10}, refdata.MatchKanaAmbiguous},
		{"kana-only word with one eligible entry is not ambiguous",
			refdata.WallerVocab{Reading: "ふと"}, []int64{13}, refdata.MatchKana},
		{"a kana-only word whose entries all have kanji and are not usually kana falls back to the best of them",
			refdata.WallerVocab{Reading: "はし"}, []int64{12}, refdata.MatchKanaFallback},
		{"a written form that is only kana is looked up as a kana word",
			refdata.WallerVocab{Written: "ふと", Reading: "ふと"}, []int64{13}, refdata.MatchKana},
		{"a grammatical tail the list adds is stripped as a last resort (written)",
			refdata.WallerVocab{Written: "土曜な", Reading: "どよう"}, []int64{3}, refdata.MatchStem},
		{"a grammatical tail the list adds is stripped as a last resort (kana)",
			refdata.WallerVocab{Reading: "ふとする"}, []int64{13}, refdata.MatchStem},
		{"a kana word with no entry at all is unmatched", refdata.WallerVocab{Reading: "ほげほげ"}, nil, refdata.MatchNone},
		{"unknown word", refdata.WallerVocab{Written: "存在しない", Reading: "ない"}, nil, refdata.MatchNone},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, method := refdata.MatchVocab(c.row, idx)
			if method != c.wantMethod || !reflect.DeepEqual(got, c.wantEnts) {
				t.Errorf("MatchVocab(%+v) = %v, %q; want %v, %q", c.row, got, method, c.wantEnts, c.wantMethod)
			}
		})
	}
}
