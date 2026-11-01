package refdata

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"slices"
	"strings"
	"unicode/utf8"
)

// WallerVocab is one row of Jonathan Waller's JLPT vocabulary list: a word
// (written form and reading, as the list gives them) at one JLPT Level. Words
// written only in kana have an empty Written.
type WallerVocab struct {
	Level   Level
	Written string
	Reading string
	Meaning string
}

// ParseWallerVocab reads one level's vocabulary list: CSV without a header
// and three columns (written form, reading, meaning). Rows repeated within
// the list (same written form and reading) are kept once; the number dropped
// is returned.
func ParseWallerVocab(level Level, r io.Reader) (rows []WallerVocab, duplicates int, err error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true
	seen := map[[2]string]bool{}
	for line := 1; ; line++ {
		rec, rerr := cr.Read()
		if errors.Is(rerr, io.EOF) {
			return rows, duplicates, nil
		}
		if rerr != nil {
			return nil, 0, fmt.Errorf("waller vocab %s row %d: %w", level, line, rerr)
		}
		for len(rec) < 3 {
			rec = append(rec, "")
		}
		if line == 1 {
			rec[0] = strings.TrimPrefix(rec[0], utf8BOM)
		}
		row := WallerVocab{
			Level:   level,
			Written: strings.TrimSpace(rec[0]),
			Reading: strings.TrimSpace(rec[1]),
			Meaning: strings.TrimSpace(rec[2]),
		}
		if row.Written == "" && row.Reading == "" {
			if row.Meaning == "" {
				continue // blank line
			}
			return nil, 0, fmt.Errorf("waller vocab %s row %d: neither written form nor reading", level, line)
		}
		key := [2]string{row.Written, row.Reading}
		if seen[key] {
			duplicates++
			continue
		}
		seen[key] = true
		rows = append(rows, row)
	}
}

// ParseWallerKanji reads one level's kanji list: a CSV with a "Kanji" header
// row and one character per row.
func ParseWallerKanji(r io.Reader) ([]string, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	var out []string
	for line := 1; ; line++ {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, fmt.Errorf("waller kanji row %d: %w", line, err)
		}
		if len(rec) == 0 {
			continue
		}
		k := strings.TrimSpace(strings.TrimPrefix(rec[0], utf8BOM))
		if k == "" || (line == 1 && k == "Kanji") {
			continue
		}
		if len([]rune(k)) != 1 {
			return nil, fmt.Errorf("waller kanji row %d: %q is not a single character", line, k)
		}
		out = append(out, k)
	}
}

// WrittenCandidates lists the spellings to look up in JMdict for this row.
// The list uses "/" between alternatives, "（..）" for an optional or
// alternative tail, and "・" inside a word (お・金持ち); the middle dots are
// dropped. The fuller spelling of an optional part comes first.
func (w WallerVocab) WrittenCandidates() []string {
	var out []string
	for _, alt := range strings.FieldsFunc(w.Written, func(r rune) bool { return r == '/' || r == '／' }) {
		alt = strings.ReplaceAll(strings.TrimSpace(alt), "・", "")
		if alt != "" {
			out = append(out, expandParens(alt)...)
		}
	}
	return dedupe(out)
}

// ReadingCandidates lists the kana readings to look up. Alternatives are
// separated by "/", "、" or spaces; "(い)" marks an optional ending; a "・"
// separates parts ("べんきょう・する", "あす・あした"), giving the joined
// string, then each part. Anything that is not kana is dropped.
func (w WallerVocab) ReadingCandidates() []string {
	text := strings.NewReplacer("/", " ", "／", " ", "、", " ", ",", " ").Replace(w.Reading)
	var out []string
	for _, alt := range strings.Fields(text) {
		for _, p := range expandParens(alt) {
			if !strings.Contains(p, "・") {
				out = append(out, p)
				continue
			}
			var parts []string
			for _, part := range strings.Split(p, "・") {
				if part != "" {
					parts = append(parts, part)
				}
			}
			if len(parts) == 0 {
				continue
			}
			out = append(out, strings.Join(parts, ""))
			out = append(out, parts...)
		}
	}
	out = slices.DeleteFunc(out, func(s string) bool { return !isKana(s) })
	return dedupe(out)
}

// expandParens turns "a（b）" into ["ab", "a"]: the version with the bracketed
// text first, then without. Strings without brackets are returned as is.
func expandParens(s string) []string {
	open := strings.IndexAny(s, "（(")
	if open < 0 {
		return []string{s}
	}
	rest := s[open:]
	_, openSize := firstRune(rest)
	closeAt := strings.IndexAny(rest, "）)")
	if closeAt < 0 {
		return []string{s}
	}
	_, closeSize := firstRune(rest[closeAt:])
	head, inner, tail := s[:open], rest[openSize:closeAt], rest[closeAt+closeSize:]
	var out []string
	for _, t := range expandParens(tail) {
		out = append(out, head+inner+t)
	}
	for _, t := range expandParens(tail) {
		out = append(out, head+t)
	}
	return out
}

