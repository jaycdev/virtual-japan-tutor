package itemlist

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// PostgresStore implements Store over item_lists, item_list_items and the
// knowledge tables (migrations 00005, 00007, 00008 and 00011). The Known
// Item checks mirror mastery.PostgresStore's ref contract: linked items are
// addressed link-first (ent_seq / kanji literal), unlinked ones by their
// MaruMori id, and grammar by catalogue point id.
type PostgresStore struct{ pool *pgxpool.Pool }

var _ Store = (*PostgresStore)(nil)

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

// isUniqueName reports the (user_id, lower(name)) unique-violation.
func isUniqueName(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}

func (s *PostgresStore) EnsureSaved(ctx context.Context, userID uuid.UUID) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx,
		`INSERT INTO item_lists (user_id, name, boosting)
		 VALUES ($1, $2, true)
		 ON CONFLICT (user_id, lower(name)) DO NOTHING
		 RETURNING id`, userID, SavedListName).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		// The name was taken — case-insensitively that row IS the Saved list.
		return s.byIDName(ctx, userID, SavedListName)
	}
	return id, err
}

func (s *PostgresStore) byIDName(ctx context.Context, userID uuid.UUID, name string) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx,
		`SELECT id FROM item_lists WHERE user_id = $1 AND lower(name) = lower($2)`,
		userID, name).Scan(&id)
	return id, err
}

func (s *PostgresStore) DefaultID(ctx context.Context, userID uuid.UUID) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx, `SELECT default_item_list_id FROM users WHERE id = $1`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	// NULL and a deleted-defaulted-list SET NULL both scan as the zero UUID:
	// unset either way, so the service falls back to Saved.
	if err != nil || id == uuid.Nil {
		return uuid.Nil, false, err
	}
	return id, true, nil
}

func (s *PostgresStore) SetDefaultID(ctx context.Context, userID, listID uuid.UUID) error {
	_, err := s.pool.Exec(ctx, `UPDATE users SET default_item_list_id = $2 WHERE id = $1`, userID, listID)
	if isMissingDefaultTarget(err) {
		// The list was deleted between the service's ByID check and this
		// write: the FK refuses it, and the Learner's answer is the same
		// 404 as any other gone list, not a 500.
		return ErrListNotFound
	}
	return err
}

// isMissingDefaultTarget reports the FK violation (users.default_item_list_id
// -> item_lists) raised when the list row is already gone.
func isMissingDefaultTarget(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23503"
}

func (s *PostgresStore) Lists(ctx context.Context, userID uuid.UUID) ([]List, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT l.id, l.name, l.boosting, count(m.item_kind)
		 FROM item_lists l
		 LEFT JOIN item_list_items m ON m.list_id = l.id
		 WHERE l.user_id = $1
		 GROUP BY l.id, l.name, l.boosting, l.created_at
		 ORDER BY l.created_at, l.name`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []List
	for rows.Next() {
		var l List
		if err := rows.Scan(&l.ID, &l.Name, &l.Boosting, &l.ItemCount); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

func (s *PostgresStore) Insert(ctx context.Context, userID uuid.UUID, name string, boosting bool) (uuid.UUID, error) {
	var id uuid.UUID
	err := s.pool.QueryRow(ctx,
		`INSERT INTO item_lists (user_id, name, boosting) VALUES ($1, $2, $3) RETURNING id`,
		userID, name, boosting).Scan(&id)
	if isUniqueName(err) {
		return uuid.Nil, ErrDuplicateName
	}
	return id, err
}

func (s *PostgresStore) Update(ctx context.Context, userID, listID uuid.UUID, name string, boosting bool) error {
	res, err := s.pool.Exec(ctx,
		`UPDATE item_lists SET name = $3, boosting = $4 WHERE user_id = $1 AND id = $2`,
		userID, listID, name, boosting)
	if isUniqueName(err) {
		return ErrDuplicateName
	}
	if err != nil {
		return err
	}
	if res.RowsAffected() == 0 {
		// Deleted after the service's ByID check: same answer as up front.
		return ErrListNotFound
	}
	return nil
}

func (s *PostgresStore) Delete(ctx context.Context, userID, listID uuid.UUID) error {
	// item_list_items goes with it (ON DELETE CASCADE); users'
	// default_item_list_id is SET NULL, and the service's COALESCE rule
	// falls back to Saved.
	_, err := s.pool.Exec(ctx, `DELETE FROM item_lists WHERE user_id = $1 AND id = $2`, userID, listID)
	return err
}

func (s *PostgresStore) ByName(ctx context.Context, userID uuid.UUID, name string) (List, bool, error) {
	return s.get(ctx, userID, `lower(name) = lower($2)`, name)
}

func (s *PostgresStore) ByID(ctx context.Context, userID, listID uuid.UUID) (List, bool, error) {
	return s.get(ctx, userID, `id = $2`, listID)
}

func (s *PostgresStore) get(ctx context.Context, userID uuid.UUID, clause string, arg any) (List, bool, error) {
	var l List
	err := s.pool.QueryRow(ctx,
		`SELECT id, name, boosting FROM item_lists WHERE user_id = $1 AND `+clause, userID, arg).
		Scan(&l.ID, &l.Name, &l.Boosting)
	if errors.Is(err, pgx.ErrNoRows) {
		return List{}, false, nil
	}
	return l, err == nil, err
}

// AddItem records a membership and reports whether it actually inserted a
// row: a re-add hits the ON CONFLICT and adds nothing, and the service uses
// the flag to keep its Weak Signal idempotent.
func (s *PostgresStore) AddItem(ctx context.Context, userID, listID uuid.UUID, item ItemKey) (bool, error) {
	res, err := s.pool.Exec(ctx,
		`INSERT INTO item_list_items (list_id, item_kind, item_ref)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (list_id, item_kind, item_ref) DO NOTHING`,
		listID, item.Kind, item.Ref)
	if err != nil {
		return false, err
	}
	return res.RowsAffected() == 1, nil
}

func (s *PostgresStore) RemoveItem(ctx context.Context, userID, listID uuid.UUID, item ItemKey) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM item_list_items WHERE list_id = $1 AND item_kind = $2 AND item_ref = $3`,
		listID, item.Kind, item.Ref)
	return err
}

