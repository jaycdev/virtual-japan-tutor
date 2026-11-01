package marumorisync

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore is the Postgres implementation of Store (schema: migrations/00005_marumori.sql).
type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

const (
	uniqueViolation = "23505"
	runColumns      = `id, status, started_at, finished_at, error, counts`
)

func pgCode(err error) string {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Code
	}
	return ""
}

type rowScanner interface{ Scan(dest ...any) error }

func scanRun(r rowScanner) (SyncRun, error) {
	var (
		run       SyncRun
		countsRaw []byte
	)
	err := r.Scan(&run.ID, &run.Status, &run.StartedAt, &run.FinishedAt, &run.Error, &countsRaw)
	if err != nil {
		return SyncRun{}, err
	}
	if len(countsRaw) > 0 {
		var counts Counts
		if err := json.Unmarshal(countsRaw, &counts); err != nil {
			return SyncRun{}, err
		}
		run.Counts = &counts
	}
	return run, nil
}

func (s *PostgresStore) GetSettings(ctx context.Context, userID uuid.UUID) (Settings, error) {
	var set Settings
	err := s.pool.QueryRow(ctx,
		`SELECT api_key_encrypted, connected_at FROM marumori_settings WHERE user_id = $1`, userID).
		Scan(&set.APIKeyEncrypted, &set.ConnectedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{}, ErrNoKey
	}
	if err != nil {
		return Settings{}, err
	}
	return set, nil
}

// SetAPIKey inserts or replaces the key. ConnectedAt is only written on insert, so a
// key replacement keeps the original connection timestamp.
func (s *PostgresStore) SetAPIKey(ctx context.Context, userID uuid.UUID, encrypted string, at time.Time) (Settings, error) {
	var set Settings
	err := s.pool.QueryRow(ctx,
		`INSERT INTO marumori_settings (user_id, api_key_encrypted, connected_at)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id) DO UPDATE
		   SET api_key_encrypted = EXCLUDED.api_key_encrypted, updated_at = now()
		 RETURNING api_key_encrypted, connected_at`,
		userID, encrypted, at).Scan(&set.APIKeyEncrypted, &set.ConnectedAt)
	return set, err
}

func (s *PostgresStore) DeleteAPIKey(ctx context.Context, userID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `DELETE FROM marumori_settings WHERE user_id = $1`, userID)
	return err // idempotent: deleting zero rows is fine
}

func (s *PostgresStore) UsersWithKeys(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := s.pool.Query(ctx, `SELECT user_id FROM marumori_settings ORDER BY user_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

func (s *PostgresStore) KnownLevels(ctx context.Context, userID uuid.UUID) ([]KnownLevel, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT kind, marumori_id, srs_level FROM marumori_known_items
		 WHERE user_id = $1 AND disappeared_at IS NULL
		 ORDER BY kind, marumori_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []KnownLevel
	for rows.Next() {
		var k KnownLevel
		if err := rows.Scan(&k.Kind, &k.MaruMoriID, &k.Level); err != nil {
			return nil, err
		}
		out = append(out, k)
	}
	return out, rows.Err()
}

func (s *PostgresStore) KnowledgeTotals(ctx context.Context, userID uuid.UUID) (Totals, error) {
	var tot Totals
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FILTER (WHERE kind = 'kanji'),
		        count(*) FILTER (WHERE kind = 'vocabulary'),
		        count(*) FILTER (WHERE kind = 'vocabulary' AND jmdict_ent_seq IS NOT NULL),
		        max(last_seen_at)
		 FROM marumori_known_items WHERE user_id = $1 AND disappeared_at IS NULL`, userID).
		Scan(&tot.Kanji, &tot.Vocabulary, &tot.VocabularyLinked, &tot.LastSyncAt)
	return tot, err
}

// StartRun inserts a running run. The partial unique index on (user_id) WHERE
// status = 'running' is the Sync single-flight: a violation is ErrSyncRunning. A run older
// than StaleRunAfter is abandoned — a process that died mid-Sync, or a request cut short
// before the Service could close the row — so it is closed as a failed run first: that is
// what keeps a Learner from being locked out of Sync for ever. Staleness is measured
// against the time this Store measures now, never against startedAt, so a run another
// worker is still writing is never stolen.
func (s *PostgresStore) StartRun(ctx context.Context, userID, runID uuid.UUID, startedAt time.Time) error {
	now := time.Now()
	if _, err := s.pool.Exec(ctx,
		`UPDATE marumori_sync_runs SET status = 'failed', finished_at = $3, error = $4
		 WHERE user_id = $1 AND status = 'running' AND started_at < $2`,
		userID, now.Add(-StaleRunAfter), now, StaleRunMessage); err != nil {
		return err
	}
	_, err := s.pool.Exec(ctx,
		`INSERT INTO marumori_sync_runs (id, user_id, status, started_at) VALUES ($1, $2, 'running', $3)`,
		runID, userID, startedAt)
	if pgCode(err) == uniqueViolation {
		return ErrSyncRunning
	}
	return err
}

func (s *PostgresStore) FinishRun(ctx context.Context, userID, runID uuid.UUID, finishedAt time.Time, failure *string, counts *Counts) error {
	var countsRaw []byte
	if counts != nil {
		raw, err := json.Marshal(counts)
		if err != nil {
			return err
		}
		countsRaw = raw
	}
	status := RunOK
	if failure != nil {
		status = RunFailed
	}
	tag, err := s.pool.Exec(ctx,
		`UPDATE marumori_sync_runs SET status = $3, finished_at = $4, error = $5, counts = $6
		 WHERE id = $1 AND user_id = $2 AND status = 'running'`,
		runID, userID, status, finishedAt, failure, countsRaw)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return errors.New("sync run not found or already finished")
	}
	return nil
}

