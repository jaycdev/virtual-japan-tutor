package practice

import (
	"context"
	"errors"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
)

// PostgresContent implements Content over the reference-data and grammar
// catalogue tables, the way mastery.PostgresStore queries its own joins: this
// feature reads what it needs directly.
//
// Distractor sampling is deterministic: rows are ordered by
// md5(row-identity || salt), so the same salt always draws the same pool —
// that is what makes a session reproducible from its seed.
type PostgresContent struct{ pool *pgxpool.Pool }

var _ Content = (*PostgresContent)(nil)

func NewPostgresContent(pool *pgxpool.Pool) *PostgresContent { return &PostgresContent{pool: pool} }

func (c *PostgresContent) VocabWord(ctx context.Context, entSeq int64) (Word, bool, error) {
	var w Word
	err := c.pool.QueryRow(ctx, `
		SELECT
		  COALESCE((SELECT k.text FROM jmdict_kanji_forms k WHERE k.ent_seq = $1 ORDER BY k.ord LIMIT 1),
		           (SELECT r.text FROM jmdict_readings r WHERE r.ent_seq = $1 ORDER BY r.ord LIMIT 1),
		           ''),
		  COALESCE((SELECT jlpt_level FROM jmdict_jlpt_level WHERE ent_seq = $1), '')
		FROM jmdict_entries e WHERE e.ent_seq = $1`, entSeq).Scan(&w.Display, &w.Level)
	if errors.Is(err, pgx.ErrNoRows) {
		return Word{}, false, nil
	}
	if err != nil {
		return Word{}, false, err
	}
	glosses, err := collectText(ctx, c.pool, `
		SELECT g FROM jmdict_senses s CROSS JOIN LATERAL unnest(s.glosses) AS g
		WHERE s.ent_seq = $1 ORDER BY s.ord LIMIT 6`, entSeq)
	if err != nil {
		return Word{}, false, err
	}
	w.Meanings = glosses
	return w, w.Display != "" && len(w.Meanings) > 0, nil
}

func (c *PostgresContent) KanjiWord(ctx context.Context, literal string) (Word, bool, error) {
	var level string
	err := c.pool.QueryRow(ctx, `
		SELECT COALESCE((SELECT jlpt_level FROM kanji_jlpt_level WHERE literal = $1), '')
		FROM kanji k WHERE k.literal = $1`, literal).Scan(&level)
	if errors.Is(err, pgx.ErrNoRows) {
		return Word{}, false, nil
	}
	if err != nil {
		return Word{}, false, err
	}
	meanings, err := collectText(ctx, c.pool, `
		SELECT meaning FROM kanji_meanings WHERE literal = $1 ORDER BY ord LIMIT 6`, literal)
	if err != nil {
		return Word{}, false, err
	}
	return Word{Display: literal, Meanings: meanings, Level: level}, len(meanings) > 0, nil
}

func (c *PostgresContent) GrammarCloze(ctx context.Context, pointID int64) (ClozeContent, bool, error) {
	var cl ClozeContent
	err := c.pool.QueryRow(ctx, `
		SELECT e.sentence_ja, e.span_start, e.span_end, e.span_text, p.jlpt_level
		FROM grammar_examples e JOIN grammar_points p ON p.id = e.grammar_point_id
		WHERE e.grammar_point_id = $1
		ORDER BY e.created_at, e.id LIMIT 1`, pointID).
		Scan(&cl.Sentence, &cl.SpanStart, &cl.SpanEnd, &cl.SpanText, &cl.Level)
	if errors.Is(err, pgx.ErrNoRows) {
		return ClozeContent{}, false, nil
	}
	if err != nil {
		return ClozeContent{}, false, err
	}
	return cl, true, nil
}

// jlptFilter: match level, or every level when level is "" (items with no
// JLPT Level still get distractors).
const vocabDistractorSQL = `
	WITH picked AS (
	  SELECT e.ent_seq
	  FROM jmdict_entries e JOIN jmdict_jlpt_level l ON l.ent_seq = e.ent_seq
	  WHERE ($1 = '' OR l.jlpt_level = $1) AND e.ent_seq <> ALL ($2::bigint[])
	  ORDER BY md5(e.ent_seq::text || $3::text), e.ent_seq
	  LIMIT 8
	)
	SELECT g FROM (
	  SELECT DISTINCT g
	  FROM picked p JOIN jmdict_senses s ON s.ent_seq = p.ent_seq
	  CROSS JOIN LATERAL unnest(s.glosses) AS g
	) t
	ORDER BY md5(t.g || $3::text), t.g
	LIMIT $4`

func (c *PostgresContent) VocabDistractors(ctx context.Context, level string, exclude []int64, salt int64, limit int) ([]string, error) {
	return collectText(ctx, c.pool, vocabDistractorSQL, level, exclude, strconv.FormatInt(salt, 10), limit)
}

