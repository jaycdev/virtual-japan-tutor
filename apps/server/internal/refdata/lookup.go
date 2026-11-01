package refdata

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Querier is the part of a pgx pool or transaction the Store needs.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Store looks up reference data. It is read-only and safe for concurrent use
// when the Querier is.
type Store struct {
	q Querier
}

func NewStore(q Querier) *Store { return &Store{q: q} }

// Vocabulary is a JMdict entry with its JLPT Level, if it is on Waller's lists.
type Vocabulary struct {
	JMdictEntry
	// JLPTLevel is the easiest level the word is listed at, or "" when it is
	// on no list.
	JLPTLevel Level
}

// Kanji is a KANJIDIC2 character with its JLPT Level, if it is on Waller's lists.
type Kanji struct {
	KanjidicEntry
	// JLPTLevel is the easiest level the kanji is listed at, or "" when it is
	// on no list. KanjidicEntry.LegacyJLPT is a different, older scale.
	JLPTLevel Level
}

// FindVocabulary returns the entries that can be written as written. written
// is a kanji form or a kana spelling; when reading is not empty, only entries
// that pair the two (honouring JMdict's reading restrictions) are returned.
// Common entries come first, then by ent_seq.
func (s *Store) FindVocabulary(ctx context.Context, written, reading string) ([]Vocabulary, error) {
	rows, err := s.q.Query(ctx, `
		SELECT e.ent_seq
		FROM jmdict_entries e
		WHERE EXISTS (
		        SELECT 1 FROM jmdict_kanji_forms k
		        WHERE k.ent_seq = e.ent_seq AND k.text = $1
		          AND ($2 = '' OR EXISTS (
		                SELECT 1 FROM jmdict_readings r
		                WHERE r.ent_seq = k.ent_seq AND r.text = $2 AND NOT r.no_kanji
		                  AND (cardinality(r.restrict_to) = 0 OR k.text = ANY (r.restrict_to))))
		      )
		   OR EXISTS (
		        SELECT 1 FROM jmdict_readings r
		        WHERE r.ent_seq = e.ent_seq AND r.text = $1 AND ($2 = '' OR $2 = $1)
		      )
		ORDER BY e.is_common DESC, e.ent_seq`, written, reading)
	if err != nil {
		return nil, fmt.Errorf("find vocabulary: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[int64])
	if err != nil {
		return nil, fmt.Errorf("find vocabulary: %w", err)
	}
	return s.loadVocabulary(ctx, ids)
}

// VocabularyJLPTLevel returns the JLPT Level of a JMdict entry, or ok=false
// when the entry is on no list.
func (s *Store) VocabularyJLPTLevel(ctx context.Context, entSeq int64) (Level, bool, error) {
	return s.level(ctx, `SELECT jlpt_level FROM jmdict_jlpt_level WHERE ent_seq = $1`, entSeq)
}

// KanjiJLPTLevel returns the JLPT Level of a kanji, or ok=false when it is on no list.
func (s *Store) KanjiJLPTLevel(ctx context.Context, literal string) (Level, bool, error) {
	return s.level(ctx, `SELECT jlpt_level FROM kanji_jlpt_level WHERE literal = $1`, literal)
}

func (s *Store) level(ctx context.Context, query string, arg any) (Level, bool, error) {
	var l string
	err := s.q.QueryRow(ctx, query, arg).Scan(&l)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("jlpt level: %w", err)
	}
	return Level(l), true, nil
}

func (s *Store) loadVocabulary(ctx context.Context, ids []int64) ([]Vocabulary, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	byID := make(map[int64]*Vocabulary, len(ids))
	out := make([]Vocabulary, len(ids))
	for i, id := range ids {
		out[i].EntSeq = id
		byID[id] = &out[i]
	}

	rows, err := s.q.Query(ctx, `
		SELECT e.ent_seq, e.is_common, COALESCE(l.jlpt_level, '')
		FROM jmdict_entries e LEFT JOIN jmdict_jlpt_level l USING (ent_seq)
		WHERE e.ent_seq = ANY ($1)`, ids)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var id int64
		var common bool
		var level string
		if err := rows.Scan(&id, &common, &level); err != nil {
			rows.Close()
			return nil, err
		}
		byID[id].Common, byID[id].JLPTLevel = common, Level(level)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if err := s.each(ctx, `SELECT ent_seq, text, info, priority FROM jmdict_kanji_forms WHERE ent_seq = ANY ($1) ORDER BY ent_seq, ord`, ids,
		func(rows pgx.Rows) error {
			var id int64
			var k JMdictKanji
			if err := rows.Scan(&id, &k.Text, &k.Info, &k.Priority); err != nil {
				return err
			}
			byID[id].Kanji = append(byID[id].Kanji, k)
			return nil
		}); err != nil {
		return nil, err
	}
	if err := s.each(ctx, `SELECT ent_seq, text, no_kanji, restrict_to, info, priority FROM jmdict_readings WHERE ent_seq = ANY ($1) ORDER BY ent_seq, ord`, ids,
		func(rows pgx.Rows) error {
			var id int64
			var r JMdictReading
			if err := rows.Scan(&id, &r.Text, &r.NoKanji, &r.RestrictTo, &r.Info, &r.Priority); err != nil {
				return err
			}
			byID[id].Readings = append(byID[id].Readings, r)
			return nil
		}); err != nil {
		return nil, err
	}
	if err := s.each(ctx, `SELECT ent_seq, pos, field, misc, dialect, info, stagk, stagr, xref, antonym, glosses
		FROM jmdict_senses WHERE ent_seq = ANY ($1) ORDER BY ent_seq, ord`, ids,
		func(rows pgx.Rows) error {
			var id int64
			var sn JMdictSense
			if err := rows.Scan(&id, &sn.POS, &sn.Field, &sn.Misc, &sn.Dialect, &sn.Info, &sn.StagK, &sn.StagR, &sn.Xref, &sn.Antonym, &sn.Glosses); err != nil {
				return err
			}
			byID[id].Senses = append(byID[id].Senses, sn)
			return nil
		}); err != nil {
		return nil, err
	}
	return out, nil
}

func (s *Store) each(ctx context.Context, query string, arg any, fn func(pgx.Rows) error) error {
	rows, err := s.q.Query(ctx, query, arg)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		if err := fn(rows); err != nil {
			return err
		}
	}
	return rows.Err()
}