func (s *PostgresStore) RecentRuns(ctx context.Context, userID uuid.UUID, limit int) ([]SyncRun, error) {
	if limit <= 0 {
		limit = 10
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+runColumns+` FROM marumori_sync_runs
		 WHERE user_id = $1 ORDER BY started_at DESC, id DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SyncRun
	for rows.Next() {
		run, err := scanRun(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, run)
	}
	return out, rows.Err()
}

func (s *PostgresStore) LastSuccessfulRun(ctx context.Context, userID uuid.UUID) (SyncRun, bool, error) {
	run, err := scanRun(s.pool.QueryRow(ctx,
		`SELECT `+runColumns+` FROM marumori_sync_runs
		 WHERE user_id = $1 AND status = 'ok' ORDER BY started_at DESC, id DESC LIMIT 1`, userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return SyncRun{}, false, nil
	}
	if err != nil {
		return SyncRun{}, false, err
	}
	return run, true, nil
}

// ApplySync applies one Sync's whole batch in a single transaction: the stored
// knowledge state either reflects this Sync completely or not at all.
func (s *PostgresStore) ApplySync(ctx context.Context, userID, runID uuid.UUID, batch SyncBatch) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	for _, it := range batch.Items {
		if _, err := tx.Exec(ctx,
			`INSERT INTO marumori_known_items
			   (user_id, kind, marumori_id, srs_level, text, kanji_literal, jmdict_ent_seq, first_synced_at, last_seen_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
			 ON CONFLICT (user_id, kind, marumori_id) DO UPDATE
			   SET srs_level       = EXCLUDED.srs_level,
			       text            = EXCLUDED.text,
			       kanji_literal   = EXCLUDED.kanji_literal,
			       jmdict_ent_seq  = EXCLUDED.jmdict_ent_seq,
			       last_seen_at    = EXCLUDED.last_seen_at,
			       disappeared_at  = NULL`,
			userID, it.Kind, it.MaruMoriID, it.Level, it.Text, it.KanjiLiteral, it.EntSeq, batch.SyncedAt); err != nil {
			return err
		}
	}
	for _, d := range batch.Disappeared {
		if _, err := tx.Exec(ctx,
			`UPDATE marumori_known_items SET disappeared_at = $4
			 WHERE user_id = $1 AND kind = $2 AND marumori_id = $3 AND disappeared_at IS NULL`,
			userID, d.Kind, d.MaruMoriID, batch.SyncedAt); err != nil {
			return err
		}
	}
	for _, h := range batch.History {
		if _, err := tx.Exec(ctx,
			`INSERT INTO marumori_known_item_history (user_id, sync_run_id, kind, marumori_id, change, old_level, new_level)
			 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			userID, runID, h.Kind, h.MaruMoriID, h.Change, h.OldLevel, h.NewLevel); err != nil {
			return err
		}
	}
	for _, g := range batch.Grammar {
		if _, err := tx.Exec(ctx,
			`INSERT INTO marumori_grammar_observations (user_id, marumori_id, srs_level, suspended, first_seen_at, last_seen_at)
			 VALUES ($1, $2, $3, $4, $5, $5)
			 ON CONFLICT (user_id, marumori_id) DO UPDATE
			   SET srs_level = EXCLUDED.srs_level, suspended = EXCLUDED.suspended, last_seen_at = EXCLUDED.last_seen_at`,
			userID, g.MaruMoriID, g.Level, g.Suspended, batch.SyncedAt); err != nil {
			return err
		}
	}
	if batch.Home != nil {
		h := batch.Home
		if _, err := tx.Exec(ctx,
			`INSERT INTO marumori_home_stats
			   (user_id, synced_at, total_learned, kanji_learned, vocabulary_learned, grammar_lessons_done,
			    pending_lessons, pending_reviews, grammar_total, pending_grammar_lessons, pending_grammar_reviews,
			    accuracy, grammar_accuracy)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
			 ON CONFLICT (user_id) DO UPDATE SET
			   synced_at = EXCLUDED.synced_at, total_learned = EXCLUDED.total_learned,
			   kanji_learned = EXCLUDED.kanji_learned, vocabulary_learned = EXCLUDED.vocabulary_learned,
			   grammar_lessons_done = EXCLUDED.grammar_lessons_done, pending_lessons = EXCLUDED.pending_lessons,
			   pending_reviews = EXCLUDED.pending_reviews, grammar_total = EXCLUDED.grammar_total,
			   pending_grammar_lessons = EXCLUDED.pending_grammar_lessons,
			   pending_grammar_reviews = EXCLUDED.pending_grammar_reviews,
			   accuracy = EXCLUDED.accuracy, grammar_accuracy = EXCLUDED.grammar_accuracy`,
			userID, batch.SyncedAt, h.TotalLearned, h.KanjiLearned, h.VocabularyLearned, h.TotalGrammarDone,
			h.PendingLessons, h.PendingReviews, h.TotalGrammarLearned, h.PendingGrammarLessons, h.PendingGrammarReviews,
			h.Accuracy, h.GrammarAccuracy); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
