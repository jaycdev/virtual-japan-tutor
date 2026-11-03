package refdata

import "strings"

// Headword is the form of an entry to show when the Learner has not chosen one
// (a story's vocabulary list, an item list, a dictionary entry reached by id).
//
// It is the first kanji form, with two exceptions that JMdict marks:
//
//   - a kanji form tagged rK (rarely used kanji form) is skipped, so an entry
//     never leads with a spelling the Learner is unlikely to meet;
//   - an entry whose first sense is tagged uk (usually written using kana
//     alone) leads with its first reading, so そこ shows as そこ, not 其処.
//
// The first sense decides because its gloss is the one shown beside the
// headword. An entry with no readings keeps its kanji form, and an entry with
// no kanji form (or only rK ones) shows its first reading.
//
// HeadwordSQL implements the same rule for queries that cannot load the
// whole entry; headword_test.go holds both to the same cases.
func (e JMdictEntry) Headword() string {
	kanji := ""
	for _, k := range e.Kanji {
		if !hasTag(k.Info, tagRareKanji) {
			kanji = k.Text
			break
		}
	}
	reading := ""
	if len(e.Readings) > 0 {
		reading = e.Readings[0].Text
	}
	if len(e.Senses) > 0 && hasTag(e.Senses[0].Misc, tagUsuallyKana) && reading != "" {
		return reading
	}
	if kanji != "" {
		return kanji
	}
	return reading
}

const (
	tagUsuallyKana = "uk" // sense: word usually written using kana alone
	tagRareKanji   = "rK" // kanji form: rarely used kanji form
)

func hasTag(tags []string, tag string) bool {
	for _, t := range tags {
		if t == tag {
			return true
		}
	}
	return false
}

// HeadwordSQL returns a scalar SQL expression that evaluates Headword for one
// entry, or NULL when the entry has no kanji form and no reading.
//
// match builds the condition tying a table alias to the entry, e.g.
// func(a string) string { return a + ".ent_seq = e.ent_seq" }; it is called
// once per table the expression reads.
func HeadwordSQL(match func(alias string) string) string {
	kanji := `(SELECT k.text FROM jmdict_kanji_forms k
		            WHERE ` + match("k") + ` AND NOT ('` + tagRareKanji + `' = ANY (k.info))
		            ORDER BY k.ord LIMIT 1)`
	reading := `(SELECT r.text FROM jmdict_readings r
		            WHERE ` + match("r") + ` ORDER BY r.ord LIMIT 1)`
	usuallyKana := `COALESCE((SELECT '` + tagUsuallyKana + `' = ANY (s.misc) FROM jmdict_senses s
		            WHERE ` + match("s") + ` ORDER BY s.ord LIMIT 1), false)`
	return strings.Join([]string{
		"CASE WHEN " + usuallyKana,
		"THEN COALESCE(" + reading + ", " + kanji + ")",
		"ELSE COALESCE(" + kanji + ", " + reading + ") END",
	}, " ")
}
