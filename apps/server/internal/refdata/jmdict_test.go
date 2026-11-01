package refdata_test

import (
	"os"
	"reflect"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

func parseJMdictFixture(t *testing.T) (refdata.JMdictHeader, map[int64]refdata.JMdictEntry, []int64) {
	t.Helper()
	f, err := os.Open("testdata/source/JMdict_e")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	entries := map[int64]refdata.JMdictEntry{}
	var order []int64
	hdr, err := refdata.ParseJMdict(f, func(e refdata.JMdictEntry) error {
		entries[e.EntSeq] = e
		order = append(order, e.EntSeq)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return hdr, entries, order
}

func TestParseJMdictHeaderAndOrder(t *testing.T) {
	hdr, entries, order := parseJMdictFixture(t)

	if hdr.Created != "2026-11-01" {
		t.Errorf("created = %q", hdr.Created)
	}
	if got := hdr.Tags["uk"]; got != "word usually written using kana alone" {
		t.Errorf("tag description for uk = %q", got)
	}
	want := []int64{1358280, 1000090, 1000110, 1000300, 1198180, 1417030, 2085150, 1417040, 1000420}
	if len(entries) != len(want) || !reflect.DeepEqual(order, want) {
		t.Errorf("entries in document order = %v", order)
	}
}

func TestParseJMdictFormsKeepShortCodesAndPriorities(t *testing.T) {
	_, entries, _ := parseJMdictFixture(t)
	e := entries[1358280]

	if len(e.Kanji) != 2 || e.Kanji[0].Text != "食べる" || e.Kanji[1].Text != "喰べる" {
		t.Fatalf("kanji forms = %+v", e.Kanji)
	}
	if !reflect.DeepEqual(e.Kanji[0].Priority, []string{"ichi1", "news2", "nf25"}) {
		t.Errorf("kanji priority = %v", e.Kanji[0].Priority)
	}
	// Entity references arrive as their short code ("sK"), not the long description.
	if !reflect.DeepEqual(e.Kanji[1].Info, []string{"sK"}) {
		t.Errorf("kanji info = %v", e.Kanji[1].Info)
	}
	if len(e.Readings) != 1 || e.Readings[0].Text != "たべる" {
		t.Fatalf("readings = %+v", e.Readings)
	}
	if !e.Common {
		t.Error("an entry with ichi1 should be common")
	}
	if entries[1000090].Common {
		t.Error("an entry without priority tags should not be common")
	}
}

func TestParseJMdictSenses(t *testing.T) {
	_, entries, _ := parseJMdictFixture(t)

	eat := entries[1358280]
	if len(eat.Senses) != 2 {
		t.Fatalf("senses = %+v", eat.Senses)
	}
	if !reflect.DeepEqual(eat.Senses[0].POS, []string{"v1", "vt"}) || !reflect.DeepEqual(eat.Senses[0].Field, []string{"food"}) {
		t.Errorf("sense 0 = %+v", eat.Senses[0])
	}
	// A sense without <pos> inherits the previous sense's parts of speech.
	if !reflect.DeepEqual(eat.Senses[1].POS, []string{"v1", "vt"}) {
		t.Errorf("inherited pos = %v", eat.Senses[1].POS)
	}
	// Only English glosses are kept.
	if !reflect.DeepEqual(eat.Senses[1].Glosses, []string{"to live on (e.g. a salary)", "to live off"}) {
		t.Errorf("glosses = %v", eat.Senses[1].Glosses)
	}

	s := entries[1000090].Senses[0]
	if !reflect.DeepEqual(s.Misc, []string{"uk"}) || !reflect.DeepEqual(s.Dialect, []string{"ksb"}) ||
		!reflect.DeepEqual(s.Info, []string{"often used of tactics"}) ||
		!reflect.DeepEqual(s.StagK, []string{"悪どい"}) || !reflect.DeepEqual(s.Xref, []string{"阿漕・あこぎ"}) ||
		!reflect.DeepEqual(s.Antonym, []string{"善い"}) || !reflect.DeepEqual(s.Glosses, []string{"gaudy", "excessive"}) {
		t.Errorf("sense = %+v", s)
	}
}

func TestParseJMdictReadingRestrictions(t *testing.T) {
	_, entries, _ := parseJMdictFixture(t)

	cd := entries[1000110]
	if !reflect.DeepEqual(cd.Readings[0].RestrictTo, []string{"ＣＤプレーヤー"}) ||
		!reflect.DeepEqual(cd.Readings[1].RestrictTo, []string{"ＣＤプレイヤー"}) {
		t.Errorf("restrictions = %+v", cd.Readings)
	}
	if !cd.Common {
		t.Error("spec1 should count as common")
	}

	ditto := entries[1000300]
	if !ditto.Readings[0].NoKanji || ditto.Readings[1].NoKanji {
		t.Errorf("nokanji flags = %+v", ditto.Readings)
	}
	if !reflect.DeepEqual(ditto.Readings[1].Info, []string{"ok"}) {
		t.Errorf("reading info = %v", ditto.Readings[1].Info)
	}
}

func TestParseJMdictStopsWhenCallbackFails(t *testing.T) {
	f, err := os.Open("testdata/source/JMdict_e")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	wantErr := os.ErrInvalid
	n := 0
	_, err = refdata.ParseJMdict(f, func(refdata.JMdictEntry) error {
		n++
		return wantErr
	})
	if err != wantErr || n != 1 {
		t.Errorf("err=%v after %d entries", err, n)
	}
}
