package refdata

import (
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// GrammarPoint is one row of the Grammar Catalogue (see GLOSSARY.md): a
// grammar pattern at a specific JLPT Level.
//
// Identity is (Level, NormalisedPattern, Ordinal). Ordinal is 1 for almost
// every point; it only exceeds 1 where the spreadsheet lists the same pattern
// twice at one level (e.g. のに at N4 appears as #62 and #63 with different
// meanings), so those stay two distinct points.
type GrammarPoint struct {
	Level   Level
	Number  int // catalogue number within the level, as in the spreadsheet
	Ordinal int // 1-based occurrence of NormalisedPattern within Level

	Pattern  string   // as written in the spreadsheet
	Romaji   string
	Meaning  string
	Variants []string // Pattern split on ・ and / (see SplitVariants)

	// NormalisedPattern is the normalised variants joined with "・".
	NormalisedPattern  string
	NormalisedVariants []string
}

// NormalisePattern reduces one grammar pattern (a single variant) to the form
// used for matching. The rules, in order:
//
//  1. Unicode NFKC: full-width Latin/digits become ASCII, half-width katakana
//     become full-width, and the full-width tilde ～ becomes "~".
//  2. Annotation markers in square brackets, such as "[A]" or "[2]", are
//     removed together with their content.
//  3. Wildcard and punctuation marks are removed: the tilde "~" and wave dash
//     〜, ellipses (… and ・ runs), 、 。 , . and all whitespace.
//  4. Bracket characters ( ) 「 」 『 』 are removed but their content is kept,
//     so an optional part such as とか（で） becomes とかで.
//  5. ASCII letters are lower-cased.
//
// Hyphens, "+" and "&" are kept.
func NormalisePattern(s string) string {
	s = norm.NFKC.String(s)
	s = stripSquareBrackets(s)
	var b strings.Builder
	for _, r := range s {
		switch {
		case unicode.IsSpace(r):
		case strings.ContainsRune("~〜…・、。,.()「」『』", r):
		default:
			b.WriteRune(unicode.ToLower(r))
		}
	}
	return b.String()
}

// stripSquareBrackets removes [..] spans including the brackets.
func stripSquareBrackets(s string) string {
	var b strings.Builder
	depth := 0
	for _, r := range s {
		switch {
		case r == '[':
			depth++
		case r == ']' && depth > 0:
			depth--
		case depth == 0:
			b.WriteRune(r)
		}
	}
	return b.String()
}

// SplitVariants splits a spreadsheet pattern into its alternative spellings.
// Separators are the middle dot ・ and the slash (/ or ／). A run of two or
// more dots (・・・) is an ellipsis, not a separator, and separators inside
// brackets such as 「〜が・けれど」 or （で/が） do not split.
func SplitVariants(pattern string) []string {
	runes := []rune(pattern)
	var (
		out   []string
		cur   strings.Builder
		depth int
	)
	flush := func() {
		if v := strings.TrimSpace(cur.String()); v != "" {
			out = append(out, v)
		}
		cur.Reset()
	}
	for i := 0; i < len(runes); i++ {
		r := runes[i]
		switch r {
		case '「', '（', '(', '[', '『':
			depth++
		case '」', '）', ')', ']', '』':
			if depth > 0 {
				depth--
			}
		}
		isSep := false
		if depth == 0 {
			switch r {
			case '/', '／':
				isSep = true
			case '・':
				run := 1
				for i+run < len(runes) && runes[i+run] == '・' {
					run++
				}
				if run == 1 {
					isSep = true
				} else {
					// Ellipsis: keep the whole run.
					for j := 0; j < run; j++ {
						cur.WriteRune('・')
					}
					i += run - 1
					continue
				}
			}
		}
		if isSep {
			flush()
			continue
		}
		cur.WriteRune(r)
	}
	flush()
	return out
}

// ParseGrammarCSV reads data/grammar/jlpt-grammar.csv: columns are JLPT level,
// catalogue number, Japanese pattern, romaji and meaning; later columns (spare
// columns and the "source:" note on the first row) are ignored. Rows whose
// level column is blank are skipped.
func ParseGrammarCSV(r io.Reader) ([]GrammarPoint, error) {
	cr := csv.NewReader(r)
	cr.FieldsPerRecord = -1
	cr.LazyQuotes = true

	var (
		points  []GrammarPoint
		ordinal = map[string]int{}
		numbers = map[string]bool{}
		first   = true
	)
	for line := 1; ; line++ {
		rec, err := cr.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("grammar csv row %d: %w", line, err)
		}
		if first {
			first = false
			if len(rec) > 0 {
				rec[0] = strings.TrimPrefix(rec[0], utf8BOM)
			}
		}
		if len(rec) == 0 || strings.TrimSpace(rec[0]) == "" {
			continue
		}
		if len(rec) < 5 {
			return nil, fmt.Errorf("grammar csv row %d: want at least 5 columns, got %d", line, len(rec))
		}
		level, err := ParseLevel(strings.TrimSpace(rec[0]))
		if err != nil {
			return nil, fmt.Errorf("grammar csv row %d: %w", line, err)
		}
		number, err := strconv.Atoi(strings.TrimSpace(rec[1]))
		if err != nil || number <= 0 {
			return nil, fmt.Errorf("grammar csv row %d: bad catalogue number %q", line, rec[1])
		}
		numKey := string(level) + "#" + strconv.Itoa(number)
		if numbers[numKey] {
			return nil, fmt.Errorf("grammar csv row %d: %s #%d appears twice", line, level, number)
		}
		numbers[numKey] = true

		pattern := strings.TrimSpace(rec[2])
		variants := SplitVariants(pattern)
		if len(variants) == 0 {
			return nil, fmt.Errorf("grammar csv row %d: empty pattern", line)
		}
		normVariants := make([]string, 0, len(variants))
		for _, v := range variants {
			if n := NormalisePattern(v); n != "" {
				normVariants = append(normVariants, n)
			}
		}
		if len(normVariants) == 0 {
			return nil, fmt.Errorf("grammar csv row %d: pattern %q is empty once normalised", line, pattern)
		}
		normalised := strings.Join(normVariants, "・")
		idKey := string(level) + "|" + normalised
		ordinal[idKey]++

		points = append(points, GrammarPoint{
			Level:              level,
			Number:             number,
			Ordinal:            ordinal[idKey],
			Pattern:            pattern,
			Romaji:             strings.TrimSpace(rec[3]),
			Meaning:            strings.TrimSpace(rec[4]),
			Variants:           variants,
			NormalisedPattern:  normalised,
			NormalisedVariants: normVariants,
		})
	}
	return points, nil
}