// FindKanji returns the kanji with this literal, or ok=false when KANJIDIC2 lacks it.
func (s *Store) FindKanji(ctx context.Context, literal string) (Kanji, bool, error) {
	var k Kanji
	var grade, stroke, legacy *int16
	var freq *int32
	err := s.q.QueryRow(ctx, `
		SELECT k.literal, k.grade, k.stroke_count, k.frequency, k.legacy_jlpt, k.nanori, COALESCE(l.jlpt_level, '')
		FROM kanji k LEFT JOIN kanji_jlpt_level l USING (literal)
		WHERE k.literal = $1`, literal).Scan(&k.Literal, &grade, &stroke, &freq, &legacy, &k.Nanori, &k.JLPTLevel)
	if errors.Is(err, pgx.ErrNoRows) {
		return Kanji{}, false, nil
	}
	if err != nil {
		return Kanji{}, false, fmt.Errorf("find kanji: %w", err)
	}
	k.Grade, k.Frequency, k.LegacyJLPT = intPtr16(grade), intPtr32(freq), intPtr16(legacy)
	if stroke != nil {
		k.StrokeCount = int(*stroke)
	}

	if err := s.each(ctx, `SELECT kind, reading FROM kanji_readings WHERE literal = $1 ORDER BY kind, ord`, literal,
		func(rows pgx.Rows) error {
			var kind, reading string
			if err := rows.Scan(&kind, &reading); err != nil {
				return err
			}
			if kind == "on" {
				k.On = append(k.On, reading)
			} else {
				k.Kun = append(k.Kun, reading)
			}
			return nil
		}); err != nil {
		return Kanji{}, false, fmt.Errorf("find kanji: %w", err)
	}
	if err := s.each(ctx, `SELECT meaning FROM kanji_meanings WHERE literal = $1 ORDER BY ord`, literal,
		func(rows pgx.Rows) error {
			var m string
			if err := rows.Scan(&m); err != nil {
				return err
			}
			k.Meanings = append(k.Meanings, m)
			return nil
		}); err != nil {
		return Kanji{}, false, fmt.Errorf("find kanji: %w", err)
	}
	return k, true, nil
}

func intPtr16(v *int16) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

func intPtr32(v *int32) *int {
	if v == nil {
		return nil
	}
	n := int(*v)
	return &n
}

