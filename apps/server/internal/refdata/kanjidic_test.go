package refdata_test

import (
	"os"
	"reflect"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

func TestParseKanjidic(t *testing.T) {
	f, err := os.Open("testdata/source/kanjidic2.xml")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	var got []refdata.KanjidicEntry
	hdr, err := refdata.ParseKanjidic(f, func(k refdata.KanjidicEntry) error {
		got = append(got, k)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if hdr.DatabaseVersion != "2026-305" || hdr.Created != "2026-11-01" {
		t.Errorf("header = %+v", hdr)
	}
	if len(got) != 4 {
		t.Fatalf("got %d kanji", len(got))
	}

	eat := got[0]
	if eat.Literal != "食" || *eat.Grade != 2 || eat.StrokeCount != 9 || *eat.Frequency != 328 || *eat.LegacyJLPT != 4 {
		t.Errorf("食 = %+v", eat)
	}
	if !reflect.DeepEqual(eat.On, []string{"ショク", "ジキ"}) || !reflect.DeepEqual(eat.Kun, []string{"く.う", "た.べる"}) {
		t.Errorf("readings on=%v kun=%v", eat.On, eat.Kun)
	}
	// Only English meanings: the fr/es ones are skipped.
	if !reflect.DeepEqual(eat.Meanings, []string{"eat", "food"}) {
		t.Errorf("meanings = %v", eat.Meanings)
	}
	if !reflect.DeepEqual(eat.Nanori, []string{"ぐい"}) {
		t.Errorf("nanori = %v", eat.Nanori)
	}

	// The first stroke count is the accepted one; meanings merge across reading groups;
	// missing optional fields are nil rather than zero.
	utsu := got[1]
	if utsu.StrokeCount != 29 || !reflect.DeepEqual(utsu.Meanings, []string{"depression", "gloom", "melancholy"}) {
		t.Errorf("鬱 = %+v", utsu)
	}
	if utsu.Grade != nil || utsu.Frequency != nil || utsu.LegacyJLPT != nil {
		t.Errorf("鬱 should have no grade/freq/jlpt: %+v", utsu)
	}

	// A character with no reading_meaning block at all is still returned.
	if got[2].Literal != "〆" || len(got[2].Meanings) != 0 {
		t.Errorf("〆 = %+v", got[2])
	}
}
