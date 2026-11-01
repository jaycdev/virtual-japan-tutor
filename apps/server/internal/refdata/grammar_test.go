package refdata_test

import (
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

func TestNormalisePattern(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"plain", "のに", "のに"},
		{"wave dash", "〜てしまう", "てしまう"},
		{"fullwidth tilde", "～てしまう", "てしまう"},
		{"tilde in the middle", "あまり～ない", "あまりない"},
		{"ellipsis dots", "は〜より・・・です", "はよりです"},
		{"horizontal ellipsis", "は…です", "はです"},
		{"whitespace", " て しまう　", "てしまう"},
		{"optional part keeps its content", "とか（で）", "とかで"},
		{"ascii parens", "とか(で)", "とかで"},
		{"annotation markers are dropped", "の中で[A]が一番", "の中でが一番"},
		{"footnote marker", "より [2]", "より"},
		{"corner brackets", "こそ「が」", "こそが"},
		{"fullwidth latin", "Ａ＋は", "a+は"},
		{"halfwidth katakana", "ﾃｼﾏｳ", "テシマウ"},
		{"ascii is lowercased", "い-Adjectives", "い-adjectives"},
		{"ideographic comma", "が、も", "がも"},
		{"empty", "", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := refdata.NormalisePattern(c.in); got != c.want {
				t.Errorf("NormalisePattern(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestSplitVariants(t *testing.T) {
	cases := []struct {
		name, in string
		want     []string
	}{
		{"single", "のに", []string{"のに"}},
		{"middle dot", "ちゃいけない・じゃいけない", []string{"ちゃいけない", "じゃいけない"}},
		{"slash with spaces", "て / で", []string{"て", "で"}},
		{"slash without spaces", "に/へ", []string{"に", "へ"}},
		{"uneven spacing", "によると /によれば", []string{"によると", "によれば"}},
		{"three variants", "ごとき/ごとく/ごとし", []string{"ごとき", "ごとく", "ごとし"}},
		{"dot run is an ellipsis, not a separator", "は〜より・・・です", []string{"は〜より・・・です"}},
		{"separator inside corner brackets is kept", "こそ「〜が・けれど」", []string{"こそ「〜が・けれど」"}},
		{"separator inside parens is kept", "とか（で/が）", []string{"とか（で/が）"}},
		{"empty variants are dropped", "て・", []string{"て"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := refdata.SplitVariants(c.in); !reflect.DeepEqual(got, c.want) {
				t.Errorf("SplitVariants(%q) = %q, want %q", c.in, got, c.want)
			}
		})
	}
}

func TestParseGrammarCSV(t *testing.T) {
	f, err := os.Open("testdata/grammar.csv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	points, err := refdata.ParseGrammarCSV(f)
	if err != nil {
		t.Fatal(err)
	}

	// Blank rows and the source note column are ignored: 10 real rows.
	if len(points) != 10 {
		t.Fatalf("got %d points, want 10", len(points))
	}

	first := points[0]
	if first.Level != refdata.N5 || first.Number != 1 {
		t.Errorf("first = %s #%d", first.Level, first.Number)
	}
	if first.Pattern != "ちゃいけない・じゃいけない" || first.Romaji != "cha ikenai / ja ikenai" ||
		first.Meaning != "must not do (spoken Japanese)" {
		t.Errorf("first fields = %+v", first)
	}
	if !reflect.DeepEqual(first.Variants, []string{"ちゃいけない", "じゃいけない"}) {
		t.Errorf("variants = %q", first.Variants)
	}
	if first.NormalisedPattern != "ちゃいけない・じゃいけない" {
		t.Errorf("normalised pattern = %q", first.NormalisedPattern)
	}
	if !reflect.DeepEqual(first.NormalisedVariants, []string{"ちゃいけない", "じゃいけない"}) {
		t.Errorf("normalised variants = %q", first.NormalisedVariants)
	}

	// A quoted meaning keeps its commas.
	if points[1].Meaning != "to be (am, is, are)" {
		t.Errorf("meaning = %q", points[1].Meaning)
	}

	// A pattern without separators still has itself as the only variant.
	if !reflect.DeepEqual(points[3].Variants, []string{"のに"}) {
		t.Errorf("variants = %q", points[3].Variants)
	}

	// Ellipsis dots are not a separator, and they are not in the normalised form.
	if points[2].NormalisedPattern != "はよりです" {
		t.Errorf("normalised = %q", points[2].NormalisedPattern)
	}
}

func TestGrammarIdentityKeepsSamePatternAtDifferentLevelsAndWithinALevel(t *testing.T) {
	f, err := os.Open("testdata/grammar.csv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	points, err := refdata.ParseGrammarCSV(f)
	if err != nil {
		t.Fatal(err)
	}

	type key struct {
		level   refdata.Level
		pattern string
		ordinal int
	}
	seen := map[key]bool{}
	for _, p := range points {
		k := key{p.Level, p.NormalisedPattern, p.Ordinal}
		if seen[k] {
			t.Errorf("duplicate identity %+v", k)
		}
		seen[k] = true
	}
	// のに is N5 #4 and N4 #1 and #2: three Grammar Points, the two N4 ones told apart by ordinal.
	for _, k := range []key{{refdata.N5, "のに", 1}, {refdata.N4, "のに", 1}, {refdata.N4, "のに", 2}} {
		if !seen[k] {
			t.Errorf("missing %+v", k)
		}
	}
}

// The committed spreadsheet is the source of truth for the catalogue size
// (ADR-0005): 831 Grammar Points with these per-level counts.
func TestRealGrammarSpreadsheet(t *testing.T) {
	f, err := os.Open("../../../../data/grammar/jlpt-grammar.csv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	points, err := refdata.ParseGrammarCSV(f)
	if err != nil {
		t.Fatal(err)
	}

	perLevel := map[refdata.Level]int{}
	levelsOfPattern := map[string]map[refdata.Level]bool{}
	for _, p := range points {
		perLevel[p.Level]++
		if levelsOfPattern[p.NormalisedPattern] == nil {
			levelsOfPattern[p.NormalisedPattern] = map[refdata.Level]bool{}
		}
		levelsOfPattern[p.NormalisedPattern][p.Level] = true
	}
	want := map[refdata.Level]int{refdata.N5: 80, refdata.N4: 131, refdata.N3: 182, refdata.N2: 195, refdata.N1: 243}
	if len(points) != 831 || !reflect.DeepEqual(perLevel, want) {
		t.Errorf("got %d points, per level %v; want 831, %v", len(points), perLevel, want)
	}

	multiLevel := 0
	for _, levels := range levelsOfPattern {
		if len(levels) > 1 {
			multiLevel++
		}
	}
	t.Logf("%d normalised patterns appear at more than one level", multiLevel)
	if multiLevel != 13 {
		t.Errorf("expected the 13 known multi-level patterns, got %d", multiLevel)
	}
}

func TestParseGrammarCSVRejectsUnknownLevel(t *testing.T) {
	_, err := refdata.ParseGrammarCSV(strings.NewReader("N9,1,x,y,z,,,,,,\n"))
	if err == nil {
		t.Fatal("expected an error for level N9")
	}
}
