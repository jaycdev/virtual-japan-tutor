package refdata_test

import (
	"compress/gzip"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// These tests parse the real, full datasets and are skipped unless
// REFDATA_SOURCE_DIR points at a directory of downloaded sources (the same
// layout the import command uses). They guard against format drift.
func realDir(t *testing.T) string {
	t.Helper()
	dir := os.Getenv("REFDATA_SOURCE_DIR")
	if dir == "" {
		t.Skip("REFDATA_SOURCE_DIR not set")
	}
	return dir
}

func TestRealKanjidicParses(t *testing.T) {
	dir := realDir(t)
	f, err := os.Open(filepath.Join(dir, "kanjidic2.xml.gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	n, withMeaning := 0, 0
	hdr, err := refdata.ParseKanjidic(zr, func(k refdata.KanjidicEntry) error {
		n++
		if len(k.Meanings) > 0 {
			withMeaning++
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("KANJIDIC2 %s: %d characters, %d with English meanings", hdr.DatabaseVersion, n, withMeaning)
	if n < 13000 {
		t.Errorf("only %d characters", n)
	}
}

func TestRealKanjiumParses(t *testing.T) {
	dir := realDir(t)
	f, err := os.Open(filepath.Join(dir, "accents.txt"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	entries, stats, err := refdata.ParseKanjiumAccents(f)
	if err != nil {
		t.Fatal(err)
	}
	patterns := 0
	for _, e := range entries {
		patterns += len(e.Accents)
	}
	t.Logf("Kanjium: %d lines, %d (word, reading) entries, %d patterns, %+v", stats.Lines, len(entries), patterns, stats)
	if len(entries) < 120000 || stats.Malformed != 0 {
		t.Errorf("entries=%d stats=%+v", len(entries), stats)
	}
}

func TestRealWallerListsParse(t *testing.T) {
	dir := realDir(t)
	vocab, kanji := 0, 0
	for _, l := range refdata.Levels {
		vf, err := os.Open(filepath.Join(dir, filepath.FromSlash(refdata.WallerVocabFile(l))))
		if err != nil {
			t.Fatal(err)
		}
		rows, _, err := refdata.ParseWallerVocab(l, vf)
		vf.Close()
		if err != nil {
			t.Fatal(err)
		}
		vocab += len(rows)

		kf, err := os.Open(filepath.Join(dir, filepath.FromSlash(refdata.WallerKanjiFile(l))))
		if err != nil {
			t.Fatal(err)
		}
		ks, err := refdata.ParseWallerKanji(kf)
		kf.Close()
		if err != nil {
			t.Fatal(err)
		}
		kanji += len(ks)
	}
	t.Logf("Waller: %d vocabulary rows, %d kanji rows", vocab, kanji)
	if vocab < 8000 || kanji < 2000 {
		t.Errorf("vocab=%d kanji=%d", vocab, kanji)
	}
}

func TestRealJMdictParses(t *testing.T) {
	dir := realDir(t)
	f, err := os.Open(filepath.Join(dir, "JMdict_e.gz"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	zr, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}

	start := time.Now()
	var entries, senses, withKanji int
	hdr, err := refdata.ParseJMdict(zr, func(e refdata.JMdictEntry) error {
		entries++
		senses += len(e.Senses)
		if len(e.Kanji) > 0 {
			withKanji++
		}
		if len(e.Readings) == 0 || len(e.Senses) == 0 {
			t.Errorf("entry %d lacks readings or senses", e.EntSeq)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("created %s: %d entries (%d with kanji), %d senses, %d tags, in %s",
		hdr.Created, entries, withKanji, senses, len(hdr.Tags), time.Since(start).Round(time.Millisecond))
	if entries < 150000 {
		t.Errorf("only %d entries", entries)
	}
}