// ListItems reads a list's members with a display label joined from the
// reference data: first kanji form (or reading) + first gloss for Words,
// pattern + meaning for Grammar Points, the literal itself for Kanji.
// Vocabulary refs are ent_seqs when linked and MaruMori ids otherwise, so
// the label falls back through jmdict to the user's own unlinked row and
// finally to the raw ref. Rows are few (the endpoint caps at 500), so the
// refs are cast to text for the join rather than indexed.
func (s *PostgresStore) ListItems(ctx context.Context, userID, listID uuid.UUID, limit int) ([]Member, error) {
	headword := refdata.HeadwordSQL(func(a string) string { return a + ".ent_seq::text = m.item_ref" })
	rows, err := s.pool.Query(ctx,
		`SELECT m.item_kind, m.item_ref,
		        CASE m.item_kind
		          WHEN 'grammar' THEN COALESCE(
		            (SELECT g.pattern FROM grammar_points g WHERE g.id::text = m.item_ref), m.item_ref)
		          WHEN 'kanji' THEN m.item_ref
		          ELSE COALESCE(
		            `+headword+`,
		            (SELECT u.text FROM marumori_known_items u
		              WHERE u.user_id = $1 AND u.kind = 'vocabulary' AND u.marumori_id = m.item_ref),
		            m.item_ref)
		        END,
		        CASE m.item_kind
		          WHEN 'grammar' THEN COALESCE(
		            (SELECT g.meaning FROM grammar_points g WHERE g.id::text = m.item_ref), '')
		          ELSE COALESCE(
		            (SELECT a.glosses[1] FROM jmdict_senses a WHERE a.ent_seq::text = m.item_ref ORDER BY a.ord LIMIT 1), '')
		        END
		 FROM item_list_items m
		 JOIN item_lists l ON l.id = m.list_id AND l.user_id = $1
		 WHERE m.list_id = $2
		 ORDER BY m.item_kind, m.item_ref
		 LIMIT $3`, userID, listID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Member
	for rows.Next() {
		var it Member
		if err := rows.Scan(&it.Kind, &it.Ref, &it.Surface, &it.Gloss); err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, rows.Err()
}

// IsKnownItem answers the mastery question for one ItemKey. Vocabulary refs
// are ent_seqs but an unlinked item's ref is its MaruMori id, so both
// columns are checked — matching how mastery builds refs (link first,
// MaruMori id otherwise); same for kanji literals.
func (s *PostgresStore) IsKnownItem(ctx context.Context, userID uuid.UUID, item ItemKey) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT (
		   ($2 = 'grammar' AND EXISTS (
		     SELECT 1 FROM known_grammar_points p
		      WHERE p.user_id = $1 AND p.grammar_point_id::text = $3))
		   OR
		   ($2 IN ('kanji', 'vocabulary') AND EXISTS (
		     SELECT 1 FROM marumori_known_items k
		      WHERE k.user_id = $1 AND k.kind = $2 AND k.disappeared_at IS NULL
		        AND (k.jmdict_ent_seq::text = $3 OR k.kanji_literal = $3 OR k.marumori_id = $3)))
		 )`, userID, item.Kind, item.Ref).Scan(&exists)
	return exists, err
}

func (s *PostgresStore) AppendWeakSignal(ctx context.Context, userID uuid.UUID, item ItemKey, reason string) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO weak_signals (user_id, item_kind, item_ref, signal, occurred_at)
		 VALUES ($1, $2, $3, $4, now())`,
		userID, item.Kind, item.Ref, reason)
	return err
}
