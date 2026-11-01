package refdata_test

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/url"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/db"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// These tests need a real Postgres; set TEST_DATABASE_URL to run them (CI does).
// Each test works in its own schema so packages can test in parallel.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	base := os.Getenv("TEST_DATABASE_URL")
	if base == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	admin, err := db.Open(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	b := make([]byte, 6)
	_, _ = rand.Read(b)
	schema := "refdata_test_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}

	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	if err := db.Migrate(ctx, u.String()); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	pool, err := db.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		_, _ = admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	return pool
}

func fixtureParams(pool *pgxpool.Pool, datasets ...refdata.Dataset) refdata.ImportParams {
	return refdata.ImportParams{
		Pool:       pool,
		Fetcher:    &refdata.Fetcher{SourceDir: "testdata/source"},
		GrammarCSV: "testdata/source/grammar.csv",
		Datasets:   datasets,
	}
}

var (
	importOnce sync.Mutex
)

// importedPool returns a pool whose schema already holds the fixture import.
func importedPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := testPool(t)
	importOnce.Lock() // keep fixture imports from different tests from interleaving log output
	defer importOnce.Unlock()
	if _, err := refdata.Import(context.Background(), fixtureParams(pool)); err != nil {
		t.Fatalf("import: %v", err)
	}
	return pool
}

func TestImportPopulatesEveryTable(t *testing.T) {
	pool := testPool(t)
	report, err := refdata.Import(context.Background(), fixtureParams(pool))
	if err != nil {
		t.Fatal(err)
	}
	if len(report.Datasets) != 5 {
		t.Fatalf("imported %d datasets", len(report.Datasets))
	}

	counts, err := refdata.TableCounts(context.Background(), pool)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]int{
		"import_runs":        5,
		"jmdict_tags":        12,
		"jmdict_entries":     9,
		"jmdict_kanji_forms": 11,
		"jmdict_readings":    11,
		"jmdict_senses":      10,
		"kanji":              4,
		"kanji_readings":     8,
		"kanji_meanings":     7,
		"jlpt_vocab_entries": 7,
		"jlpt_vocab_links":   7,
		"jlpt_kanji":         6,
		"pitch_accents":      18,
		"grammar_points":     10,
	}
	if !reflect.DeepEqual(counts, want) {
		t.Errorf("row counts\n got %v\nwant %v", counts, want)
	}
}