func firstRune(s string) (rune, int) {
	return utf8.DecodeRuneInString(s)
}

func dedupe(in []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, s := range in {
		if s != "" && !seen[s] {
			seen[s] = true
			out = append(out, s)
		}
	}
	return out
}

// FormRow describes one way a JMdict entry can be reached.
type FormRow struct {
	EntSeq  int64
	Written string // a kanji form; empty for reading-only rows
	Reading string
	// HasKanji is true when the entry has any kanji form.
	HasKanji bool
	// UsuallyKana is true when a sense is tagged "usually written in kana" (uk).
	UsuallyKana bool
	Common      bool
}

// FormIndex answers "which JMdict entries have this written form / reading?"
// for the strings relevant to one import. The importer fills it from the
// database; tests fill it by hand.
type FormIndex struct {
	pairs     map[[2]string][]FormRow
	byWritten map[string][]FormRow
	byReading map[string][]FormRow
}

func NewFormIndex() *FormIndex {
	return &FormIndex{
		pairs:     map[[2]string][]FormRow{},
		byWritten: map[string][]FormRow{},
		byReading: map[string][]FormRow{},
	}
}

// AddPair registers a (kanji form, reading) combination that the entry allows.
func (x *FormIndex) AddPair(r FormRow) {
	k := [2]string{r.Written, r.Reading}
	x.pairs[k] = append(x.pairs[k], r)
	x.byWritten[r.Written] = append(x.byWritten[r.Written], r)
}

// AddReading registers a reading of an entry, whether or not it has kanji.
func (x *FormIndex) AddReading(r FormRow) {
	x.byReading[r.Reading] = append(x.byReading[r.Reading], r)
}

// MatchMethod says how a list row was tied to dictionary entries.
type MatchMethod string

const (
	MatchNone MatchMethod = ""
	// MatchExact: a written form and reading from the row both belong to the entry.
	MatchExact MatchMethod = "exact"
	// MatchWritten: no reading agreed, but the written form belongs to exactly one entry.
	MatchWritten MatchMethod = "written"
	// MatchKana: a kana-only row with exactly one plausible entry.
	MatchKana MatchMethod = "kana"
	// MatchKanaAmbiguous: a kana-only row with several plausible entries; the best is chosen.
	MatchKanaAmbiguous MatchMethod = "kana_ambiguous"
)

// MatchVocab ties a Waller row to JMdict entries via the index. It tries, in
// order:
//
//  1. exact: any (written form, reading) combination from the row that an
//     entry has. Alternatives can match different entries (土曜/土曜日), and
//     all are returned.
//  2. written: when the row has a written form but no reading agrees, the
//     entry that is the only one with that form.
//  3. kana: when the row has no written form, entries with that reading that
//     have no kanji or are usually written in kana. If several remain, the
//     common one with the lowest ent_seq is chosen (MatchKanaAmbiguous).
//
// Anything else is unmatched (nil, MatchNone); the importer records and
// reports those rows instead of guessing.
func MatchVocab(row WallerVocab, idx *FormIndex) ([]int64, MatchMethod) {
	written, readings := row.WrittenCandidates(), row.ReadingCandidates()

	if len(written) > 0 {
		var found []int64
		for _, w := range written {
			for _, r := range readings {
				for _, f := range idx.pairs[[2]string{w, r}] {
					found = append(found, f.EntSeq)
				}
			}
		}
		if found = uniqueSorted(found); len(found) > 0 {
			return found, MatchExact
		}

		var byForm []int64
		for _, w := range written {
			for _, f := range idx.byWritten[w] {
				byForm = append(byForm, f.EntSeq)
			}
		}
		if byForm = uniqueSorted(byForm); len(byForm) == 1 {
			return byForm, MatchWritten
		}
		return nil, MatchNone
	}

	for _, r := range readings {
		var eligible []FormRow
		for _, f := range idx.byReading[r] {
			if !f.HasKanji || f.UsuallyKana {
				eligible = append(eligible, f)
			}
		}
		if len(eligible) == 0 {
			continue
		}
		slices.SortFunc(eligible, func(a, b FormRow) int {
			if a.Common != b.Common {
				if a.Common {
					return -1
				}
				return 1
			}
			switch {
			case a.EntSeq < b.EntSeq:
				return -1
			case a.EntSeq > b.EntSeq:
				return 1
			}
			return 0
		})
		if len(uniqueEnts(eligible)) == 1 {
			return []int64{eligible[0].EntSeq}, MatchKana
		}
		return []int64{eligible[0].EntSeq}, MatchKanaAmbiguous
	}
	return nil, MatchNone
}

func uniqueSorted(in []int64) []int64 {
	if len(in) == 0 {
		return nil
	}
	out := slices.Clone(in)
	slices.Sort(out)
	return slices.Compact(out)
}

func uniqueEnts(rows []FormRow) []int64 {
	ids := make([]int64, len(rows))
	for i, r := range rows {
		ids[i] = r.EntSeq
	}
	return uniqueSorted(ids)
}
