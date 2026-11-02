package story

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore implements Store over the 00009 story tables.
type PostgresStore struct {
	pool *pgxpool.Pool
}

var _ Store = (*PostgresStore)(nil)

func NewPostgresStore(pool *pgxpool.Pool) *PostgresStore { return &PostgresStore{pool: pool} }

// Save writes the Story and every child row in one transaction. A Story
// carries its gate outcome either way (failed-story policy), so nothing here
// rejects Validated=false.
func (st *PostgresStore) Save(ctx context.Context, s *Story) error {
	if s.ID == uuid.Nil {
		s.ID = uuid.New()
	}
	// The genre may originate in model output: the store is the choke point
	// that keeps it a single-line, bounded label no matter who built the
	// Story (materialise sanitises too; this is idempotent).
	s.Genre = sanitizeLabel(s.Genre, maxLabelRunes)
	tx, err := st.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("story save: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck

	vocab, err := json.Marshal(s.VocabItems)
	if err != nil {
		return fmt.Errorf("story save: vocab items: %w", err)
	}
	origin := s.Origin
	if origin == "" {
		origin = OriginAutomatic
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO stories (id, user_id, genre, title, title_en, theme, origin, prompt, text, vocab_items,
			content_words, known_words, focus_items, focus_hit, validated, attempts)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
		s.ID, s.UserID, s.Genre, s.Title, s.TitleEN, s.Theme, string(origin), s.Prompt, s.Text, vocab,
		s.ContentWords, s.KnownWords, s.FocusItems, s.FocusHit, s.Validated, max(s.Attempts, 1)); err != nil {
		return fmt.Errorf("story save: %w", err)
	}

	for i := range s.Sentences {
		sen := &s.Sentences[i]
		if sen.ID == uuid.Nil {
			sen.ID = uuid.New()
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO story_sentences (id, story_id, position, ja, en)
			VALUES ($1,$2,$3,$4,$5)`, sen.ID, s.ID, sen.Pos, sen.JA, sen.EN); err != nil {
			return fmt.Errorf("story save: sentence: %w", err)
		}
		for j := range sen.Tokens {
			t := &sen.Tokens[j]
			if _, err := tx.Exec(ctx, `
				INSERT INTO story_tokens (id, story_id, sentence_id, position, surface, start, "end",
					reading, dictionary, ent_seq, tag, srs_level)
				VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
				uuid.New(), s.ID, sen.ID, t.Pos, t.Surface, t.Start, t.End,
				t.Reading, t.Dictionary, t.EntSeq, t.Tag, t.SRSLevel); err != nil {
				return fmt.Errorf("story save: token: %w", err)
			}
		}
		for k := range sen.Spans {
			sp := &sen.Spans[k]
			if sp.ID == uuid.Nil {
				sp.ID = uuid.New()
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO story_grammar_spans (id, story_id, sentence_id, start, "end", grammar_point_id, is_focus)
				VALUES ($1,$2,$3,$4,$5,$6,$7)`, sp.ID, s.ID, sen.ID, sp.Start, sp.End, sp.GrammarPointID, sp.IsFocus); err != nil {
				return fmt.Errorf("story save: span: %w", err)
			}
		}
	}
	for i := range s.Questions {
		q := &s.Questions[i]
		if q.ID == uuid.Nil {
			q.ID = uuid.New()
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO story_questions (id, story_id, position, prompt_ja, options_ja, answer_index)
			VALUES ($1,$2,$3,$4,$5,$6)`, q.ID, s.ID, q.Pos, q.PromptJA, q.OptionsJA, q.AnswerIndex); err != nil {
			return fmt.Errorf("story save: question: %w", err)
		}
	}
	// Failed-story housekeeping: a stuck provider keeps one analysable
	// failure per cooldown window, so bound the accumulation — the newest
	// maxStoredFailures failures per user survive, older ones go. Validated
	// stories are never pruned here.
	if !s.Validated {
		if _, err := tx.Exec(ctx, `
			DELETE FROM stories
			WHERE user_id = $1 AND NOT validated
			  AND id NOT IN (
				SELECT id FROM stories
				WHERE user_id = $1 AND NOT validated
				ORDER BY created_at DESC, id DESC
				LIMIT $2)`,
			s.UserID, maxStoredFailures); err != nil {
			return fmt.Errorf("story save: prune failed stories: %w", err)
		}
	}
	return tx.Commit(ctx)
}

// maxStoredFailures bounds each user's stored gate failures (failed-story
// policy keeps the newest for analysis; the bound stops unbounded growth).
const maxStoredFailures = 5

func (st *PostgresStore) Get(ctx context.Context, id, userID uuid.UUID) (*Story, error) {
	q := `
	SELECT s.id, s.user_id, s.genre, s.title, s.title_en, s.theme, s.origin, s.prompt, s.text, s.vocab_items,
	       s.content_words, s.known_words, s.focus_items, s.focus_hit,
	       s.validated, s.attempts, s.created_at, s.ready_at, s.practiced_at, s.read_at, r.rating
	FROM stories s
	LEFT JOIN story_ratings r ON r.story_id = s.id AND r.user_id = s.user_id
	WHERE s.id = $1 AND s.user_id = $2`
	return st.load(ctx, st.pool.QueryRow(ctx, q, id, userID))
}

// load scans one story row (via rowToStory) and then its children.
func (st *PostgresStore) load(ctx context.Context, row pgx.Row) (*Story, error) {
	s, err := rowToStory(row)
	if err != nil {
		return nil, err
	}
	if err := st.loadChildren(ctx, s); err != nil {
		return nil, err
	}
	return s, nil
}

func rowToStory(row pgx.Row) (*Story, error) {
	var s Story
	var rating *string
	var title, titleEN, theme *string
	var origin string
	err := row.Scan(&s.ID, &s.UserID, &s.Genre, &title, &titleEN, &theme, &origin, &s.Prompt, &s.Text, &s.VocabItems,
		&s.ContentWords, &s.KnownWords, &s.FocusItems, &s.FocusHit,
		&s.Validated, &s.Attempts, &s.CreatedAt, &s.ReadyAt, &s.PracticedAt, &s.ReadAt, &rating)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("story get: %w", err)
	}
	if title != nil {
		s.Title = *title
	}
	if titleEN != nil {
		s.TitleEN = *titleEN
	}
	if theme != nil {
		s.Theme = *theme
	}
	s.Origin = StoryOrigin(origin)
	if s.Origin == "" {
		s.Origin = OriginAutomatic
	}
	if rating != nil {
		r := Rating(*rating)
		s.Rating = &r
	}
	return &s, nil
}

