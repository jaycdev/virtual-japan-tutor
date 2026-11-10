package story

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

var _ relinkStore = (*PostgresStore)(nil)

// StoryRefs lists every stored Story with its owner, oldest first, so a relink
// run visits them in the same order each time.
func (st *PostgresStore) StoryRefs(ctx context.Context) ([]StoryRef, error) {
	rows, err := st.pool.Query(ctx, `SELECT id, user_id FROM stories ORDER BY created_at, id`)
	if err != nil {
		return nil, fmt.Errorf("story refs: %w", err)
	}
	defer rows.Close()
	var out []StoryRef
	for rows.Next() {
		var ref StoryRef
		if err := rows.Scan(&ref.ID, &ref.UserID); err != nil {
			return nil, fmt.Errorf("story refs: %w", err)
		}
		out = append(out, ref)
	}
	return out, rows.Err()
}

// SaveLinks writes one Story's new token links and its Vocabulary Items in one
// transaction. The `ent_seq IS NULL` guard keeps an existing link from ever
// being overwritten, even if a link were computed against a stale read. A link
// that cannot be applied (its token is already linked, or is missing) fails
// the whole save, so the Vocabulary Items never disagree with the tokens; the
// transaction rolls back and a re-run is safe.
func (st *PostgresStore) SaveLinks(ctx context.Context, storyID uuid.UUID, links []TokenLink, vocab []VocabItem) error {
	if vocab == nil {
		vocab = []VocabItem{}
	}
	encoded, err := json.Marshal(vocab)
	if err != nil {
		return fmt.Errorf("story save links: vocab items: %w", err)
	}
	tx, err := st.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("story save links: %w", err)
	}
	// WithoutCancel: a rollback must still run after the caller's context is
	// cancelled, or the transaction would be left open on the connection.
	defer tx.Rollback(context.WithoutCancel(ctx)) //nolint:errcheck

	for _, l := range links {
		tag, err := tx.Exec(ctx, `
			UPDATE story_tokens SET ent_seq = $1, dictionary = $2, tag = $3, srs_level = $4, reading = $5
			WHERE story_id = $6 AND sentence_id = $7 AND position = $8 AND ent_seq IS NULL`,
			l.EntSeq, l.Dictionary, l.Tag, l.SRSLevel, l.Reading, storyID, l.SentenceID, l.Pos)
		if err != nil {
			return fmt.Errorf("story save links: token: %w", err)
		}
		if tag.RowsAffected() != 1 {
			return fmt.Errorf("story save links: story %s sentence %s position %d: link not applied (token missing or already linked)",
				storyID, l.SentenceID, l.Pos)
		}
	}
	tag, err := tx.Exec(ctx, `UPDATE stories SET vocab_items = $1 WHERE id = $2`, encoded, storyID)
	if err != nil {
		return fmt.Errorf("story save links: vocab items: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return fmt.Errorf("story save links: story %s: vocab items not saved (story missing)", storyID)
	}
	return tx.Commit(ctx)
}
