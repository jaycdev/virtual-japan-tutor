// Package refdata holds the app's global reference data: dictionary entries
// (JMdict), kanji (KANJIDIC2), JLPT Levels (Jonathan Waller's lists), pitch
// accents (Kanjium) and the Grammar Catalogue. It has two halves:
//
//   - the import side (parsers, Import) that loads the open datasets into
//     Postgres, repeatably and idempotently;
//   - the lookup side (Store) that the rest of the server queries.
//
// None of these tables belong to a user: they are shared reference data.
package refdata

import "fmt"

// Level is a JLPT Level, N5 (easiest) to N1 (hardest).
type Level string

const (
	N5 Level = "N5"
	N4 Level = "N4"
	N3 Level = "N3"
	N2 Level = "N2"
	N1 Level = "N1"
)

// Levels lists every JLPT Level from easiest to hardest.
var Levels = []Level{N5, N4, N3, N2, N1}

// ParseLevel accepts "N5".."N1" (any case) and returns the Level.
func ParseLevel(s string) (Level, error) {
	switch l := Level(upperASCII(s)); l {
	case N5, N4, N3, N2, N1:
		return l, nil
	}
	return "", fmt.Errorf("unknown JLPT level %q", s)
}

// Rank is 5 for N5 and 1 for N1, so a larger rank means an easier level.
// It is 0 for an invalid Level.
func (l Level) Rank() int {
	switch l {
	case N5:
		return 5
	case N4:
		return 4
	case N3:
		return 3
	case N2:
		return 2
	case N1:
		return 1
	}
	return 0
}

// levelFromRank is the inverse of Rank.
func levelFromRank(rank int) (Level, bool) {
	for _, l := range Levels {
		if l.Rank() == rank {
			return l, true
		}
	}
	return "", false
}

// utf8BOM is the byte order mark some spreadsheet exports start with.
const utf8BOM = "\xef\xbb\xbf"

func upperASCII(s string) string {
	b := []byte(s)
	for i, c := range b {
		if 'a' <= c && c <= 'z' {
			b[i] = c - 'a' + 'A'
		}
	}
	return string(b)
}
