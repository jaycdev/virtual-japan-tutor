package refdata_test

import (
	"os"
	"reflect"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

func parseAccents(t *testing.T) (map[[2]string]refdata.PitchEntry, refdata.PitchStats) {
	t.Helper()
	f, err := os.Open("testdata/source/accents.txt")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	entries, stats, err := refdata.ParseKanjiumAccents(f)
	if err != nil {
		t.Fatal(err)
	}
	m := map[[2]string]refdata.PitchEntry{}
	for _, e := range entries {
		k := [2]string{e.Word, e.Reading}
		if _, dup := m[k]; dup {
			t.Errorf("duplicate entry for %v", k)
		}
		m[k] = e
	}
	return m, stats
}

func positions(e refdata.PitchEntry) []int {
	var out []int
	for _, a := range e.Accents {
		out = append(out, a.Position)
	}
	return out
}

func TestKanjiumKeepsAllPatternsAndMarksTheFirstAsMostCommon(t *testing.T) {
	m, _ := parseAccents(t)

	hito := m[[2]string{"１", "ひと"}]
	if !reflect.DeepEqual(positions(hito), []int{0, 2}) {
		t.Errorf("positions = %v", positions(hito))
	}
	if !hito.Accents[0].Primary || hito.Accents[1].Primary {
		t.Errorf("primary flags = %+v", hito.Accents)
	}
}

func TestKanjiumHomographsStayApartByReading(t *testing.T) {
	m, _ := parseAccents(t)
	if !reflect.DeepEqual(positions(m[[2]string{"１", "いち"}]), []int{2}) ||
		!reflect.DeepEqual(positions(m[[2]string{"１", "ひと"}]), []int{0, 2}) {
		t.Errorf("entries = %+v", m)
	}
}

func TestKanjiumMergesRepeatedLinesAndDropsDuplicatePatterns(t *testing.T) {
	m, _ := parseAccents(t)

	// 橋/はし has two lines: 2,0 then 0,3. Order is preserved, the repeated 0 is dropped.
	hashi := m[[2]string{"橋", "はし"}]
	if !reflect.DeepEqual(positions(hashi), []int{2, 0, 3}) {
		t.Errorf("橋 positions = %v", positions(hashi))
	}
	// The same word with another reading is a different entry.
	if !reflect.DeepEqual(positions(m[[2]string{"箸", "はし"}]), []int{1}) {
		t.Errorf("箸 = %+v", m[[2]string{"箸", "はし"}])
	}
	// A line repeated verbatim adds nothing.
	if got := positions(m[[2]string{"食べる", "たべる"}]); !reflect.DeepEqual(got, []int{2}) {
		t.Errorf("食べる positions = %v", got)
	}
}

func TestKanjiumPartOfSpeechTagsAreKeptSeparately(t *testing.T) {
	m, _ := parseAccents(t)

	futatsu := m[[2]string{"２つ", "ふたつ"}]
	if !reflect.DeepEqual(positions(futatsu), []int{0, 3}) || futatsu.Accents[0].Tag != "副" || futatsu.Accents[1].Tag != "名" {
		t.Errorf("２つ = %+v", futatsu.Accents)
	}
	// An untagged pattern after tagged ones is still captured.
	omae := m[[2]string{"お手前", "おてまえ"}]
	if !reflect.DeepEqual(positions(omae), []int{2, 0}) {
		t.Errorf("お手前 = %+v", omae.Accents)
	}
}

func TestKanjiumBlankReadingMeansTheWordIsItsOwnReading(t *testing.T) {
	m, stats := parseAccents(t)

	if !reflect.DeepEqual(positions(m[[2]string{"かさかさ", "かさかさ"}]), []int{1, 0}) {
		t.Errorf("かさかさ = %+v", m[[2]string{"かさかさ", "かさかさ"}])
	}
	if !reflect.DeepEqual(positions(m[[2]string{"アイス", "アイス"}]), []int{1}) {
		t.Errorf("アイス missing")
	}
	// A blank reading on a word with kanji cannot be resolved: counted and skipped.
	if _, ok := m[[2]string{"漢字没有读音", ""}]; ok || stats.NoReading != 1 {
		t.Errorf("stats = %+v", stats)
	}
	// A line without three tab-separated fields is counted, not fatal.
	if stats.Malformed != 1 {
		t.Errorf("malformed = %d", stats.Malformed)
	}
}
