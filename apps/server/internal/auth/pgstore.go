package auth

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore is the Postgres implementation of Store.
type PostgresStore struct{ pool *pgxpool.Pool }

// NewPostgresStore returns a Store over pool (schema: migrations/00002_users_and_sessions.sql).
func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

const uniqueViolation = "23505"

// bootstrapLockKey serialises CreateFirstUser across concurrent callers/replicas.
const bootstrapLockKey = 0x766a74_0001 // "vjt" + 1

func (s *PostgresStore) CreateUser(ctx context.Context, username, passwordHash string) (User, error) {
	var u User
	err := s.pool.QueryRow(ctx,
		`INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username`,
		username, passwordHash).Scan(&u.ID, &u.Username)
	return u, mapUnique(err)
}

func (s *PostgresStore) CreateFirstUser(ctx context.Context, username, passwordHash string) (User, bool, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return User{}, false, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock($1)`, int64(bootstrapLockKey)); err != nil {
		return User{}, false, err
	}
	var u User
	err = tx.QueryRow(ctx,
		`INSERT INTO users (username, password_hash)
		 SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM users)
		 RETURNING id, username`,
		username, passwordHash).Scan(&u.ID, &u.Username)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, false, nil
	}
	if err != nil {
		return User{}, false, mapUnique(err)
	}
	return u, true, tx.Commit(ctx)
}

func (s *PostgresStore) UserByUsername(ctx context.Context, username string) (User, string, error) {
	var (
		u    User
		hash string
	)
	err := s.pool.QueryRow(ctx,
		`SELECT id, username, password_hash FROM users WHERE lower(username) = lower($1)`,
		username).Scan(&u.ID, &u.Username, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, "", ErrNotFound
	}
	return u, hash, err
}

func (s *PostgresStore) CreateSession(ctx context.Context, tokenHash []byte, userID uuid.UUID, createdAt, expiresAt time.Time) error {
	// Opportunistic cleanup keeps the table small without a background job.
	if _, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE expires_at <= $1`, createdAt); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO sessions (token_hash, user_id, created_at, last_used_at, expires_at)
		 VALUES ($1, $2, $3, $3, $4)`,
		tokenHash, userID, createdAt, expiresAt)
	return err
}

func (s *PostgresStore) SessionUser(ctx context.Context, tokenHash []byte, now time.Time) (User, error) {
	var u User
	err := s.pool.QueryRow(ctx,
		`WITH s AS (
		     UPDATE sessions SET last_used_at = $2
		     WHERE token_hash = $1 AND expires_at > $2
		     RETURNING user_id
		 )
		 SELECT u.id, u.username FROM s JOIN users u ON u.id = s.user_id`,
		tokenHash, now).Scan(&u.ID, &u.Username)
	if errors.Is(err, pgx.ErrNoRows) {
		return User{}, ErrNotFound
	}
	return u, err
}

func (s *PostgresStore) DeleteSession(ctx context.Context, tokenHash []byte) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM sessions WHERE token_hash = $1`, tokenHash)
	return err
}

func mapUnique(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return ErrUsernameTaken
	}
	return err
}