func TestImportIsIdempotent(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)

	if _, err := refdata.Import(ctx, fixtureParams(pool)); err != nil {
		t.Fatal(err)
	}
	before, err := refdata.TableCounts(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	store := refdata.NewStore(pool)
	grammarBefore, err := store.FindGrammar(ctx, "のに")
	if err != nil {
		t.Fatal(err)
	}

	if _, err := refdata.Import(ctx, fixtureParams(pool)); err != nil {
		t.Fatalf("second import: %v", err)
	}
	after, err := refdata.TableCounts(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(before, after) {
		t.Errorf("row counts changed on re-import\nbefore %v\n after %v", before, after)
	}

	// Grammar Point ids are what later tickets reference, so they must survive a re-import.
	grammarAfter, err := store.FindGrammar(ctx, "のに")
	if err != nil {
		t.Fatal(err)
	}
	if len(grammarBefore) != 3 || !reflect.DeepEqual(grammarBefore, grammarAfter) {
		t.Errorf("grammar changed on re-import:\nbefore %+v\n after %+v", grammarBefore, grammarAfter)
	}
}

func TestImportOnlyRunsTheRequestedDatasets(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	if _, err := refdata.Import(ctx, fixtureParams(pool, refdata.Grammar)); err != nil {
		t.Fatal(err)
	}
	counts, err := refdata.TableCounts(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if counts["grammar_points"] != 10 || counts["jmdict_entries"] != 0 || counts["import_runs"] != 1 {
		t.Errorf("counts = %v", counts)
	}
}

func TestImportRecordsSourceLicenceAndChecksum(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	if _, err := refdata.Import(ctx, fixtureParams(pool, refdata.JMdict)); err != nil {
		t.Fatal(err)
	}
	var version, licence, checksum, url string
	var entries int
	err := pool.QueryRow(ctx, `SELECT version, licence, checksum, source_url, (row_counts->>'jmdict_entries')::int
		FROM import_runs WHERE dataset = 'jmdict'`).Scan(&version, &licence, &checksum, &url, &entries)
	if err != nil {
		t.Fatal(err)
	}
	if version != "2026-11-01" || licence != "CC BY-SA 4.0" || len(checksum) != 64 || url == "" || entries != 9 {
		t.Errorf("import_runs row = %q %q %q %q %d", version, licence, checksum, url, entries)
	}
}

func TestImportReplacesDataWhenTheSourceChanges(t *testing.T) {
	ctx := context.Background()
	pool := testPool(t)
	if _, err := refdata.Import(ctx, fixtureParams(pool, refdata.Grammar)); err != nil {
		t.Fatal(err)
	}

	// A shorter spreadsheet: points that are gone disappear, the others keep their ids.
	short := t.TempDir() + "/g.csv"
	if err := os.WriteFile(short, []byte("N5,1,ちゃいけない・じゃいけない,x,y\nN5,2,だ・です,x,y\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	store := refdata.NewStore(pool)
	before, _ := store.FindGrammar(ctx, "だ")

	p := fixtureParams(pool, refdata.Grammar)
	p.GrammarCSV = short
	if _, err := refdata.Import(ctx, p); err != nil {
		t.Fatal(err)
	}
	counts, _ := refdata.TableCounts(ctx, pool)
	after, _ := store.FindGrammar(ctx, "だ")
	if counts["grammar_points"] != 2 || counts["import_runs"] != 2 {
		t.Errorf("counts = %v", counts)
	}
	if len(before) != 1 || len(after) != 1 || before[0].ID != after[0].ID {
		t.Errorf("id changed: %+v -> %+v", before, after)
	}
}

func TestVocabularyLookup(t *testing.T) {
	ctx := context.Background()
	store := refdata.NewStore(importedPool(t))

	t.Run("by written form", func(t *testing.T) {
		got, err := store.FindVocabulary(ctx, "会う", "")
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 || got[0].EntSeq != 1198180 || !got[0].Common {
			t.Fatalf("got %+v", got)
		}
		v := got[0]
		if v.JLPTLevel != refdata.N5 {
			t.Errorf("level = %q, want N5 (listed at N5 and N3: the easiest wins)", v.JLPTLevel)
		}
		if len(v.Kanji) != 1 || v.Kanji[0].Text != "会う" || len(v.Readings) != 1 || v.Readings[0].Text != "あう" {
			t.Errorf("forms = %+v / %+v", v.Kanji, v.Readings)
		}
		if len(v.Senses) != 1 || !reflect.DeepEqual(v.Senses[0].POS, []string{"v5u", "vi"}) ||
			!reflect.DeepEqual(v.Senses[0].Glosses, []string{"to meet", "to encounter"}) {
			t.Errorf("senses = %+v", v.Senses)
		}
	})

	t.Run("by reading returns every homophone, common first by ent_seq", func(t *testing.T) {
		got, err := store.FindVocabulary(ctx, "あう", "")
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 2 || got[0].EntSeq != 1198180 || got[1].EntSeq != 1417030 {
			t.Errorf("got %+v", got)
		}
	})

	t.Run("a reading narrows the match", func(t *testing.T) {
		got, err := store.FindVocabulary(ctx, "合う", "あう")
		if err != nil {
			t.Fatal(err)
		}
		if len(got) != 1 || got[0].EntSeq != 1417030 || got[0].JLPTLevel != refdata.N2 {
			t.Errorf("got %+v", got)
		}
		none, err := store.FindVocabulary(ctx, "会う", "ぜんぜん")
		if err != nil || len(none) != 0 {
			t.Errorf("wrong reading: %v %+v", err, none)
		}
	})

	t.Run("a reading restricted to another kanji form does not apply", func(t *testing.T) {
		ok, err := store.FindVocabulary(ctx, "ＣＤプレーヤー", "シーディープレーヤー")
		if err != nil || len(ok) != 1 {
			t.Fatalf("matching restriction: %v %+v", err, ok)
		}
		no, err := store.FindVocabulary(ctx, "ＣＤプレーヤー", "シーディープレイヤー")
		if err != nil || len(no) != 0 {
			t.Errorf("restricted reading matched the wrong form: %v %+v", err, no)
		}
	})

	t.Run("words on no list have no JLPT level", func(t *testing.T) {
		got, err := store.FindVocabulary(ctx, "食べる", "たべる")
		if err != nil || len(got) != 1 {
			t.Fatalf("%v %+v", err, got)
		}
		if got[0].JLPTLevel != "" {
			t.Errorf("level = %q", got[0].JLPTLevel)
		}
		lvl, ok, err := store.VocabularyJLPTLevel(ctx, 1358280)
		if err != nil || ok || lvl != "" {
			t.Errorf("VocabularyJLPTLevel = %q %v %v", lvl, ok, err)
		}
	})

	t.Run("JLPT level by entry id", func(t *testing.T) {
		lvl, ok, err := store.VocabularyJLPTLevel(ctx, 1198180)
		if err != nil || !ok || lvl != refdata.N5 {
			t.Errorf("= %q %v %v", lvl, ok, err)
		}
	})

	t.Run("unknown word", func(t *testing.T) {
		got, err := store.FindVocabulary(ctx, "存在しない", "")
		if err != nil || len(got) != 0 {
			t.Errorf("%v %+v", err, got)
		}
	})
}

func TestKanjiLookup(t *testing.T) {
	ctx := context.Background()
	store := refdata.NewStore(importedPool(t))

	k, ok, err := store.FindKanji(ctx, "食")
	if err != nil || !ok {
		t.Fatalf("%v %v", err, ok)
	}
	if k.Grade == nil || *k.Grade != 2 || k.StrokeCount != 9 || *k.Frequency != 328 {
		t.Errorf("食 = %+v", k)
	}
	if !reflect.DeepEqual(k.On, []string{"ショク", "ジキ"}) || !reflect.DeepEqual(k.Kun, []string{"く.う", "た.べる"}) ||
		!reflect.DeepEqual(k.Meanings, []string{"eat", "food"}) {
		t.Errorf("readings/meanings = %+v", k)
	}
	// KANJIDIC2's own <jlpt> (4, the old scale) is kept apart from the JLPT Level from Waller.
	if k.LegacyJLPT == nil || *k.LegacyJLPT != 4 {
		t.Errorf("legacy jlpt = %v", k.LegacyJLPT)
	}
	if k.JLPTLevel != refdata.N5 {
		t.Errorf("JLPT level = %q, want N5 (on the N5 and N1 lists)", k.JLPTLevel)
	}

	lvl, ok, err := store.KanjiJLPTLevel(ctx, "鬱")
	if err != nil || !ok || lvl != refdata.N1 {
		t.Errorf("鬱 = %q %v %v", lvl, ok, err)
	}
	if _, ok, _ := store.KanjiJLPTLevel(ctx, "〆"); ok {
		t.Error("〆 is on no list")
	}
	if _, ok, err := store.FindKanji(ctx, "謎"); ok || err != nil {
		t.Errorf("謎 is not in KANJIDIC2: ok=%v err=%v", ok, err)
	}
}

func TestPitchAccentLookup(t *testing.T) {
	ctx := context.Background()
	store := refdata.NewStore(importedPool(t))

	got, err := store.PitchAccents(ctx, "橋", "はし")
	if err != nil {
		t.Fatal(err)
	}
	var positions []int
	var primaries []bool
	for _, a := range got {
		positions = append(positions, a.Position)
		primaries = append(primaries, a.Primary)
	}
	if !reflect.DeepEqual(positions, []int{2, 0, 3}) || !reflect.DeepEqual(primaries, []bool{true, false, false}) {
		t.Errorf("positions %v primaries %v", positions, primaries)
	}

	other, _ := store.PitchAccents(ctx, "箸", "はし")
	if len(other) != 1 || other[0].Position != 1 {
		t.Errorf("箸 = %+v", other)
	}
	none, err := store.PitchAccents(ctx, "橋", "きょう")
	if err != nil || len(none) != 0 {
		t.Errorf("%v %+v", err, none)
	}
}

func TestGrammarLookup(t *testing.T) {
	ctx := context.Background()
	store := refdata.NewStore(importedPool(t))

	levelsAndNumbers := func(ps []refdata.GrammarPoint) [][2]any {
		var out [][2]any
		for _, p := range ps {
			out = append(out, [2]any{p.Level, p.Number})
		}
		return out
	}

	t.Run("a pattern at several levels returns every Grammar Point, easiest first", func(t *testing.T) {
		got, err := store.FindGrammar(ctx, "のに")
		if err != nil {
			t.Fatal(err)
		}
		want := [][2]any{{refdata.N5, 4}, {refdata.N4, 1}, {refdata.N4, 2}}
		if !reflect.DeepEqual(levelsAndNumbers(got), want) {
			t.Errorf("got %v", levelsAndNumbers(got))
		}
		if got[1].Meaning != "even though" || got[2].Meaning != "in order to" || got[0].ID == 0 {
			t.Errorf("points = %+v", got)
		}
	})

	t.Run("the query is normalised like the catalogue", func(t *testing.T) {
		for _, q := range []string{"〜てしまう", "～てしまう", " て しまう ", "てしまう"} {
			got, err := store.FindGrammar(ctx, q)
			if err != nil || len(got) != 1 || got[0].Level != refdata.N3 || got[0].Number != 1 {
				t.Errorf("FindGrammar(%q) = %+v, %v", q, got, err)
			}
		}
	})

	t.Run("any variant finds the point", func(t *testing.T) {
		for _, q := range []string{"じゃいけない", "ちゃいけない", "ちゃいけない・じゃいけない"} {
			got, err := store.FindGrammar(ctx, q)
			if err != nil || len(got) != 1 || got[0].Number != 1 || got[0].Level != refdata.N5 {
				t.Errorf("FindGrammar(%q) = %+v, %v", q, got, err)
			}
		}
		// "で" is only a variant of N4 "て / で".
		got, err := store.FindGrammar(ctx, "で")
		if err != nil || len(got) != 1 || got[0].Level != refdata.N4 || got[0].Pattern != "て / で" {
			t.Errorf("で = %+v, %v", got, err)
		}
	})

	t.Run("optional parts are matched with their content", func(t *testing.T) {
		got, err := store.FindGrammar(ctx, "とかで")
		if err != nil || len(got) != 1 || got[0].Pattern != "とか（で）" {
			t.Errorf("%+v %v", got, err)
		}
	})

	t.Run("unknown pattern", func(t *testing.T) {
		got, err := store.FindGrammar(ctx, "ない")
		if err != nil || len(got) != 0 {
			t.Errorf("%+v %v", got, err)
		}
	})
}

func TestCoverageReportsWhatMatchedAndWhatDidNot(t *testing.T) {
	ctx := context.Background()
	pool := importedPool(t)

	c, err := refdata.MeasureCoverage(ctx, pool, 10)
	if err != nil {
		t.Fatal(err)
	}
	if c.VocabRows != 7 || c.VocabMatched != 6 {
		t.Errorf("vocab rows %d matched %d", c.VocabRows, c.VocabMatched)
	}
	if c.VocabByMethod[refdata.MatchExact] != 5 || c.VocabByMethod[refdata.MatchKana] != 1 {
		t.Errorf("by method = %v", c.VocabByMethod)
	}
	if len(c.VocabUnmatched) != 1 || c.VocabUnmatched[0].Written != "存在しない" || c.VocabUnmatched[0].Level != refdata.N4 {
		t.Errorf("unmatched vocab = %+v", c.VocabUnmatched)
	}
	if c.KanjiRows != 6 || c.KanjiMatched != 4 || len(c.KanjiUnmatched) != 2 {
		t.Errorf("kanji rows %d matched %d unmatched %+v", c.KanjiRows, c.KanjiMatched, c.KanjiUnmatched)
	}
	if c.JMdictEntries != 9 || c.JMdictWithPitch != 3 {
		t.Errorf("jmdict entries %d with pitch %d", c.JMdictEntries, c.JMdictWithPitch)
	}
}
