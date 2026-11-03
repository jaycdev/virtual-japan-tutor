package refdata_test

import (
	"context"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// headwordCases hold Headword and HeadwordSQL to the same rule.
var headwordCases = []struct {
	name  string
	entry refdata.JMdictEntry
	want  string
}{
	{
		name: "ordinary word leads with its first kanji form",
		entry: refdata.JMdictEntry{
			Kanji:    []refdata.JMdictKanji{{Text: "学校"}},
			Readings: []refdata.JMdictReading{{Text: "がっこう"}},
			Senses:   []refdata.JMdictSense{{Glosses: []string{"school"}}},
		},
		want: "学校",
	},
	{
		name: "usually-kana first sense shows the reading (そこ, not 其処)",
		entry: refdata.JMdictEntry{
			Kanji:    []refdata.JMdictKanji{{Text: "其処"}, {Text: "其所"}},
			Readings: []refdata.JMdictReading{{Text: "そこ"}},
			Senses:   []refdata.JMdictSense{{Misc: []string{"uk"}, Glosses: []string{"there"}}},
		},
		want: "そこ",
	},
	{
		name: "uk on a later sense does not hide the kanji (居る)",
		entry: refdata.JMdictEntry{
			Kanji:    []refdata.JMdictKanji{{Text: "居る"}},
			Readings: []refdata.JMdictReading{{Text: "いる"}},
			Senses: []refdata.JMdictSense{
				{Glosses: []string{"to be"}},
				{Misc: []string{"uk"}, Glosses: []string{"to be -ing"}},
			},
		},
		want: "居る",
	},
	{
		name: "rarely used kanji form is skipped for the next one",
		entry: refdata.JMdictEntry{
			Kanji:    []refdata.JMdictKanji{{Text: "稀", Info: []string{"rK"}}, {Text: "希"}},
			Readings: []refdata.JMdictReading{{Text: "まれ"}},
			Senses:   []refdata.JMdictSense{{Glosses: []string{"rare"}}},
		},
		want: "希",
	},
	{
		name: "only rare kanji forms: fall back to the reading",
		entry: refdata.JMdictEntry{
			Kanji:    []refdata.JMdictKanji{{Text: "鮎魚女", Info: []string{"rK"}}},
			Readings: []refdata.JMdictReading{{Text: "あいなめ"}},
			Senses:   []refdata.JMdictSense{{Glosses: []string{"greenling"}}},
		},
		want: "あいなめ",
	},
	{
		name: "kana-only entry shows its reading",
		entry: refdata.JMdictEntry{
			Readings: []refdata.JMdictReading{{Text: "ねこ"}},
			Senses:   []refdata.JMdictSense{{Glosses: []string{"cat"}}},
		},
		want: "ねこ",
	},
	{
		name: "tags other than uk and rK change nothing",
		entry: refdata.JMdictEntry{
			Kanji:    []refdata.JMdictKanji{{Text: "断つ", Info: []string{"oK"}}},
			Readings: []refdata.JMdictReading{{Text: "たつ"}},
			Senses:   []refdata.JMdictSense{{Misc: []string{"arch"}, Glosses: []string{"to cut"}}},
		},
		want: "断つ",
	},
}

func TestHeadwordGo(t *testing.T) {
	for _, c := range headwordCases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.entry.Headword(); got != c.want {
				t.Errorf("Headword() = %q, want %q", got, c.want)
			}
		})
	}
}

func TestHeadwordSQLAgreesWithGo(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	const base int64 = 9_900_000
	for i, c := range headwordCases {
		ent := base + int64(i)
		if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES ($1, false)`, ent); err != nil {
			t.Fatalf("seed entry: %v", err)
		}
		for j, k := range c.entry.Kanji {
			if _, err := pool.Exec(ctx, `INSERT INTO jmdict_kanji_forms (ent_seq, ord, text, info) VALUES ($1, $2, $3, $4)`,
				ent, j+1, k.Text, nonNil(k.Info)); err != nil {
				t.Fatalf("seed kanji: %v", err)
			}
		}
		for j, r := range c.entry.Readings {
			if _, err := pool.Exec(ctx, `INSERT INTO jmdict_readings (ent_seq, ord, text) VALUES ($1, $2, $3)`, ent, j+1, r.Text); err != nil {
				t.Fatalf("seed reading: %v", err)
			}
		}
		for j, s := range c.entry.Senses {
			if _, err := pool.Exec(ctx, `INSERT INTO jmdict_senses (ent_seq, ord, misc, glosses) VALUES ($1, $2, $3, $4)`,
				ent, j+1, nonNil(s.Misc), nonNil(s.Glosses)); err != nil {
				t.Fatalf("seed sense: %v", err)
			}
		}
	}

	expr := refdata.HeadwordSQL(func(a string) string { return a + ".ent_seq = e.ent_seq" })
	for i, c := range headwordCases {
		var got string
		err := pool.QueryRow(ctx,
			`SELECT `+expr+` FROM jmdict_entries e WHERE e.ent_seq = $1`, base+int64(i)).Scan(&got)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got != c.want {
			t.Errorf("%s: HeadwordSQL = %q, want %q", c.name, got, c.want)
		}
	}
}

// nonNil keeps nil slices from becoming SQL NULL in NOT NULL array columns.
func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
