package mastery

import (
	"context"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore is the read side of the Store interface: a join of the
// knowledge state (migrations 00005 and 00007) with the Practice Record and
// Weak Signals (migration 00008) and the Sync level history. It reads; the
// write sides belong to their own features (Sync, issues #9 and #12).
type PostgresStore struct{ pool *pgxpool.Pool }

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

// KnownItems returns the whole Known Item universe: present (not disappeared)
// Synced items and both halves of known grammar. Item refs follow the
// ItemKey contract: link first, MaruMori id only for unlinked items.
func (s *PostgresStore) KnownItems(ctx context.Context, userID uuid.UUID) ([]KnownItem, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT kind, marumori_id, srs_level, kanji_literal, jmdict_ent_seq
		 FROM marumori_known_items
		 WHERE user_id = $1 AND disappeared_at IS NULL
		 ORDER BY kind, marumori_id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []KnownItem
	for rows.Next() {
		var (
			kind    Kind
			mmID    string
			level   int
			literal *string
			entSeq  *int64
		)
		if err := rows.Scan(&kind, &mmID, &level, &literal, &entSeq); err != nil {
			return nil, err
		}
		ref := mmID
		switch {
		case literal != nil:
			ref = *literal
		case entSeq != nil:
			ref = strconv.FormatInt(*entSeq, 10)
		}
		lvl := level
		out = append(out, KnownItem{
			Key:        ItemKey{Kind: kind, Ref: ref},
			MaruMoriID: mmID,
			SRSLevel:   &lvl,
			Source:     SourceMaruMori,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	// Grammar: each Known Point carries its source, and — when MaruMori
	// grammar observations matched it — the best observed SRS level and the
	// first observation's date (the "newly observed" clock).
	grammar, err := s.pool.Query(ctx,
		`SELECT p.grammar_point_id::text, p.source, g.srs_level, g.first_observed_at
		 FROM known_grammar_points p
		 LEFT JOIN LATERAL (
		   SELECT max(m.srs_level) AS srs_level, min(o.observed_at) AS first_observed_at
		   FROM known_grammar_observations o
		   LEFT JOIN marumori_grammar_observations m
		     ON m.user_id = o.user_id AND m.marumori_id = o.marumori_id
		   WHERE o.user_id = p.user_id AND o.matched_point = p.grammar_point_id
		 ) g ON true
		 WHERE p.user_id = $1
		 ORDER BY p.grammar_point_id`, userID)
	if err != nil {
		return nil, err
	}
	defer grammar.Close()
	for grammar.Next() {
		var (
			ref        string
			source     Source
			level      *int
			observedAt *time.Time
		)
		if err := grammar.Scan(&ref, &source, &level, &observedAt); err != nil {
			return nil, err
		}
		out = append(out, KnownItem{
			Key:        ItemKey{Kind: KindGrammar, Ref: ref},
			SRSLevel:   level,
			Source:     source,
			ObservedAt: observedAt,
		})
	}
	return out, grammar.Err()
}

// LevelTrends returns the newest level_changed delta per Synced Known Item.
// Rows whose old/new level is missing (which the writer never produces) are
// skipped rather than guessed at.
func (s *PostgresStore) LevelTrends(ctx context.Context, userID uuid.UUID) ([]LevelTrend, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT DISTINCT ON (kind, marumori_id) kind, marumori_id, new_level - old_level
		 FROM marumori_known_item_history
		 WHERE user_id = $1 AND change = 'level_changed' AND old_level IS NOT NULL AND new_level IS NOT NULL
		 ORDER BY kind, marumori_id, id DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LevelTrend
	for rows.Next() {
		var t LevelTrend
		if err := rows.Scan(&t.Kind, &t.MaruMoriID, &t.Delta); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// PracticeResults returns the Learner's whole Practice Record, oldest first.
func (s *PostgresStore) PracticeResults(ctx context.Context, userID uuid.UUID) ([]PracticeRecord, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT item_kind, item_ref, correct, answered_at
		 FROM practice_records WHERE user_id = $1
		 ORDER BY answered_at, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PracticeRecord
	for rows.Next() {
		var p PracticeRecord
		if err := rows.Scan(&p.Key.Kind, &p.Key.Ref, &p.Correct, &p.AnsweredAt); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// WeakSignals returns the Learner's Weak Signals, oldest first.
func (s *PostgresStore) WeakSignals(ctx context.Context, userID uuid.UUID) ([]WeakSignalRecord, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT item_kind, item_ref, signal, occurred_at
		 FROM weak_signals WHERE user_id = $1
		 ORDER BY occurred_at, id`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []WeakSignalRecord
	for rows.Next() {
		var w WeakSignalRecord
		if err := rows.Scan(&w.Key.Kind, &w.Key.Ref, &w.Signal, &w.OccurredAt); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}
