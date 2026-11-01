package dictionary

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PGKnownStore answers the Known Item half of a lookup from the app's
// Postgres. It reads only: Known Items are written by Sync and (issue #12)
// by Save.
type PGKnownStore struct{ pool *pgxpool.Pool }

func NewPGKnownStore(pool *pgxpool.Pool) *PGKnownStore { return &PGKnownStore{pool: pool} }

// KnownVocabulary reports the word's Known Item state. Two MaruMori forms
// can link to one JMdict entry; the weakest SRS Level is kept, matching the
// Mastery store's collapse of duplicated linked forms.
func (s *PGKnownStore) KnownVocabulary(ctx context.Context, userID uuid.UUID, entSeq int64) (int, bool, error) {
	// The aggregate always returns one row; NULL means no Known Item.
	var lvl *int
	err := s.pool.QueryRow(ctx, `
		SELECT min(srs_level) FROM marumori_known_items
		WHERE user_id = $1 AND kind = 'vocabulary' AND jmdict_ent_seq = $2
		  AND disappeared_at IS NULL`, userID, entSeq).Scan(&lvl)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && lvl == nil) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, fmt.Errorf("dictionary known vocabulary: %w", err)
	}
	return *lvl, true, nil
}

// KnownKanji maps each of literals the Learner knows to its SRS Level,
// weakest form kept as above.
func (s *PGKnownStore) KnownKanji(ctx context.Context, userID uuid.UUID, literals []string) (map[string]int, error) {
	out := map[string]int{}
	if len(literals) == 0 {
		return out, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT kanji_literal, min(srs_level) FROM marumori_known_items
		WHERE user_id = $1 AND kind = 'kanji' AND kanji_literal = ANY ($2)
		  AND disappeared_at IS NULL
		GROUP BY kanji_literal`, userID, literals)
	if err != nil {
		return nil, fmt.Errorf("dictionary known kanji: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var lit string
		var lvl int
		if err := rows.Scan(&lit, &lvl); err != nil {
			return nil, fmt.Errorf("dictionary known kanji: %w", err)
		}
		out[lit] = lvl
	}
	return out, rows.Err()
}
