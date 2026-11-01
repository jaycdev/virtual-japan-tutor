package main

import (
	"fmt"
	"io"
	"slices"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

func printReport(w io.Writer, r *refdata.ImportReport, total time.Duration) {
	fmt.Fprintln(w, "\n== Import summary ==")
	for _, d := range r.Datasets {
		fmt.Fprintf(w, "%-10s version=%q sha256=%.12s… took %s\n", d.Dataset, d.Version, d.Checksum, d.Duration.Round(time.Millisecond))
		tables := make([]string, 0, len(d.Counts))
		for t := range d.Counts {
			tables = append(tables, t)
		}
		slices.Sort(tables)
		for _, t := range tables {
			fmt.Fprintf(w, "    %-20s %9d rows\n", t, d.Counts[t])
		}
		for _, n := range d.Notes {
			fmt.Fprintf(w, "    note: %s\n", n)
		}
	}

	if c := r.Coverage; c != nil && c.VocabRows > 0 {
		fmt.Fprintln(w, "\n== Match quality ==")
		fmt.Fprintf(w, "Waller vocabulary rows matched to JMdict: %d of %d (%s)\n", c.VocabMatched, c.VocabRows, pct(c.VocabMatched, c.VocabRows))
		for _, m := range []refdata.MatchMethod{refdata.MatchExact, refdata.MatchWritten, refdata.MatchKana, refdata.MatchKanaAmbiguous, refdata.MatchKanaFallback, refdata.MatchStem} {
			fmt.Fprintf(w, "    %-15s %6d\n", m, c.VocabByMethod[m])
		}
		fmt.Fprintf(w, "    %-15s %6d\n", "unmatched", c.VocabRows-c.VocabMatched)
		for _, v := range c.VocabUnmatched {
			fmt.Fprintf(w, "      unmatched %s: %q (%s) %s\n", v.Level, v.Written, v.Reading, v.Meaning)
		}
		fmt.Fprintf(w, "Waller kanji matched to KANJIDIC2: %d of %d (%s)\n", c.KanjiMatched, c.KanjiRows, pct(c.KanjiMatched, c.KanjiRows))
		for _, k := range c.KanjiUnmatched {
			fmt.Fprintf(w, "      unmatched %s: %s\n", k.Level, k.Literal)
		}
		fmt.Fprintf(w, "JMdict entries with Kanjium pitch data: %d of %d (%s)\n", c.JMdictWithPitch, c.JMdictEntries, pct(c.JMdictWithPitch, c.JMdictEntries))
	}
	fmt.Fprintf(w, "\nDone in %s.\n", total.Round(time.Millisecond))
}

func pct(n, d int) string {
	if d == 0 {
		return "n/a"
	}
	return fmt.Sprintf("%.1f%%", 100*float64(n)/float64(d))
}
