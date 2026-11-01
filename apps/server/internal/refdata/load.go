package refdata

import (
	"bufio"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ImportParams configures Import.
type ImportParams struct {
	Pool *pgxpool.Pool
	// Fetcher supplies the downloadable sources (JMdict, KANJIDIC2, Waller, Kanjium).
	Fetcher *Fetcher
	// GrammarCSV is the path of data/grammar/jlpt-grammar.csv.
	GrammarCSV string
	// Datasets limits the import; empty means all, in dependency order.
	Datasets []Dataset
	Log      *slog.Logger
}

// DatasetReport says what one dataset's import did.
type DatasetReport struct {
	Dataset  Dataset
	Version  string
	Checksum string
	Counts   map[string]int // rows in each table the dataset fills, after the import
	Notes    []string
	Duration time.Duration
}

// ImportReport is the result of Import.
type ImportReport struct {
	Datasets []DatasetReport
	// Coverage is set when the JLPT lists or pitch accents were imported.
	Coverage *Coverage
}

const importBatch = 2000

// Import loads the requested datasets into Postgres. Each dataset is loaded
// in a single transaction, so a failure leaves the previous data untouched,
// and loading is idempotent: running it again on the same sources leaves every
// table with the same rows (JMdict entries, kanji and Grammar Points keep
// their keys; dependent tables are replaced).
func Import(ctx context.Context, p ImportParams) (*ImportReport, error) {
	log := p.Log
	if log == nil {
		log = slog.New(slog.NewTextHandler(io.Discard, nil))
	}
	want := map[Dataset]bool{}
	for _, d := range p.Datasets {
		want[d] = true
	}
	if len(want) == 0 {
		for _, d := range AllDatasets {
			want[d] = true
		}
	}

	report := &ImportReport{}
	for _, d := range AllDatasets {
		if !want[d] {
			continue
		}
		start := time.Now()
		log.Info("importing", "dataset", d)
		dr, err := importDataset(ctx, p, d, log)
		if err != nil {
			return report, fmt.Errorf("import %s: %w", d, err)
		}
		dr.Duration = time.Since(start)
		log.Info("imported", "dataset", d, "version", dr.Version, "counts", dr.Counts, "took", dr.Duration.Round(time.Millisecond))
		report.Datasets = append(report.Datasets, dr)
	}

	if want[Waller] || want[Kanjium] || want[JMdict] {
		c, err := MeasureCoverage(ctx, p.Pool, 15)
		if err != nil {
			return report, err
		}
		report.Coverage = &c
	}
	return report, nil
}

// datasetTables lists the tables each dataset fills, for the row counts.
var datasetTables = map[Dataset][]string{
	JMdict:    {"jmdict_tags", "jmdict_entries", "jmdict_kanji_forms", "jmdict_readings", "jmdict_senses"},
	Kanjidic2: {"kanji", "kanji_readings", "kanji_meanings"},
	Waller:    {"jlpt_vocab_entries", "jlpt_vocab_links", "jlpt_kanji"},
	Kanjium:   {"pitch_accents"},
	Grammar:   {"grammar_points"},
}

// TableCounts returns the row count of every reference table (and import_runs).
func TableCounts(ctx context.Context, q Querier) (map[string]int, error) {
	out := map[string]int{}
	tables := []string{"import_runs"}
	for _, d := range AllDatasets {
		tables = append(tables, datasetTables[d]...)
	}
	for _, t := range tables {
		var n int
		if err := q.QueryRow(ctx, "SELECT count(*) FROM "+t).Scan(&n); err != nil {
			return nil, fmt.Errorf("count %s: %w", t, err)
		}
		out[t] = n
	}
	return out, nil
}

// loaded is what a dataset loader reports back for import_runs.
type loaded struct {
	version   string
	checksum  string
	fetchedAt time.Time
	notes     []string
}

func importDataset(ctx context.Context, p ImportParams, d Dataset, log *slog.Logger) (DatasetReport, error) {
	info := Info(d)

	// Get the files before opening a transaction, so downloads do not hold one open.
	var files []FetchedFile
	switch d {
	case Grammar:
		if p.GrammarCSV == "" {
			return DatasetReport{}, errors.New("no grammar CSV path configured")
		}
		sum, err := checksumFile(p.GrammarCSV)
		if err != nil {
			return DatasetReport{}, err
		}
		st, err := os.Stat(p.GrammarCSV)
		if err != nil {
			return DatasetReport{}, err
		}
		files = []FetchedFile{{SourceFile: SourceFile{Name: p.GrammarCSV}, Path: p.GrammarCSV, Checksum: sum, FetchedAt: st.ModTime().UTC()}}
	default:
		if p.Fetcher == nil {
			return DatasetReport{}, errors.New("no fetcher configured")
		}
		for _, sf := range info.Files {
			ff, err := p.Fetcher.Fetch(ctx, sf)
			if err != nil {
				return DatasetReport{}, err
			}
			files = append(files, ff)
		}
	}

	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return DatasetReport{}, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck // no-op after commit

	var l loaded
	switch d {
	case JMdict:
		l, err = loadJMdict(ctx, tx, files[0], log)
	case Kanjidic2:
		l, err = loadKanjidic(ctx, tx, files[0])
	case Waller:
		l, err = loadWaller(ctx, tx, files)
	case Kanjium:
		l, err = loadKanjium(ctx, tx, files[0])
	case Grammar:
		l, err = loadGrammar(ctx, tx, files[0])
	}
	if err != nil {
		return DatasetReport{}, err
	}

	counts := map[string]int{}
	for _, t := range datasetTables[d] {
		var n int
		if err := tx.QueryRow(ctx, "SELECT count(*) FROM "+t).Scan(&n); err != nil {
			return DatasetReport{}, err
		}
		counts[t] = n
	}
	countsJSON, err := json.Marshal(counts)
	if err != nil {
		return DatasetReport{}, err
	}
	if info.Dataset == Waller || info.Dataset == Kanjium {
		l.version = datasetVersion(d)
	}
	_, err = tx.Exec(ctx, `
		INSERT INTO import_runs (dataset, version, source_url, licence, licence_url, checksum, fetched_at, row_counts)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
		ON CONFLICT (dataset, checksum) DO UPDATE SET
			version = EXCLUDED.version, source_url = EXCLUDED.source_url, licence = EXCLUDED.licence,
			licence_url = EXCLUDED.licence_url, fetched_at = EXCLUDED.fetched_at,
			imported_at = now(), row_counts = EXCLUDED.row_counts`,
		string(d), l.version, info.SourceURL, info.Licence, info.LicenceURL, l.checksum, l.fetchedAt, string(countsJSON))
	if err != nil {
		return DatasetReport{}, fmt.Errorf("record import run: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return DatasetReport{}, err
	}
	return DatasetReport{Dataset: d, Version: l.version, Checksum: l.checksum, Counts: counts, Notes: l.notes}, nil
}

// datasetVersion names the pinned snapshot for datasets that carry no version of their own.
func datasetVersion(d Dataset) string {
	switch d {
	case Waller:
		return "vocab: mugiten/jadb@" + wallerCommitVoc[:7] + ", kanji: Bluskyo/JLPT_Vocabulary@" + wallerCommitKan[:7]
	case Kanjium:
		return "mifunetoshiro/kanjium@" + kanjiumCommit[:7]
	}
	return ""
}

// combinedChecksum fingerprints several files at once, independent of order.
func combinedChecksum(files []FetchedFile) string {
	lines := make([]string, len(files))
	for i, f := range files {
		lines[i] = f.Name + " " + f.Checksum
	}
	sort.Strings(lines)
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return hex.EncodeToString(sum[:])
}

type readCloser struct {
	io.Reader
	closers []io.Closer
}

func (r readCloser) Close() error {
	var first error
	for _, c := range r.closers {
		if err := c.Close(); err != nil && first == nil {
			first = err
		}
	}
	return first
}

// openMaybeGzip opens a file, transparently decompressing it when it is gzip.
func openMaybeGzip(path string) (io.ReadCloser, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	br := bufio.NewReaderSize(f, 256*1024)
	magic, _ := br.Peek(2)
	if len(magic) == 2 && magic[0] == 0x1f && magic[1] == 0x8b {
		zr, err := gzip.NewReader(br)
		if err != nil {
			f.Close()
			return nil, err
		}
		return readCloser{Reader: zr, closers: []io.Closer{zr, f}}, nil
	}
	return readCloser{Reader: br, closers: []io.Closer{f}}, nil
}

// arr makes a NOT NULL text[] value out of a possibly nil slice.
func arr(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

// copyRows bulk-inserts rows with COPY.
func copyRows(ctx context.Context, tx pgx.Tx, table string, cols []string, rows [][]any) error {
	if len(rows) == 0 {
		return nil
	}
	_, err := tx.CopyFrom(ctx, pgx.Identifier{table}, cols, pgx.CopyFromRows(rows))
	if err != nil {
		return fmt.Errorf("copy into %s: %w", table, err)
	}
	return nil
}

// pruneMissing deletes rows of table whose key column is not in keep. Keys go
// through a temporary table so the anti-join stays fast for hundreds of
// thousands of keys.
func pruneMissing(ctx context.Context, tx pgx.Tx, table, keyCol, keyType string, keep [][]any) (int64, error) {
	tmp := "_keep_" + table
	if _, err := tx.Exec(ctx, fmt.Sprintf("CREATE TEMP TABLE %s (k %s) ON COMMIT DROP", tmp, keyType)); err != nil {
		return 0, err
	}
	if err := copyRows(ctx, tx, tmp, []string{"k"}, keep); err != nil {
		return 0, err
	}
	tag, err := tx.Exec(ctx, fmt.Sprintf(
		"DELETE FROM %[1]s t WHERE NOT EXISTS (SELECT 1 FROM %[2]s k WHERE k.k = t.%[3]s)", table, tmp, keyCol))
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

// ---- JMdict ----------------------------------------------------------------

func loadJMdict(ctx context.Context, tx pgx.Tx, ff FetchedFile, log *slog.Logger) (loaded, error) {
	r, err := openMaybeGzip(ff.Path)
	if err != nil {
		return loaded{}, err
	}
	defer r.Close()

	// Forms and senses are replaced wholesale; entries are upserted so that
	// ent_seq rows (which other tables may point at) are never deleted and
	// recreated.
	for _, t := range []string{"jmdict_senses", "jmdict_readings", "jmdict_kanji_forms"} {
		if _, err := tx.Exec(ctx, "DELETE FROM "+t); err != nil {
			return loaded{}, err
		}
	}

	var (
		batch []JMdictEntry
		seen  [][]any
		total int
	)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		ids := make([]int64, len(batch))
		common := make([]bool, len(batch))
		var kanji, readings, senses [][]any
		for i, e := range batch {
			ids[i], common[i] = e.EntSeq, e.Common
			seen = append(seen, []any{e.EntSeq})
			for j, k := range e.Kanji {
				kanji = append(kanji, []any{e.EntSeq, int16(j), k.Text, arr(k.Info), arr(k.Priority)})
			}
			for j, rd := range e.Readings {
				readings = append(readings, []any{e.EntSeq, int16(j), rd.Text, rd.NoKanji, arr(rd.RestrictTo), arr(rd.Info), arr(rd.Priority)})
			}
			for j, s := range e.Senses {
				senses = append(senses, []any{e.EntSeq, int16(j), arr(s.POS), arr(s.Field), arr(s.Misc), arr(s.Dialect),
					arr(s.Info), arr(s.StagK), arr(s.StagR), arr(s.Xref), arr(s.Antonym), arr(s.Glosses)})
			}
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO jmdict_entries (ent_seq, is_common)
			SELECT * FROM unnest($1::bigint[], $2::boolean[])
			ON CONFLICT (ent_seq) DO UPDATE SET is_common = EXCLUDED.is_common`, ids, common); err != nil {
			return err
		}
		if err := copyRows(ctx, tx, "jmdict_kanji_forms", []string{"ent_seq", "ord", "text", "info", "priority"}, kanji); err != nil {
			return err
		}
		if err := copyRows(ctx, tx, "jmdict_readings", []string{"ent_seq", "ord", "text", "no_kanji", "restrict_to", "info", "priority"}, readings); err != nil {
			return err
		}
		if err := copyRows(ctx, tx, "jmdict_senses",
			[]string{"ent_seq", "ord", "pos", "field", "misc", "dialect", "info", "stagk", "stagr", "xref", "antonym", "glosses"}, senses); err != nil {
			return err
		}
		total += len(batch)
		batch = batch[:0]
		if total%50000 < importBatch {
			log.Info("jmdict progress", "entries", total)
		}
		return nil
	}

	hdr, err := ParseJMdict(r, func(e JMdictEntry) error {
		batch = append(batch, e)
		if len(batch) >= importBatch {
			return flush()
		}
		return nil
	})
	if err != nil {
		return loaded{}, err
	}
	if err := flush(); err != nil {
		return loaded{}, err
	}
	if total == 0 {
		return loaded{}, errors.New("no entries found in the JMdict file")
	}

	if _, err := pruneMissing(ctx, tx, "jmdict_entries", "ent_seq", "bigint", seen); err != nil {
		return loaded{}, fmt.Errorf("prune jmdict entries: %w", err)
	}

	if _, err := tx.Exec(ctx, "DELETE FROM jmdict_tags"); err != nil {
		return loaded{}, err
	}
	codes := make([]string, 0, len(hdr.Tags))
	for c := range hdr.Tags {
		codes = append(codes, c)
	}
	slices.Sort(codes)
	var tags [][]any
	for _, c := range codes {
		tags = append(tags, []any{c, hdr.Tags[c]})
	}
	if err := copyRows(ctx, tx, "jmdict_tags", []string{"code", "description"}, tags); err != nil {
		return loaded{}, err
	}
	return loaded{version: hdr.Created, checksum: ff.Checksum, fetchedAt: ff.FetchedAt}, nil
}

// ---- KANJIDIC2 -------------------------------------------------------------

func loadKanjidic(ctx context.Context, tx pgx.Tx, ff FetchedFile) (loaded, error) {
	r, err := openMaybeGzip(ff.Path)
	if err != nil {
		return loaded{}, err
	}
	defer r.Close()

	var kanji []KanjidicEntry
	hdr, err := ParseKanjidic(r, func(k KanjidicEntry) error {
		kanji = append(kanji, k)
		return nil
	})
	if err != nil {
		return loaded{}, err
	}
	if len(kanji) == 0 {
		return loaded{}, errors.New("no characters found in the KANJIDIC2 file")
	}

	for _, t := range []string{"kanji_readings", "kanji_meanings"} {
		if _, err := tx.Exec(ctx, "DELETE FROM "+t); err != nil {
			return loaded{}, err
		}
	}
	nullable := func(v *int) any {
		if v == nil {
			return nil
		}
		return int32(*v)
	}
	var seen, readings, meanings [][]any
	for start := 0; start < len(kanji); start += importBatch {
		end := min(start+importBatch, len(kanji))
		b := &pgx.Batch{}
		for _, k := range kanji[start:end] {
			var stroke any
			if k.StrokeCount > 0 {
				stroke = int16(k.StrokeCount)
			}
			var grade, legacy any
			if k.Grade != nil {
				grade = int16(*k.Grade)
			}
			if k.LegacyJLPT != nil {
				legacy = int16(*k.LegacyJLPT)
			}
			b.Queue(`
				INSERT INTO kanji (literal, grade, stroke_count, frequency, legacy_jlpt, nanori)
				VALUES ($1, $2, $3, $4, $5, $6)
				ON CONFLICT (literal) DO UPDATE SET grade = EXCLUDED.grade, stroke_count = EXCLUDED.stroke_count,
					frequency = EXCLUDED.frequency, legacy_jlpt = EXCLUDED.legacy_jlpt, nanori = EXCLUDED.nanori`,
				k.Literal, grade, stroke, nullable(k.Frequency), legacy, arr(k.Nanori))
			seen = append(seen, []any{k.Literal})
			for i, rd := range k.On {
				readings = append(readings, []any{k.Literal, "on", int16(i), rd})
			}
			for i, rd := range k.Kun {
				readings = append(readings, []any{k.Literal, "kun", int16(i), rd})
			}
			for i, m := range k.Meanings {
				meanings = append(meanings, []any{k.Literal, int16(i), m})
			}
		}
		res := tx.SendBatch(ctx, b)
		for range end - start {
			if _, err := res.Exec(); err != nil {
				res.Close()
				return loaded{}, err
			}
		}
		if err := res.Close(); err != nil {
			return loaded{}, err
		}
	}
	if _, err := pruneMissing(ctx, tx, "kanji", "literal", "text", seen); err != nil {
		return loaded{}, fmt.Errorf("prune kanji: %w", err)
	}
	if err := copyRows(ctx, tx, "kanji_readings", []string{"literal", "kind", "ord", "reading"}, readings); err != nil {
		return loaded{}, err
	}
	if err := copyRows(ctx, tx, "kanji_meanings", []string{"literal", "ord", "meaning"}, meanings); err != nil {
		return loaded{}, err
	}
	return loaded{version: hdr.DatabaseVersion, checksum: ff.Checksum, fetchedAt: ff.FetchedAt}, nil
}

// ---- Waller JLPT lists -----------------------------------------------------

func loadWaller(ctx context.Context, tx pgx.Tx, files []FetchedFile) (loaded, error) {
	var jmdictEntries int
	if err := tx.QueryRow(ctx, "SELECT count(*) FROM jmdict_entries").Scan(&jmdictEntries); err != nil {
		return loaded{}, err
	}
	if jmdictEntries == 0 {
		return loaded{}, errors.New("jmdict_entries is empty: import jmdict before the JLPT lists, which are matched against it")
	}

	byName := map[string]FetchedFile{}
	for _, f := range files {
		byName[f.Name] = f
	}
	var (
		vocab      []WallerVocab
		kanjiLists = map[Level][]string{}
		dropped    int
	)
	for _, lvl := range Levels {
		if err := withFile(byName[WallerVocabFile(lvl)].Path, func(r io.Reader) error {
			rows, dups, err := ParseWallerVocab(lvl, r)
			vocab, dropped = append(vocab, rows...), dropped+dups
			return err
		}); err != nil {
			return loaded{}, err
		}
		if err := withFile(byName[WallerKanjiFile(lvl)].Path, func(r io.Reader) error {
			ks, err := ParseWallerKanji(r)
			kanjiLists[lvl] = ks
			return err
		}); err != nil {
			return loaded{}, err
		}
	}

	idx, err := buildFormIndex(ctx, tx, vocab)
	if err != nil {
		return loaded{}, err
	}

	for _, t := range []string{"jlpt_vocab_links", "jlpt_vocab_entries", "jlpt_kanji"} {
		if _, err := tx.Exec(ctx, "DELETE FROM "+t); err != nil {
			return loaded{}, err
		}
	}
	var entryRows, linkRows, kanjiRows [][]any
	for _, v := range vocab {
		ents, method := MatchVocab(v, idx)
		entryRows = append(entryRows, []any{string(v.Level), v.Written, v.Reading, v.Meaning, string(method)})
		for _, e := range ents {
			linkRows = append(linkRows, []any{string(v.Level), v.Written, v.Reading, e})
		}
	}
	for _, lvl := range Levels {
		seen := map[string]bool{}
		for _, k := range kanjiLists[lvl] {
			if !seen[k] {
				seen[k] = true
				kanjiRows = append(kanjiRows, []any{k, string(lvl)})
			}
		}
	}
	if err := copyRows(ctx, tx, "jlpt_vocab_entries", []string{"jlpt_level", "written", "reading", "meaning", "match_method"}, entryRows); err != nil {
		return loaded{}, err
	}
	if err := copyRows(ctx, tx, "jlpt_vocab_links", []string{"jlpt_level", "written", "reading", "ent_seq"}, linkRows); err != nil {
		return loaded{}, err
	}
	if err := copyRows(ctx, tx, "jlpt_kanji", []string{"literal", "jlpt_level"}, kanjiRows); err != nil {
		return loaded{}, err
	}

	notes := []string{}
	if dropped > 0 {
		notes = append(notes, fmt.Sprintf("%d vocabulary rows repeated within a level were kept once", dropped))
	}
	return loaded{checksum: combinedChecksum(files), fetchedAt: latestFetch(files), notes: notes}, nil
}

func withFile(path string, fn func(io.Reader) error) error {
	if path == "" {
		return errors.New("missing Waller list file")
	}
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	return fn(f)
}

func latestFetch(files []FetchedFile) time.Time {
	var t time.Time
	for _, f := range files {
		if f.FetchedAt.After(t) {
			t = f.FetchedAt
		}
	}
	return t
}

// buildFormIndex loads, from the JMdict tables, just the entries reachable
// from the strings the Waller rows could match.
func buildFormIndex(ctx context.Context, tx pgx.Tx, vocab []WallerVocab) (*FormIndex, error) {
	writtenSet, readingSet := map[string]bool{}, map[string]bool{}
	for _, v := range vocab {
		written, readings := v.lookupForms()
		if sw, sr, ok := v.stemForms(); ok {
			written, readings = append(written, sw...), append(readings, sr...)
		}
		for _, w := range written {
			writtenSet[w] = true
		}
		for _, r := range readings {
			readingSet[r] = true
		}
	}
	idx := NewFormIndex()

	rows, err := tx.Query(ctx, `
		SELECT k.ent_seq, k.text, r.text, e.is_common,
		       EXISTS (SELECT 1 FROM jmdict_senses s WHERE s.ent_seq = k.ent_seq AND 'uk' = ANY (s.misc))
		FROM jmdict_kanji_forms k
		JOIN jmdict_entries e ON e.ent_seq = k.ent_seq
		JOIN jmdict_readings r ON r.ent_seq = k.ent_seq AND NOT r.no_kanji
		     AND (cardinality(r.restrict_to) = 0 OR k.text = ANY (r.restrict_to))
		WHERE k.text = ANY ($1)`, keys(writtenSet))
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		f := FormRow{HasKanji: true}
		if err := rows.Scan(&f.EntSeq, &f.Written, &f.Reading, &f.Common, &f.UsuallyKana); err != nil {
			rows.Close()
			return nil, err
		}
		idx.AddPair(f)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	rows, err = tx.Query(ctx, `
		SELECT r.ent_seq, r.text, e.is_common,
		       EXISTS (SELECT 1 FROM jmdict_kanji_forms k WHERE k.ent_seq = r.ent_seq),
		       EXISTS (SELECT 1 FROM jmdict_senses s WHERE s.ent_seq = r.ent_seq AND 'uk' = ANY (s.misc))
		FROM jmdict_readings r
		JOIN jmdict_entries e ON e.ent_seq = r.ent_seq
		WHERE r.text = ANY ($1)`, keys(readingSet))
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var f FormRow
		if err := rows.Scan(&f.EntSeq, &f.Reading, &f.Common, &f.HasKanji, &f.UsuallyKana); err != nil {
			rows.Close()
			return nil, err
		}
		idx.AddReading(f)
	}
	rows.Close()
	return idx, rows.Err()
}

func keys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for k := range set {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// ---- Kanjium ---------------------------------------------------------------

func loadKanjium(ctx context.Context, tx pgx.Tx, ff FetchedFile) (loaded, error) {
	f, err := os.Open(ff.Path)
	if err != nil {
		return loaded{}, err
	}
	defer f.Close()
	entries, stats, err := ParseKanjiumAccents(f)
	if err != nil {
		return loaded{}, err
	}
	if len(entries) == 0 {
		return loaded{}, errors.New("no pitch accents found in the Kanjium file")
	}
	if _, err := tx.Exec(ctx, "DELETE FROM pitch_accents"); err != nil {
		return loaded{}, err
	}
	var rows [][]any
	for _, e := range entries {
		for i, a := range e.Accents {
			rows = append(rows, []any{e.Word, e.Reading, int16(i + 1), int16(a.Position), a.Tag, a.Primary})
		}
		if len(rows) >= 20*importBatch {
			if err := copyRows(ctx, tx, "pitch_accents", []string{"word", "reading", "rank", "pattern", "tag", "is_primary"}, rows); err != nil {
				return loaded{}, err
			}
			rows = rows[:0]
		}
	}
	if err := copyRows(ctx, tx, "pitch_accents", []string{"word", "reading", "rank", "pattern", "tag", "is_primary"}, rows); err != nil {
		return loaded{}, err
	}
	notes := []string{fmt.Sprintf("%d lines read; %d malformed lines and %d kanji words without a reading skipped",
		stats.Lines, stats.Malformed, stats.NoReading)}
	return loaded{checksum: ff.Checksum, fetchedAt: ff.FetchedAt, notes: notes}, nil
}

// ---- Grammar Catalogue -----------------------------------------------------

func loadGrammar(ctx context.Context, tx pgx.Tx, ff FetchedFile) (loaded, error) {
	f, err := os.Open(ff.Path)
	if err != nil {
		return loaded{}, err
	}
	defer f.Close()
	points, err := ParseGrammarCSV(f)
	if err != nil {
		return loaded{}, err
	}
	if len(points) == 0 {
		return loaded{}, errors.New("no Grammar Points found in the grammar CSV")
	}

	// Upsert on the natural key so a Grammar Point keeps its id across imports.
	// The catalogue-number constraint is deferred, so renumbering within one
	// import is fine.
	b := &pgx.Batch{}
	var keep [][]any
	for _, g := range points {
		b.Queue(`
			INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
			                            variants, normalised_pattern, normalised_variants)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
			ON CONFLICT (jlpt_level, normalised_pattern, ordinal) DO UPDATE SET
				catalogue_number = EXCLUDED.catalogue_number, pattern = EXCLUDED.pattern,
				romaji = EXCLUDED.romaji, meaning = EXCLUDED.meaning, variants = EXCLUDED.variants,
				normalised_variants = EXCLUDED.normalised_variants`,
			string(g.Level), g.Number, int16(g.Ordinal), g.Pattern, g.Romaji, g.Meaning,
			arr(g.Variants), g.NormalisedPattern, arr(g.NormalisedVariants))
		keep = append(keep, []any{string(g.Level) + "|" + g.NormalisedPattern + "|" + fmt.Sprint(g.Ordinal)})
	}
	res := tx.SendBatch(ctx, b)
	for range points {
		if _, err := res.Exec(); err != nil {
			res.Close()
			return loaded{}, err
		}
	}
	if err := res.Close(); err != nil {
		return loaded{}, err
	}

	tmp := "_keep_grammar"
	if _, err := tx.Exec(ctx, "CREATE TEMP TABLE "+tmp+" (k text) ON COMMIT DROP"); err != nil {
		return loaded{}, err
	}
	if err := copyRows(ctx, tx, tmp, []string{"k"}, keep); err != nil {
		return loaded{}, err
	}
	if _, err := tx.Exec(ctx, `
		DELETE FROM grammar_points g
		WHERE NOT EXISTS (SELECT 1 FROM `+tmp+` k WHERE k.k = g.jlpt_level || '|' || g.normalised_pattern || '|' || g.ordinal)`); err != nil {
		return loaded{}, fmt.Errorf("prune grammar points: %w", err)
	}
	return loaded{checksum: ff.Checksum, fetchedAt: ff.FetchedAt}, nil
}

// ---- Coverage --------------------------------------------------------------

// Coverage reports how well the lists and pitch data lined up with the
// dictionaries, so unmatched words are visible rather than silently dropped.
type Coverage struct {
	VocabRows      int
	VocabMatched   int
	VocabByMethod  map[MatchMethod]int
	VocabUnmatched []WallerVocab // up to the requested number of examples

	KanjiRows      int
	KanjiMatched   int
	KanjiUnmatched []KanjiListRow // up to the requested number of examples

	JMdictEntries   int
	JMdictWithPitch int
}

// KanjiListRow is one kanji on one level's list.
type KanjiListRow struct {
	Literal string
	Level   Level
}

// MeasureCoverage counts what matched. examples caps the unmatched samples.
func MeasureCoverage(ctx context.Context, q Querier, examples int) (Coverage, error) {
	c := Coverage{VocabByMethod: map[MatchMethod]int{}}
	scan := func(sql string, dest ...any) error { return q.QueryRow(ctx, sql).Scan(dest...) }

	if err := scan(`SELECT count(*), count(*) FILTER (WHERE match_method <> '') FROM jlpt_vocab_entries`, &c.VocabRows, &c.VocabMatched); err != nil {
		return c, err
	}
	rows, err := q.Query(ctx, `SELECT match_method, count(*) FROM jlpt_vocab_entries WHERE match_method <> '' GROUP BY 1`)
	if err != nil {
		return c, err
	}
	for rows.Next() {
		var m string
		var n int
		if err := rows.Scan(&m, &n); err != nil {
			rows.Close()
			return c, err
		}
		c.VocabByMethod[MatchMethod(m)] = n
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return c, err
	}

	rows, err = q.Query(ctx, `SELECT jlpt_level, written, reading, meaning FROM jlpt_vocab_entries
		WHERE match_method = '' ORDER BY jlpt_level DESC, written, reading LIMIT $1`, examples)
	if err != nil {
		return c, err
	}
	for rows.Next() {
		var v WallerVocab
		var lvl string
		if err := rows.Scan(&lvl, &v.Written, &v.Reading, &v.Meaning); err != nil {
			rows.Close()
			return c, err
		}
		v.Level = Level(lvl)
		c.VocabUnmatched = append(c.VocabUnmatched, v)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return c, err
	}

	if err := scan(`SELECT count(*), count(*) FILTER (WHERE k.literal IS NOT NULL)
		FROM jlpt_kanji j LEFT JOIN kanji k USING (literal)`, &c.KanjiRows, &c.KanjiMatched); err != nil {
		return c, err
	}
	rows, err = q.Query(ctx, `SELECT j.literal, j.jlpt_level FROM jlpt_kanji j LEFT JOIN kanji k USING (literal)
		WHERE k.literal IS NULL ORDER BY j.jlpt_level DESC, j.literal LIMIT $1`, examples)
	if err != nil {
		return c, err
	}
	for rows.Next() {
		var r KanjiListRow
		var lvl string
		if err := rows.Scan(&r.Literal, &lvl); err != nil {
			rows.Close()
			return c, err
		}
		r.Level = Level(lvl)
		c.KanjiUnmatched = append(c.KanjiUnmatched, r)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return c, err
	}

	// An entry has pitch data when Kanjium lists one of its spellings (a kanji
	// form, or the reading itself for kana words) with one of its readings.
	// Written as joins on (word, reading): a correlated EXISTS ... OR EXISTS form
	// of this query ran for over 14 minutes on the full dictionary.
	if err := scan(`SELECT count(*) FROM jmdict_entries`, &c.JMdictEntries); err != nil {
		return c, err
	}
	err = scan(`
		SELECT count(*) FROM (
			SELECT r.ent_seq FROM jmdict_readings r
			JOIN pitch_accents p ON p.word = r.text AND p.reading = r.text
			WHERE p.is_primary
			UNION
			SELECT k.ent_seq FROM jmdict_kanji_forms k
			JOIN jmdict_readings r ON r.ent_seq = k.ent_seq
			JOIN pitch_accents p ON p.word = k.text AND p.reading = r.text
			WHERE p.is_primary
		) s`, &c.JMdictWithPitch)
	return c, err
}