func (st *PostgresStore) loadChildren(ctx context.Context, s *Story) error {
	rows, err := st.pool.Query(ctx, `
		SELECT id, position, ja, en FROM story_sentences WHERE story_id = $1 ORDER BY position`, s.ID)
	if err != nil {
		return fmt.Errorf("story sentences: %w", err)
	}
	for rows.Next() {
		var sen Sentence
		if err := rows.Scan(&sen.ID, &sen.Pos, &sen.JA, &sen.EN); err != nil {
			rows.Close()
			return fmt.Errorf("story sentences: %w", err)
		}
		s.Sentences = append(s.Sentences, sen)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	senByID := make(map[uuid.UUID]*Sentence, len(s.Sentences))
	for i := range s.Sentences {
		senByID[s.Sentences[i].ID] = &s.Sentences[i]
	}

	trows, err := st.pool.Query(ctx, `
		SELECT sentence_id, position, surface, start, "end", reading, dictionary, ent_seq, tag, srs_level
		FROM story_tokens WHERE story_id = $1 ORDER BY sentence_id, position`, s.ID)
	if err != nil {
		return fmt.Errorf("story tokens: %w", err)
	}
	for trows.Next() {
		var senID uuid.UUID
		var t Token
		if err := trows.Scan(&senID, &t.Pos, &t.Surface, &t.Start, &t.End,
			&t.Reading, &t.Dictionary, &t.EntSeq, &t.Tag, &t.SRSLevel); err != nil {
			trows.Close()
			return fmt.Errorf("story tokens: %w", err)
		}
		if sen, ok := senByID[senID]; ok {
			sen.Tokens = append(sen.Tokens, t)
		}
	}
	trows.Close()
	if err := trows.Err(); err != nil {
		return err
	}

	srows, err := st.pool.Query(ctx, `
		SELECT sp.id, sp.sentence_id, sp.start, sp."end", sp.grammar_point_id, sp.is_focus,
		       gp.pattern, gp.meaning, gp.jlpt_level
		FROM story_grammar_spans sp
		JOIN grammar_points gp ON gp.id = sp.grammar_point_id
		WHERE sp.story_id = $1 ORDER BY sp.sentence_id, sp.start`, s.ID)
	if err != nil {
		return fmt.Errorf("story spans: %w", err)
	}
	for srows.Next() {
		var sp Span
		var senID uuid.UUID
		if err := srows.Scan(&sp.ID, &senID, &sp.Start, &sp.End, &sp.GrammarPointID, &sp.IsFocus,
			&sp.Pattern, &sp.Meaning, &sp.JLPTLevel); err != nil {
			srows.Close()
			return fmt.Errorf("story spans: %w", err)
		}
		if sen, ok := senByID[senID]; ok {
			sen.Spans = append(sen.Spans, sp)
		}
	}
	srows.Close()
	if err := srows.Err(); err != nil {
		return err
	}

	qrows, err := st.pool.Query(ctx, `
		SELECT id, position, prompt_ja, options_ja, answer_index
		FROM story_questions WHERE story_id = $1 ORDER BY position`, s.ID)
	if err != nil {
		return fmt.Errorf("story questions: %w", err)
	}
	for qrows.Next() {
		var q Question
		if err := qrows.Scan(&q.ID, &q.Pos, &q.PromptJA, &q.OptionsJA, &q.AnswerIndex); err != nil {
			qrows.Close()
			return fmt.Errorf("story questions: %w", err)
		}
		s.Questions = append(s.Questions, q)
	}
	qrows.Close()
	if err := qrows.Err(); err != nil {
		return err
	}
	return nil
}

// List returns validated stories only — failed stories are kept for analysis,
// not offered (failed-story policy).
func (st *PostgresStore) List(ctx context.Context, userID uuid.UUID, limit, offset int) ([]*Story, int, error) {
	var total int
	if err := st.pool.QueryRow(ctx, `SELECT count(*) FROM stories WHERE user_id = $1 AND validated`, userID).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("story list count: %w", err)
	}
	rows, err := st.pool.Query(ctx, `
		SELECT s.id, s.user_id, s.genre, s.title, s.title_en, s.theme, s.origin, s.prompt, s.text, s.vocab_items,
		       s.content_words, s.known_words, s.focus_items, s.focus_hit,
		       s.validated, s.attempts, s.created_at, s.ready_at, s.practiced_at, s.read_at, r.rating
		FROM stories s
		LEFT JOIN story_ratings r ON r.story_id = s.id AND r.user_id = s.user_id
		WHERE s.user_id = $1 AND s.validated
		ORDER BY s.created_at DESC, s.id
		LIMIT $2 OFFSET $3`, userID, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("story list: %w", err)
	}
	var out []*Story
	for rows.Next() {
		s, err := rowToStory(rows)
		if err != nil {
			rows.Close()
			return nil, 0, err
		}
		out = append(out, s)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	for _, s := range out {
		if err := st.loadChildren(ctx, s); err != nil {
			return nil, 0, err
		}
	}
	return out, total, nil
}

// Rate upserts; the WHERE EXISTS keeps other users' stories unreachable.
func (st *PostgresStore) Rate(ctx context.Context, storyID, userID uuid.UUID, r Rating) error {
	tag, err := st.pool.Exec(ctx, `
		INSERT INTO story_ratings (story_id, user_id, rating)
		SELECT $1, $2, $3
		WHERE EXISTS (SELECT 1 FROM stories WHERE id = $1 AND user_id = $2)
		ON CONFLICT (story_id) DO UPDATE SET rating = EXCLUDED.rating, rated_at = now()`,
		storyID, userID, string(r))
	if err != nil {
		return fmt.Errorf("story rate: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (st *PostgresStore) RatingCounts(ctx context.Context, userID uuid.UUID) (map[string]map[Rating]int, error) {
	rows, err := st.pool.Query(ctx, `
		SELECT s.genre, r.rating, count(*)
		FROM story_ratings r JOIN stories s ON s.id = r.story_id
		WHERE r.user_id = $1
		GROUP BY s.genre, r.rating`, userID)
	if err != nil {
		return nil, fmt.Errorf("story rating counts: %w", err)
	}
	defer rows.Close()
	out := map[string]map[Rating]int{}
	for rows.Next() {
		var genre, rating string
		var n int
		if err := rows.Scan(&genre, &rating, &n); err != nil {
			return nil, fmt.Errorf("story rating counts: %w", err)
		}
		if out[genre] == nil {
			out[genre] = map[Rating]int{}
		}
		out[genre][Rating(rating)] = n
	}
	return out, rows.Err()
}

func (st *PostgresStore) ReadyStoryID(ctx context.Context, userID uuid.UUID) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := st.pool.QueryRow(ctx, `SELECT id FROM stories WHERE user_id = $1 AND ready_at IS NOT NULL`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, fmt.Errorf("story ready: %w", err)
	}
	return id, true, nil
}

// errReadyConflict marks a lost SetReady race: another concurrent SetReady
// took the user's one ready slot first, which the partial unique index turns
// into a 23505 unique violation. The service treats it as benign — the
// loser's story stays stored and validated, just not ready.
var errReadyConflict = errors.New("story: another story is already ready for this user")

// SetReady clears any other ready story first: the partial unique index
// (one ready row per user) makes a race fail loudly rather than fork, and
// the 23505 is wrapped in errReadyConflict so callers can tell the race
// apart from a genuine fault.
func (st *PostgresStore) SetReady(ctx context.Context, storyID, userID uuid.UUID) error {
	tx, err := st.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("story set ready: %w", err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `UPDATE stories SET ready_at = NULL WHERE user_id = $1 AND ready_at IS NOT NULL`, userID); err != nil {
		return fmt.Errorf("story set ready: %w", err)
	}
	tag, err := tx.Exec(ctx, `UPDATE stories SET ready_at = now() WHERE id = $1 AND user_id = $2`, storyID, userID)
	if err != nil {
		return wrapReadyConflict(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	if err := tx.Commit(ctx); err != nil {
		// The index is checked at commit too: a concurrent winner commits
		// between our UPDATE and ours.
		return wrapReadyConflict(err)
	}
	return nil
}

// wrapReadyConflict turns Postgres' unique violation (23505, the one-ready-
// per-user partial index rejecting a second ready row) into the package's
// errReadyConflict sentinel; anything else passes through unchanged.
func wrapReadyConflict(err error) error {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && pe.Code == "23505" {
		return fmt.Errorf("story set ready: %w", errReadyConflict)
	}
	return fmt.Errorf("story set ready: %w", err)
}

func (st *PostgresStore) ClearReady(ctx context.Context, storyID uuid.UUID) error {
	if _, err := st.pool.Exec(ctx, `UPDATE stories SET ready_at = NULL WHERE id = $1`, storyID); err != nil {
		return fmt.Errorf("story clear ready: %w", err)
	}
	return nil
}

// LastFailedAt is the failure backoff's clock: it reports the newest story's
// creation time only when that newest story failed the gate. An older
// failure followed by a validated story is not "stuck", so it reports false.
func (st *PostgresStore) LastFailedAt(ctx context.Context, userID uuid.UUID) (time.Time, bool, error) {
	var at time.Time
	var validated bool
	err := st.pool.QueryRow(ctx, `
		SELECT created_at, validated FROM stories
		WHERE user_id = $1
		ORDER BY created_at DESC, id DESC
		LIMIT 1`, userID).Scan(&at, &validated)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, fmt.Errorf("story last failed at: %w", err)
	}
	return at, !validated, nil
}

func (st *PostgresStore) GenresByLastActivity(ctx context.Context, userID uuid.UUID, limit int) ([]string, error) {
	rows, err := st.pool.Query(ctx, `
		SELECT genre FROM stories WHERE user_id = $1 AND validated
		ORDER BY created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("story genres: %w", err)
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var g string
		if err := rows.Scan(&g); err != nil {
			return nil, fmt.Errorf("story genres: %w", err)
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

func (st *PostgresStore) FuriganaThreshold(ctx context.Context, userID uuid.UUID) (int, error) {
	var n int
	err := st.pool.QueryRow(ctx, `SELECT furigana_threshold_srs_level FROM users WHERE id = $1`, userID).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("story furigana threshold: %w", err)
	}
	return n, nil
}

func (st *PostgresStore) SetFuriganaThreshold(ctx context.Context, userID uuid.UUID, level int) error {
	tag, err := st.pool.Exec(ctx, `UPDATE users SET furigana_threshold_srs_level = $2 WHERE id = $1`, userID, level)
	if err != nil {
		return fmt.Errorf("story furigana threshold: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (st *PostgresStore) BlurTranslation(ctx context.Context, userID uuid.UUID) (bool, error) {
	var blur bool
	err := st.pool.QueryRow(ctx, `SELECT blur_translation FROM users WHERE id = $1`, userID).Scan(&blur)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, fmt.Errorf("story blur translation: %w", err)
	}
	return blur, nil
}

func (st *PostgresStore) SetBlurTranslation(ctx context.Context, userID uuid.UUID, blur bool) error {
	tag, err := st.pool.Exec(ctx, `UPDATE users SET blur_translation = $2 WHERE id = $1`, userID, blur)
	if err != nil {
		return fmt.Errorf("story blur translation: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// LookupHoldMs reads the reader's lookup-hold threshold (issue #12). The
// column default is 800; rows predating the migration read the same default.
func (st *PostgresStore) LookupHoldMs(ctx context.Context, userID uuid.UUID) (int, error) {
	var hold int
	err := st.pool.QueryRow(ctx, `SELECT lookup_hold_ms FROM users WHERE id = $1`, userID).Scan(&hold)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrNotFound
	}
	if err != nil {
		return 0, fmt.Errorf("story lookup hold: %w", err)
	}
	return hold, nil
}

func (st *PostgresStore) SetLookupHoldMs(ctx context.Context, userID uuid.UUID, holdMs int) error {
	tag, err := st.pool.Exec(ctx, `UPDATE users SET lookup_hold_ms = $2 WHERE id = $1`, userID, holdMs)
	if err != nil {
		return fmt.Errorf("story lookup hold: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// StoryPrefs reads the user's preferred genre/theme, creating the state row
// with empty ("surprise me") defaults when there is none yet.
func (st *PostgresStore) StoryPrefs(ctx context.Context, userID uuid.UUID) (string, string, error) {
	var genre, theme string
	err := st.pool.QueryRow(ctx, `
		SELECT preferred_genre, preferred_theme
		FROM story_user_state
		WHERE user_id = $1`, userID).Scan(&genre, &theme)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	if err != nil {
		return "", "", fmt.Errorf("story prefs: %w", err)
	}
	return genre, theme, nil
}

func (st *PostgresStore) SetStoryPrefs(ctx context.Context, userID uuid.UUID, genre, theme string) error {
	_, err := st.pool.Exec(ctx, `
		INSERT INTO story_user_state (user_id, preferred_genre, preferred_theme)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id) DO UPDATE
		SET preferred_genre = EXCLUDED.preferred_genre, preferred_theme = EXCLUDED.preferred_theme, updated_at = now()`,
		userID, genre, theme)
	if err != nil {
		return fmt.Errorf("story prefs: %w", err)
	}
	return nil
}

func (st *PostgresStore) FocusSnapshot(ctx context.Context, userID uuid.UUID) ([]string, error) {
	var keys []string
	err := st.pool.QueryRow(ctx, `SELECT focus_snapshot FROM story_user_state WHERE user_id = $1`, userID).Scan(&keys)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("story focus snapshot: %w", err)
	}
	return keys, nil
}

func (st *PostgresStore) SetFocusSnapshot(ctx context.Context, userID uuid.UUID, keys []string) error {
	if keys == nil {
		keys = []string{}
	}
	_, err := st.pool.Exec(ctx, `
		INSERT INTO story_user_state (user_id, focus_snapshot)
		VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET focus_snapshot = EXCLUDED.focus_snapshot, updated_at = now()`,
		userID, keys)
	if err != nil {
		return fmt.Errorf("story focus snapshot: %w", err)
	}
	return nil
}

// MarkPracticed is the at-most-once guard: it claims practiced_at only if it
// is still NULL, so exactly one caller ever gets true.
func (st *PostgresStore) MarkPracticed(ctx context.Context, storyID uuid.UUID, at time.Time) (bool, error) {
	var id uuid.UUID
	err := st.pool.QueryRow(ctx, `
		UPDATE stories SET practiced_at = $2 WHERE id = $1 AND practiced_at IS NULL RETURNING id`, storyID, at).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if err := st.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM stories WHERE id = $1)`, storyID).Scan(&exists); err != nil {
			return false, fmt.Errorf("story practiced: %w", err)
		}
		if !exists {
			return false, ErrNotFound
		}
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("story practiced: %w", err)
	}
	return true, nil
}

// ResetPracticed undoes a MarkPracticed claim — and only that claim: the
// WHERE keeps the compare-and-clear on the exact timestamp, so a retry of
// Answer can write the Practice Records a failed append never landed, while a
// concurrent answer's successful claim is never disturbed.
func (st *PostgresStore) ResetPracticed(ctx context.Context, storyID uuid.UUID, at time.Time) error {
	if _, err := st.pool.Exec(ctx, `UPDATE stories SET practiced_at = NULL WHERE id = $1 AND practiced_at = $2`, storyID, at); err != nil {
		return fmt.Errorf("story unpracticed: %w", err)
	}
	return nil
}

// MarkRead sets the Read mark (issue #31); it is idempotent — re-marking a
// read Story just restamps it. Owner-scoped like every other method.
func (st *PostgresStore) MarkRead(ctx context.Context, storyID, userID uuid.UUID, at time.Time) error {
	tag, err := st.pool.Exec(ctx, `UPDATE stories SET read_at = $3 WHERE id = $1 AND user_id = $2`, storyID, userID, at)
	if err != nil {
		return fmt.Errorf("story mark read: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ClearRead unsets the Read mark.
func (st *PostgresStore) ClearRead(ctx context.Context, storyID, userID uuid.UUID) error {
	tag, err := st.pool.Exec(ctx, `UPDATE stories SET read_at = NULL WHERE id = $1 AND user_id = $2`, storyID, userID)
	if err != nil {
		return fmt.Errorf("story clear read: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Delete removes the Story row; its sentences, tokens, spans, questions,
// vocab lists and rating all ride ON DELETE CASCADE, while practice_records
// have no foreign key to stories, so the Practice Records it wrote stay.
func (st *PostgresStore) Delete(ctx context.Context, storyID, userID uuid.UUID) error {
	tag, err := st.pool.Exec(ctx, `DELETE FROM stories WHERE id = $1 AND user_id = $2`, storyID, userID)
	if err != nil {
		return fmt.Errorf("story delete: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (st *PostgresStore) UserIDs(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := st.pool.Query(ctx, `SELECT id FROM users ORDER BY id`)
	if err != nil {
		return nil, fmt.Errorf("story users: %w", err)
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("story users: %w", err)
		}
		out = append(out, id)
	}
	return out, rows.Err()
}
