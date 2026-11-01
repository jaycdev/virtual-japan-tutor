package grammar

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// PostgresStore is the Postgres implementation of Store and Dictionary
// (schema: migrations/00003_reference_data.sql and 00006_grammar_content.sql).
type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

const (
	foreignKeyViolation = "23503"
	exampleColumns      = `id, grammar_point_id, sentence_ja, translation_en, span_start, span_end, span_text, source, language_check, created_at`
)

func pgCode(err error) string {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Code
	}
	return ""
}

// jlptOrder puts N5 first, matching how the catalogue reads.
const jlptOrder = `array_position(ARRAY['N5','N4','N3','N2','N1'], jlpt_level)`

// escapeLike makes s a literal ILIKE body: %, _ and \ lose their pattern power.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return "%" + r.Replace(s) + "%"
}

func (s *PostgresStore) Points(ctx context.Context, f Filter) ([]PointSummary, int, error) {
	where := `WHERE ($1 = '' OR jlpt_level = $1)`
	args := []any{f.Level}
	if f.Query != "" {
		where += ` AND (pattern ILIKE $2 OR romaji ILIKE $2 OR meaning ILIKE $2)`
		args = append(args, escapeLike(f.Query))
	}
	limitParam, offsetParam := "$3", "$4"
	if f.Query != "" {
		limitParam, offsetParam = "$4", "$5"
	}

	var total int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM grammar_points `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	rows, err := s.pool.Query(ctx, `
		SELECT g.id, g.jlpt_level, g.catalogue_number, g.pattern, g.romaji, g.meaning,
		       g.explanation IS NOT NULL,
		       (SELECT count(*) FROM grammar_examples e WHERE e.grammar_point_id = g.id)
		FROM grammar_points g `+where+`
		ORDER BY `+jlptOrder+`, g.catalogue_number, g.ordinal
		LIMIT `+limitParam+` OFFSET `+offsetParam,
		append(append([]any(nil), args...), ClampLimit(f.Limit), max(0, f.Offset))...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var out []PointSummary
	for rows.Next() {
		var p PointSummary
		if err := rows.Scan(&p.ID, &p.Level, &p.Number, &p.Pattern, &p.Romaji, &p.Meaning,
			&p.HasExplanation, &p.ExampleCount); err != nil {
			return nil, 0, err
		}
		out = append(out, p)
	}
	return out, total, rows.Err()
}

func (s *PostgresStore) Point(ctx context.Context, id int64) (refdata.GrammarPoint, error) {
	var g refdata.GrammarPoint
	err := s.pool.QueryRow(ctx, `
		SELECT id, jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
		       variants, normalised_pattern, normalised_variants
		FROM grammar_points WHERE id = $1`, id).
		Scan(&g.ID, &g.Level, &g.Number, &g.Ordinal, &g.Pattern, &g.Romaji, &g.Meaning,
			&g.Variants, &g.NormalisedPattern, &g.NormalisedVariants)
	if errors.Is(err, pgx.ErrNoRows) {
		return refdata.GrammarPoint{}, ErrPointNotFound
	}
	if err != nil {
		return refdata.GrammarPoint{}, err
	}
	return g, nil
}

func (s *PostgresStore) Content(ctx context.Context, id int64) (Content, error) {
	var c Content
	err := s.pool.QueryRow(ctx,
		`SELECT explanation, explanation_edited, explanation_updated_at FROM grammar_points WHERE id = $1`, id).
		Scan(&c.Explanation, &c.ExplanationEdited, &c.ExplanationUpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Content{}, ErrPointNotFound
	}
	return c, err
}

func (s *PostgresStore) SetExplanation(ctx context.Context, id int64, explanation string, edited bool) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE grammar_points
		SET explanation = $2, explanation_edited = $3, explanation_updated_at = now()
		WHERE id = $1`, id, explanation, edited)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPointNotFound
	}
	return nil
}

func (s *PostgresStore) Examples(ctx context.Context, id int64) ([]Example, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+exampleColumns+` FROM grammar_examples WHERE grammar_point_id = $1 ORDER BY created_at, id`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Example
	for rows.Next() {
		var e Example
		if err := rows.Scan(&e.ID, &e.GrammarPointID, &e.SentenceJA, &e.TranslationEN,
			&e.SpanStart, &e.SpanEnd, &e.SpanText, &e.Source, &e.LanguageCheck, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *PostgresStore) AddExample(ctx context.Context, id int64, c Candidate) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		INSERT INTO grammar_examples (grammar_point_id, sentence_ja, translation_en, span_start, span_end, span_text)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (grammar_point_id, sentence_ja) DO NOTHING`,
		id, c.SentenceJA, c.Translation, c.SpanStart, c.SpanEnd, c.SpanText)
	if pgCode(err) == foreignKeyViolation {
		return false, ErrPointNotFound
	}
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

func (s *PostgresStore) CountExamples(ctx context.Context, id int64) (int, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM grammar_points WHERE id = $1)`, id).Scan(&exists); err != nil {
		return 0, err
	}
	if !exists {
		return 0, ErrPointNotFound
	}
	var n int
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM grammar_examples WHERE grammar_point_id = $1`, id).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// Known reports whether a surface form appears in the JMdict reference data as
// a kanji headword or as a reading (Dictionary interface, validate.go).
func (s *PostgresStore) Known(ctx context.Context, surface string) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `
		SELECT EXISTS (SELECT 1 FROM jmdict_kanji_forms WHERE text = $1)
		    OR EXISTS (SELECT 1 FROM jmdict_readings WHERE text = $1)`, surface).Scan(&ok)
	return ok, err
}

var (
	_ Store      = (*PostgresStore)(nil)
	_ Dictionary = (*PostgresStore)(nil)
)