const kanjiDistractorSQL = `
	WITH picked AS (
	  SELECT k.literal
	  FROM kanji k JOIN kanji_jlpt_level l ON l.literal = k.literal
	  WHERE ($1 = '' OR l.jlpt_level = $1) AND k.literal <> ALL ($2::text[])
	  ORDER BY md5(k.literal || $3::text), k.literal
	  LIMIT 8
	)
	SELECT t.meaning FROM (
	  SELECT DISTINCT m.meaning
	  FROM picked p JOIN kanji_meanings m ON m.literal = p.literal
	) t
	ORDER BY md5(t.meaning || $3::text), t.meaning
	LIMIT $4`

func (c *PostgresContent) KanjiDistractors(ctx context.Context, level string, exclude []string, salt int64, limit int) ([]string, error) {
	return collectText(ctx, c.pool, kanjiDistractorSQL, level, exclude, strconv.FormatInt(salt, 10), limit)
}

const clozeDistractorSQL = `
	SELECT s.span_text FROM (
	  SELECT DISTINCT e.span_text
	  FROM grammar_examples e JOIN grammar_points p ON p.id = e.grammar_point_id
	  WHERE ($1 = '' OR p.jlpt_level = $1) AND e.grammar_point_id <> ALL ($2::bigint[]) AND e.span_text <> $3
	) s
	ORDER BY md5(s.span_text || $4::text), s.span_text
	LIMIT $5`

func (c *PostgresContent) ClozeDistractors(ctx context.Context, level string, excludePoint int64, notText string, salt int64, limit int) ([]string, error) {
	return collectText(ctx, c.pool, clozeDistractorSQL, level, []int64{excludePoint}, notText, strconv.FormatInt(salt, 10), limit)
}

// stretchItemsSQL lists Stretch Items (issue #12): Boosting List members
// that are NOT yet Known Items. The exclusion mirrors how
// mastery.PostgresStore builds the Known Item universe (present Synced items
// addressed link-first, MaruMori id for unlinked; known grammar by point
// id), so "not known" here and "known" there are the same predicate seen
// from both sides — an item can never be a Stretch Item and a Focus Set
// member at once. One membership per list means an item in two Boosting
// Lists appears twice: DISTINCT ON collapses it to its oldest membership,
// and the outer sort keeps draws stable across sessions (added_at + key
// tie-break is total).
const stretchItemsSQL = `
	SELECT item_kind, item_ref FROM (
		SELECT DISTINCT ON (m.item_kind, m.item_ref) m.item_kind, m.item_ref, m.added_at
		FROM item_list_items m
		JOIN item_lists l ON l.id = m.list_id
		WHERE l.user_id = $1 AND l.boosting
		  AND NOT (
		    (m.item_kind = 'grammar' AND EXISTS (
		       SELECT 1 FROM known_grammar_points p
		       WHERE p.user_id = l.user_id AND p.grammar_point_id::text = m.item_ref))
		    OR (m.item_kind <> 'grammar' AND EXISTS (
		       SELECT 1 FROM marumori_known_items k
		       WHERE k.user_id = l.user_id AND k.kind = m.item_kind AND k.disappeared_at IS NULL
		         AND (k.jmdict_ent_seq::text = m.item_ref OR k.kanji_literal = m.item_ref OR k.marumori_id = m.item_ref)))
		  )
		ORDER BY m.item_kind, m.item_ref, m.added_at, m.list_id
	) t
	ORDER BY added_at, item_kind, item_ref
	LIMIT $2`

func (c *PostgresContent) StretchItems(ctx context.Context, userID uuid.UUID, limit int) ([]mastery.ItemKey, error) {
	rows, err := c.pool.Query(ctx, stretchItemsSQL, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []mastery.ItemKey
	for rows.Next() {
		var k mastery.ItemKey
		if err := rows.Scan(&k.Kind, &k.Ref); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func collectText(ctx context.Context, pool *pgxpool.Pool, query string, args ...any) ([]string, error) {
	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// PostgresResults implements ResultWriter: one practice_records row per
// Exercise result — exactly what mastery.PostgresStore.PracticeResults reads
// back for Mastery and Focus Set rotation.
type PostgresResults struct{ pool *pgxpool.Pool }

var _ ResultWriter = (*PostgresResults)(nil)

func NewPostgresResults(pool *pgxpool.Pool) *PostgresResults { return &PostgresResults{pool: pool} }

func (w *PostgresResults) AppendResult(ctx context.Context, userID uuid.UUID, item mastery.ItemKey, correct bool, answeredAt time.Time) error {
	_, err := w.pool.Exec(ctx,
		`INSERT INTO practice_records (user_id, item_kind, item_ref, correct, answered_at)
		 VALUES ($1, $2, $3, $4, $5)`,
		userID, string(item.Kind), item.Ref, correct, answeredAt)
	return err
}
