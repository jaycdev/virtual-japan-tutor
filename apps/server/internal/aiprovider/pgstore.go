package aiprovider

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore is the Postgres implementation of Store (schema: migrations/00004_ai_providers.sql).
type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

const (
	uniqueViolation     = "23505"
	foreignKeyViolation = "23503"
	columns             = `id, name, base_url, api_key_encrypted, model, created_at, updated_at`
)

type rowScanner interface{ Scan(dest ...any) error }

func scan(r rowScanner) (Record, error) {
	var rec Record
	err := r.Scan(&rec.ID, &rec.Name, &rec.BaseURL, &rec.APIKeyEncrypted, &rec.Model, &rec.CreatedAt, &rec.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Record{}, ErrNotFound
	}
	return rec, err
}

func pgCode(err error) string {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Code
	}
	return ""
}

func (s *PostgresStore) List(ctx context.Context, userID uuid.UUID) ([]Record, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT `+columns+` FROM ai_providers WHERE user_id = $1 ORDER BY created_at, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Record
	for rows.Next() {
		rec, err := scan(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

func (s *PostgresStore) Get(ctx context.Context, userID, id uuid.UUID) (Record, error) {
	return scan(s.pool.QueryRow(ctx,
		`SELECT `+columns+` FROM ai_providers WHERE id = $1 AND user_id = $2`, id, userID))
}

func (s *PostgresStore) Create(ctx context.Context, userID uuid.UUID, r Record) (Record, error) {
	rec, err := scan(s.pool.QueryRow(ctx,
		`INSERT INTO ai_providers (user_id, name, base_url, api_key_encrypted, model)
		 VALUES ($1, $2, $3, $4, $5) RETURNING `+columns,
		userID, r.Name, r.BaseURL, r.APIKeyEncrypted, r.Model))
	return rec, mapUnique(err)
}

func (s *PostgresStore) Update(ctx context.Context, userID uuid.UUID, r Record) (Record, error) {
	rec, err := scan(s.pool.QueryRow(ctx,
		`UPDATE ai_providers
		 SET name = $3, base_url = $4, api_key_encrypted = $5, model = $6, updated_at = now()
		 WHERE id = $1 AND user_id = $2 RETURNING `+columns,
		r.ID, userID, r.Name, r.BaseURL, r.APIKeyEncrypted, r.Model))
	return rec, mapUnique(err)
}

func (s *PostgresStore) Delete(ctx context.Context, userID, id uuid.UUID) error {
	tag, err := s.pool.Exec(ctx, `DELETE FROM ai_providers WHERE id = $1 AND user_id = $2`, id, userID)
	if pgCode(err) == foreignKeyViolation {
		return ErrInUse
	}
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) Assignments(ctx context.Context, userID uuid.UUID) (map[Task]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `SELECT task, provider_id FROM ai_task_assignments WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[Task]uuid.UUID{}
	for rows.Next() {
		var (
			task Task
			id   uuid.UUID
		)
		if err := rows.Scan(&task, &id); err != nil {
			return nil, err
		}
		out[task] = id
	}
	return out, rows.Err()
}

func (s *PostgresStore) Assign(ctx context.Context, userID uuid.UUID, task Task, providerID *uuid.UUID) error {
	if providerID == nil {
		_, err := s.pool.Exec(ctx, `DELETE FROM ai_task_assignments WHERE user_id = $1 AND task = $2`, userID, task)
		return err
	}
	// The SELECT only yields a row for the user's own provider, so another user's id is ErrNotFound.
	tag, err := s.pool.Exec(ctx,
		`INSERT INTO ai_task_assignments (user_id, task, provider_id)
		 SELECT user_id, $2, id FROM ai_providers WHERE id = $3 AND user_id = $1
		 ON CONFLICT (user_id, task) DO UPDATE SET provider_id = EXCLUDED.provider_id`,
		userID, task, *providerID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) CreateDefaultIfNone(ctx context.Context, userID uuid.UUID, r Record, tasks []Task) (bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Serialise concurrent seeders (several replicas booting) per user.
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('ai_providers_seed:' || $1::text, 0))`, userID); err != nil {
		return false, err
	}
	var n int
	if err := tx.QueryRow(ctx, `SELECT count(*) FROM ai_providers WHERE user_id = $1`, userID).Scan(&n); err != nil {
		return false, err
	}
	if n > 0 {
		return false, nil
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx,
		`INSERT INTO ai_providers (user_id, name, base_url, api_key_encrypted, model)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id`,
		userID, r.Name, r.BaseURL, r.APIKeyEncrypted, r.Model).Scan(&id); err != nil {
		return false, mapUnique(err)
	}
	for _, t := range tasks {
		if _, err := tx.Exec(ctx,
			`INSERT INTO ai_task_assignments (user_id, task, provider_id) VALUES ($1, $2, $3)`, userID, t, id); err != nil {
			return false, err
		}
	}
	return true, tx.Commit(ctx)
}

func mapUnique(err error) error {
	if pgCode(err) == uniqueViolation {
		return ErrNameTaken
	}
	return err
}

// SoleUserID returns the id of the only user, if there is exactly one. The env-seeded
// default provider is only created for that user (the MVP has one Learner).
func SoleUserID(ctx context.Context, pool *pgxpool.Pool) (uuid.UUID, bool, error) {
	rows, err := pool.Query(ctx, `SELECT id FROM users ORDER BY created_at, id LIMIT 2`)
	if err != nil {
		return uuid.Nil, false, err
	}
	defer rows.Close()
	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return uuid.Nil, false, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return uuid.Nil, false, err
	}
	if len(ids) != 1 {
		return uuid.Nil, false, nil
	}
	return ids[0], true, nil
}
