package knowngrammar

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// PostgresStore is the Postgres implementation of Store
// (schema: migrations/00007_starting_level_known_grammar.sql). Each
// multi-row change runs in one transaction so a half-applied Starting Level
// change or Sync cannot be observed.
type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

// jlptRank orders JLPT Levels easiest-first in SQL, mirroring levelRank.
const jlptRank = `array_position(ARRAY['N5','N4','N3','N2','N1'], jlpt_level)`

func (s *PostgresStore) StartingLevel(ctx context.Context, userID uuid.UUID) (refdata.Level, bool, error) {
	var level *string
	err := s.pool.QueryRow(ctx, `SELECT starting_level FROM users WHERE id = $1`, userID).Scan(&level)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, fmt.Errorf("unknown user %s", userID)
	}
	if err != nil {
		return "", false, err
	}
	if level == nil {
		return "", false, nil
	}
	return refdata.Level(*level), true, nil
}

func (s *PostgresStore) SetStartingLevel(ctx context.Context, userID uuid.UUID, level refdata.Level) error {
	tag, err := s.pool.Exec(ctx, `UPDATE users SET starting_level = $2 WHERE id = $1`, userID, string(level))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("unknown user %s", userID)
	}
	return nil
}

func (s *PostgresStore) ApplySeededPoints(ctx context.Context, userID uuid.UUID, pointIDs []int64) (SeededDelta, error) {
	if pointIDs == nil {
		pointIDs = []int64{} // a nil slice encodes as SQL NULL, and ANY(NULL) matches nothing
	}
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return SeededDelta{}, err
	}
	defer tx.Rollback(ctx)

	var delta SeededDelta
	added, err := tx.Exec(ctx, `
		INSERT INTO known_grammar_points (user_id, grammar_point_id, source, mastery)
		SELECT $1, unnest($2::bigint[]), 'seeded', 'medium'
		ON CONFLICT (user_id, grammar_point_id) DO NOTHING`, userID, pointIDs)
	if err != nil {
		return delta, err
	}
	delta.Added = int(added.RowsAffected())
	removed, err := tx.Exec(ctx, `
		DELETE FROM known_grammar_points
		WHERE user_id = $1 AND source = 'seeded' AND NOT (grammar_point_id = ANY($2))`, userID, pointIDs)
	if err != nil {
		return delta, err
	}
	delta.Removed = int(removed.RowsAffected())
	delta.Kept = len(pointIDs) - delta.Added
	return delta, tx.Commit(ctx)
}

func (s *PostgresStore) SeededPoints(ctx context.Context, userID uuid.UUID) ([]int64, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT grammar_point_id FROM known_grammar_points WHERE user_id = $1 AND source = 'seeded'`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

func (s *PostgresStore) UpsertObservedPoint(ctx context.Context, userID uuid.UUID, pointID int64) error {
	// An existing row keeps its Mastery (Practice owns it); only its source is
	// promoted to observed.
	_, err := s.pool.Exec(ctx, `
		INSERT INTO known_grammar_points (user_id, grammar_point_id, source, mastery)
		VALUES ($1, $2, 'observed', 'low')
		ON CONFLICT (user_id, grammar_point_id)
		DO UPDATE SET source = 'observed', updated_at = now()`, userID, pointID)
	return err
}

func (s *PostgresStore) KnownPoint(ctx context.Context, userID uuid.UUID, pointID int64) (KnownPoint, bool, error) {
	var p KnownPoint
	err := s.pool.QueryRow(ctx, `
		SELECT grammar_point_id, source, mastery
		FROM known_grammar_points WHERE user_id = $1 AND grammar_point_id = $2`, userID, pointID).
		Scan(&p.PointID, &p.Source, &p.Mastery)
	if errors.Is(err, pgx.ErrNoRows) {
		return KnownPoint{}, false, nil
	}
	if err != nil {
		return KnownPoint{}, false, err
	}
	return p, true, nil
}

func (s *PostgresStore) PutObservation(ctx context.Context, userID uuid.UUID, o Observation) error {
	var matched any
	if o.MatchedPoint != 0 {
		matched = o.MatchedPoint
	}
	_, err := s.pool.Exec(ctx, `
		INSERT INTO known_grammar_observations
			(user_id, marumori_id, pattern, jlpt_level, matched_point, flagged_for_review)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (user_id, marumori_id) DO UPDATE SET
			pattern = EXCLUDED.pattern,
			jlpt_level = EXCLUDED.jlpt_level,
			matched_point = EXCLUDED.matched_point,
			flagged_for_review = EXCLUDED.flagged_for_review,
			observed_at = now()`,
		userID, o.MaruMoriID, o.Pattern, o.JLPTLevel, matched, o.Flagged)
	return err
}

func (s *PostgresStore) Observations(ctx context.Context, userID uuid.UUID) ([]Observation, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT marumori_id, pattern, jlpt_level, matched_point, flagged_for_review
		FROM known_grammar_observations WHERE user_id = $1
		ORDER BY marumori_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Observation
	for rows.Next() {
		var o Observation
		var matched *int64
		if err := rows.Scan(&o.MaruMoriID, &o.Pattern, &o.JLPTLevel, &matched, &o.Flagged); err != nil {
			return nil, err
		}
		if matched != nil {
			o.MatchedPoint = *matched
		}
		out = append(out, o)
	}
	return out, rows.Err()
}

func (s *PostgresStore) ResolveObservation(ctx context.Context, userID uuid.UUID, maruMoriID string, pointID int64, flagged bool) error {
	tag, err := s.pool.Exec(ctx, `
		UPDATE known_grammar_observations
		SET matched_point = $3, flagged_for_review = $4
		WHERE user_id = $1 AND marumori_id = $2`, userID, maruMoriID, pointID, flagged)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrObservationNotFound
	}
	return nil
}
