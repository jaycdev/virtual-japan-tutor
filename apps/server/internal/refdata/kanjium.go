package refdata

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
	"unicode"
)

// PitchAccent is one pitch pattern of a word.
type PitchAccent struct {
	// Position is the pitch accent nucleus as a mora number: 0 is flat
	// (heiban), 1 drops after the first mora, 2 after the second, and so on.
	Position int
	// Tag is the part-of-speech note Kanjium sometimes attaches, e.g. "副"
	// (adverb) in "(副)0". Empty when the pattern is untagged.
	Tag string
	// Primary marks the most common pattern. See ParseKanjiumAccents.
	Primary bool
}

// PitchEntry is every pitch pattern for one (word, reading) pair, in the
// order Kanjium lists them.
type PitchEntry struct {
	Word    string
	Reading string
	Accents []PitchAccent
}

// PitchStats counts lines that could not be turned into entries.
type PitchStats struct {
	Lines     int // non-blank lines read
	Malformed int // not three tab-separated fields, or no usable pattern
	NoReading int // blank reading on a word that contains more than kana
}

// ParseKanjiumAccents reads Kanjium's accents.txt: one line per word with
// tab-separated word, reading and a comma-separated list of patterns such as
// "0,2" or "(副)0,(名)3". An empty reading means the word is written in kana
// and is its own reading.
//
// All patterns are kept, in file order. Kanjium has no frequency data, and
// the file lists the main pattern of a word first, so the first pattern of a
// (word, reading) pair is marked Primary ("most common"). Where the same pair
// occurs on several lines, patterns accumulate in line order and a repeated
// position is dropped, so the first line wins.
func ParseKanjiumAccents(r io.Reader) ([]PitchEntry, PitchStats, error) {
	var (
		stats   PitchStats
		entries []PitchEntry
		index   = map[[2]string]int{}
	)
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for sc.Scan() {
		line := strings.TrimRight(sc.Text(), "\r")
		if strings.TrimSpace(line) == "" {
			continue
		}
		stats.Lines++
		fields := strings.Split(line, "\t")
		if len(fields) != 3 {
			stats.Malformed++
			continue
		}
		word, reading := strings.TrimSpace(fields[0]), strings.TrimSpace(fields[1])
		if word == "" {
			stats.Malformed++
			continue
		}
		if reading == "" {
			if !isKana(word) {
				stats.NoReading++
				continue
			}
			reading = word
		}
		accents, ok := parsePitchPatterns(fields[2])
		if !ok {
			stats.Malformed++
			continue
		}

		key := [2]string{word, reading}
		i, seen := index[key]
		if !seen {
			i = len(entries)
			index[key] = i
			entries = append(entries, PitchEntry{Word: word, Reading: reading})
		}
		e := &entries[i]
		for _, a := range accents {
			if hasPosition(e.Accents, a.Position) {
				continue
			}
			a.Primary = len(e.Accents) == 0
			e.Accents = append(e.Accents, a)
		}
	}
	if err := sc.Err(); err != nil {
		return nil, stats, fmt.Errorf("kanjium accents: %w", err)
	}
	return entries, stats, nil
}

func parsePitchPatterns(s string) ([]PitchAccent, bool) {
	var out []PitchAccent
	for _, tok := range strings.Split(s, ",") {
		tok = strings.TrimSpace(tok)
		tag := ""
		if strings.HasPrefix(tok, "(") {
			end := strings.Index(tok, ")")
			if end < 0 {
				return nil, false
			}
			tag = tok[1:end]
			tok = strings.TrimSpace(tok[end+1:])
		}
		pos, err := strconv.Atoi(tok)
		if err != nil || pos < 0 {
			return nil, false
		}
		out = append(out, PitchAccent{Position: pos, Tag: tag})
	}
	return out, len(out) > 0
}

func hasPosition(as []PitchAccent, pos int) bool {
	for _, a := range as {
		if a.Position == pos {
			return true
		}
	}
	return false
}

// isKana reports whether s is non-empty and made only of hiragana, katakana
// and the prolonged sound mark.
func isKana(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if !unicode.Is(unicode.Hiragana, r) && !unicode.Is(unicode.Katakana, r) && r != 'ー' {
			return false
		}
	}
	return true
}