// PitchAccents returns every pitch pattern Kanjium lists for the pair, in
// Kanjium's order; the first has Primary set. It is empty for unknown pairs.
func (s *Store) PitchAccents(ctx context.Context, word, reading string) ([]PitchAccent, error) {
	var out []PitchAccent
	rows, err := s.q.Query(ctx, `SELECT pattern, tag, is_primary FROM pitch_accents WHERE word = $1 AND reading = $2 ORDER BY rank`, word, reading)
	if err != nil {
		return nil, fmt.Errorf("pitch accents: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var a PitchAccent
		var pos int16
		if err := rows.Scan(&pos, &a.Tag, &a.Primary); err != nil {
			return nil, fmt.Errorf("pitch accents: %w", err)
		}
		a.Position = int(pos)
		out = append(out, a)
	}
	return out, rows.Err()
}

// FindGrammar returns every Grammar Point, at any JLPT Level, whose pattern
// or any of its variants equals the normalised query. The query may be a
// single pattern ("〜てしまう") or a whole spreadsheet pattern with variants
// ("ちゃいけない・じゃいけない"); it is normalised and split the same way the
// catalogue was. Results run from the easiest level to the hardest, then by
// catalogue number.
func (s *Store) FindGrammar(ctx context.Context, pattern string) ([]GrammarPoint, error) {
	var wanted []string
	for _, v := range SplitVariants(pattern) {
		if n := NormalisePattern(v); n != "" {
			wanted = append(wanted, n)
		}
	}
	if len(wanted) == 0 {
		return nil, nil
	}
	rows, err := s.q.Query(ctx, `
		SELECT id, jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
		       variants, normalised_pattern, normalised_variants
		FROM grammar_points
		WHERE normalised_variants && $1::text[]
		ORDER BY jlpt_level DESC, catalogue_number, ordinal`, wanted)
	if err != nil {
		return nil, fmt.Errorf("find grammar: %w", err)
	}
	defer rows.Close()
	var out []GrammarPoint
	for rows.Next() {
		var g GrammarPoint
		var level string
		var number int32
		var ordinal int16
		if err := rows.Scan(&g.ID, &level, &number, &ordinal, &g.Pattern, &g.Romaji, &g.Meaning,
			&g.Variants, &g.NormalisedPattern, &g.NormalisedVariants); err != nil {
			return nil, fmt.Errorf("find grammar: %w", err)
		}
		g.Level, g.Number, g.Ordinal = Level(level), int(number), int(ordinal)
		out = append(out, g)
	}
	return out, rows.Err()
}

// GrammarPointIDsAtOrBelow returns the ids of every catalogue point at or below
// the given JLPT Level (N5 first: a Starting Level of N4 covers N5 and N4).
// Used for Seeded Grammar (issue #6).
func (s *Store) GrammarPointIDsAtOrBelow(ctx context.Context, level Level) ([]int64, error) {
	const jlptOrder = `array_position(ARRAY['N5','N4','N3','N2','N1'], jlpt_level)`
	rows, err := s.q.Query(ctx, `
		SELECT id FROM grammar_points
		WHERE `+jlptOrder+` <= array_position(ARRAY['N5','N4','N3','N2','N1'], $1)
		ORDER BY `+jlptOrder+`, catalogue_number, ordinal`, string(level))
	if err != nil {
		return nil, fmt.Errorf("grammar ids at or below %s: %w", level, err)
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("grammar ids at or below %s: %w", level, err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// GrammarPointsByNormalisedPattern returns every point whose normalised
// pattern or normalised variants contain normalised as an element: the exact
// Catalogue Matching lookup for one normalised MaruMori pattern (issue #6).
// The same pattern at two levels, or twice at one level, returns two rows.
func (s *Store) GrammarPointsByNormalisedPattern(ctx context.Context, normalised string) ([]GrammarPoint, error) {
	if normalised == "" {
		return nil, nil
	}
	rows, err := s.q.Query(ctx, `
		SELECT id, jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
		       variants, normalised_pattern, normalised_variants
		FROM grammar_points
		WHERE normalised_variants @> ARRAY[$1]::text[]
		ORDER BY jlpt_level DESC, catalogue_number, ordinal`, normalised)
	if err != nil {
		return nil, fmt.Errorf("grammar points by pattern: %w", err)
	}
	defer rows.Close()
	var out []GrammarPoint
	for rows.Next() {
		var g GrammarPoint
		var level string
		var number int32
		var ordinal int16
		if err := rows.Scan(&g.ID, &level, &number, &ordinal, &g.Pattern, &g.Romaji, &g.Meaning,
			&g.Variants, &g.NormalisedPattern, &g.NormalisedVariants); err != nil {
			return nil, fmt.Errorf("grammar points by pattern: %w", err)
		}
		g.Level, g.Number, g.Ordinal = Level(level), int(number), int(ordinal)
		out = append(out, g)
	}
	return out, rows.Err()
}
