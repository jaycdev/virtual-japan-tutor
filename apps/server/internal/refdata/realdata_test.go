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
