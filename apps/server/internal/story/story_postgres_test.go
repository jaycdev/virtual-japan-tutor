package story

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// The Store contract over the real 00009 schema (skipped without
// TEST_DATABASE_URL): the Save/Get round trip of every child row, the
// one-ready-per-user invariant, the validated-only library, the at-most-once
// practiced marker, and the per-user settings. This is the schema-drift guard
// the in-memory fakeStore cannot provide.
func TestPostgresStoreAgainstPostgres(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	st := NewPostgresStore(pool)

	user := uuid.New()
	other := uuid.New()
	for _, u := range []uuid.UUID{user, other} {
		if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, u, u.String()); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}
	const (
		entSchool = 990101
		entFire   = 990102
	)
	if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES ($1, true), ($2, true)`, entSchool, entFire); err != nil {
		t.Fatalf("seed jmdict: %v", err)
	}
	var grammarPoint int64
	if err := pool.QueryRow(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning, variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 990101, 1, '～ました', 'mashita', 'past tense (polite)', ARRAY['ました'], 'ました990101', ARRAY['ました'])
		RETURNING id`).Scan(&grammarPoint); err != nil {
		t.Fatalf("seed grammar: %v", err)
	}

	ent := int64(entSchool)
	srs := 4
	saved := &Story{
		UserID: user,
		Genre:  "diary",
		Prompt: "write a diary entry",
		Text:   "がっこう　で　べんきょう　しました。",
		Sentences: []Sentence{{
			Pos: 0, JA: "がっこうでべんきょうしました。", EN: "I studied at school.",
			Tokens: []Token{
				{Pos: 0, Surface: "がっこう", Start: 0, End: 4, Reading: "がっこう", Dictionary: "がっこう", EntSeq: &ent, Tag: TagKnown, SRSLevel: &srs},
				{Pos: 1, Surface: "で", Start: 4, End: 5, Reading: "で", Dictionary: "で", Tag: TagUnknown},
				{Pos: 2, Surface: "べんきょう", Start: 5, End: 9, Reading: "べんきょう", Dictionary: "べんきょう", EntSeq: ptr(int64(entFire)), Tag: TagUnknown},
				{Pos: 3, Surface: "しました", Start: 9, End: 13, Reading: "しました", Dictionary: "する", Tag: TagUnknown},
			},
			Spans: []Span{{Start: 9, End: 13, GrammarPointID: grammarPoint, IsFocus: true}},
		}},
		Questions: []Question{
			{Pos: 0, PromptJA: "どこで べんきょう しましたか。", OptionsJA: []string{"がっこう", "いえ"}, AnswerIndex: 0},
			{Pos: 1, PromptJA: "いつ しましたか。", OptionsJA: []string{"きのう", "あした"}, AnswerIndex: 1},
			{Pos: 2, PromptJA: "なにを しましたか。", OptionsJA: []string{"べんきょう", "ごはん"}, AnswerIndex: 0},
		},
		VocabItems: []VocabItem{
			{EntSeq: entSchool, JA: "学校", EN: "school", IsKnown: true, IsFocus: true},
			{EntSeq: entFire, JA: "火", EN: "fire"},
		},
		ContentWords: 3,
		KnownWords:   1,
		FocusItems:   2,
		FocusHit:     1,
		Validated:    true,
		Attempts:     2,
	}
	if err := st.Save(ctx, saved); err != nil {
		t.Fatalf("save: %v", err)
	}
	if saved.ID == uuid.Nil {
		t.Fatal("save assigned no id")
	}

	got, err := st.Get(ctx, saved.ID, user)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	if got.Genre != "diary" || got.Text != saved.Text || !got.Validated || got.Attempts != 2 {
		t.Errorf("story fields round-trip: %+v", got)
	}
	if got.ContentWords != 3 || got.KnownWords != 1 || got.FocusItems != 2 || got.FocusHit != 1 {
		t.Errorf("gate counts round-trip: %+v", got)
	}
	if len(got.VocabItems) != 2 || got.VocabItems[0].EntSeq != entSchool || !got.VocabItems[0].IsFocus || got.VocabItems[1].IsKnown {
		t.Errorf("vocab items: %+v", got.VocabItems)
	}
	if len(got.Sentences) != 1 {
		t.Fatalf("sentences: %d", len(got.Sentences))
	}
	sen := got.Sentences[0]
	if len(sen.Tokens) != 4 {
		t.Fatalf("tokens: %d", len(sen.Tokens))
	}
	if sen.Tokens[0].Start != 0 || sen.Tokens[0].End != 4 || sen.Tokens[0].EntSeq == nil || *sen.Tokens[0].EntSeq != entSchool {
		t.Errorf("token ent_seq/offsets: %+v", sen.Tokens[0])
	}
	if sen.Tokens[1].EntSeq != nil {
		t.Errorf("unlinked token gained an ent_seq: %+v", sen.Tokens[1])
	}
	if sen.Tokens[0].SRSLevel == nil || *sen.Tokens[0].SRSLevel != 4 {
		t.Errorf("token srs level: %+v", sen.Tokens[0])
	}
	if len(sen.Spans) != 1 || sen.Spans[0].GrammarPointID != grammarPoint || sen.Spans[0].Start != 9 || sen.Spans[0].End != 13 {
		t.Errorf("grammar spans: %+v", sen.Spans)
	}
	if !sen.Spans[0].IsFocus {
		t.Errorf("span is_focus did not round-trip: %+v", sen.Spans[0])
	}
	// Read-time enrichment (issue #11): the store joins the Grammar Point's
	// own row in, so the reader's hover needs no extra request.
	if sen.Spans[0].Pattern != "～ました" || sen.Spans[0].Meaning != "past tense (polite)" || sen.Spans[0].JLPTLevel != "N5" {
		t.Errorf("span enrichment = %+v, want the grammar_points pattern/meaning/level", sen.Spans[0])
	}
	if len(got.Questions) != 3 || got.Questions[2].AnswerIndex != 0 || len(got.Questions[0].OptionsJA) != 2 {
		t.Errorf("questions: %+v", got.Questions)
	}
	if got.Rating != nil {
		t.Errorf("unrated story carries a rating: %v", *got.Rating)
	}

	// Ownership: another user sees nothing.
	if _, err := st.Get(ctx, saved.ID, other); err != ErrNotFound {
		t.Errorf("foreign get: %v, want ErrNotFound", err)
	}
	if err := st.Rate(ctx, saved.ID, other, RatingUp); err != ErrNotFound {
		t.Errorf("foreign rate: %v, want ErrNotFound", err)
	}

	// Rating upserts and reads back through Get, and tallies by genre.
	if err := st.Rate(ctx, saved.ID, user, RatingDown); err != nil {
		t.Fatalf("rate: %v", err)
	}
	if err := st.Rate(ctx, saved.ID, user, RatingUp); err != nil {
		t.Fatalf("rate again: %v", err)
	}
	got, err = st.Get(ctx, saved.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.Rating == nil || *got.Rating != RatingUp {
		t.Errorf("rating upsert: %v", got.Rating)
	}
	counts, err := st.RatingCounts(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if counts["diary"][RatingUp] != 1 || counts["diary"][RatingDown] != 0 {
		t.Errorf("rating counts: %+v", counts)
	}

	// One ready story per user, enforced in the store itself.
	if _, ok, err := st.ReadyStoryID(ctx, user); err != nil || ok {
		t.Fatalf("fresh user has a ready story: ok=%v err=%v", ok, err)
	}
	first := saveStory(t, ctx, st, user, "ready one", true)
	second := saveStory(t, ctx, st, user, "ready two", true)
	if err := st.SetReady(ctx, first.ID, user); err != nil {
		t.Fatal(err)
	}
	if err := st.SetReady(ctx, second.ID, user); err != nil {
		t.Fatalf("SetReady should replace the previous ready story: %v", err)
	}
	id, ok, err := st.ReadyStoryID(ctx, user)
	if err != nil || !ok || id != second.ID {
		t.Fatalf("ready story: id=%v ok=%v err=%v, want %v", id, ok, err, second.ID)
	}
	if err := st.ClearReady(ctx, second.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := st.ReadyStoryID(ctx, user); ok {
		t.Error("ready survived ClearReady")
	}
	if err := st.SetReady(ctx, uuid.New(), user); err != ErrNotFound {
		t.Errorf("SetReady unknown story: %v, want ErrNotFound", err)
	}

	// The library shows validated Stories only, newest first, paginated.
	third := saveStory(t, ctx, st, user, "validated three", true)
	failed := saveStory(t, ctx, st, user, "failed", false)
	// Pin creation times so the newest-first order is unambiguous.
	for i, s := range []*Story{saved, first, second, third, failed} {
		if _, err := pool.Exec(ctx, `UPDATE stories SET created_at = now() - make_interval(hours => $2) WHERE id = $1`, s.ID, 5-i); err != nil {
			t.Fatal(err)
		}
	}
	page, total, err := st.List(ctx, user, 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if total != 4 { // saved ("diary"), first, second, third; the failed story is excluded
		t.Errorf("list total: %d, want 4 (validated only)", total)
	}
	if len(page) != 2 || page[0].ID != third.ID || page[1].ID != second.ID {
		t.Errorf("list page order: %v", ids(page))
	}
	page2, total2, err := st.List(ctx, user, 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if total2 != 4 || len(page2) != 2 || page2[0].ID != first.ID || page2[1].ID != saved.ID {
		t.Errorf("list page two: total=%d ids=%v", total2, ids(page2))
	}
	if _, total, err := st.List(ctx, other, 10, 0); err != nil || total != 0 {
		t.Errorf("foreign list: total=%d err=%v", total, err)
	}
	// Children load for listed rows too.
	if len(page[0].Sentences) == 0 || len(page[0].Questions) != 3 {
		t.Errorf("listed story missing children: %+v", page[0])
	}

	// Genres seed PickGenre newest-first.
	genres, err := st.GenresByLastActivity(ctx, user, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(genres) != 2 || genres[0] != "validated three" || genres[1] != "ready two" {
		t.Errorf("genres by activity: %v", genres)
	}

	// MarkPracticed is at-most-once.
	at := time.Now().UTC()
	claimed, err := st.MarkPracticed(ctx, third.ID, at)
	if err != nil || !claimed {
		t.Fatalf("first MarkPracticed: claimed=%v err=%v", claimed, err)
	}
	claimed, err = st.MarkPracticed(ctx, third.ID, at)
	if err != nil || claimed {
		t.Fatalf("second MarkPracticed: claimed=%v err=%v, want false", claimed, err)
	}
	got, err = st.Get(ctx, third.ID, user)
	if err != nil {
		t.Fatal(err)
	}
	if got.PracticedAt == nil {
		t.Error("practiced_at not stored")
	}
	if _, err := st.MarkPracticed(ctx, uuid.New(), at); err != ErrNotFound {
		t.Errorf("MarkPracticed unknown story: %v, want ErrNotFound", err)
	}

	// Per-user settings: furigana threshold and focus snapshot.
	threshold, err := st.FuriganaThreshold(ctx, user)
	if err != nil {
		t.Fatal(err)
	}
	if threshold != 3 {
		t.Errorf("default furigana threshold: %d, want 3", threshold)
	}
	if err := st.SetFuriganaThreshold(ctx, user, 5); err != nil {
		t.Fatal(err)
	}
	if n, err := st.FuriganaThreshold(ctx, user); err != nil || n != 5 {
		t.Errorf("furigana threshold after set: %d err=%v", n, err)
	}
	if err := st.SetFuriganaThreshold(ctx, uuid.New(), 5); err != ErrNotFound {
		t.Errorf("threshold for unknown user: %v, want ErrNotFound", err)
	}

	// Reading settings (issue #11): the users column defaults to blurred,
	// and writes are scoped to real users.
	if blur, err := st.BlurTranslation(ctx, user); err != nil || !blur {
		t.Errorf("default blur_translation: %v err=%v, want true/nil", blur, err)
	}
	if err := st.SetBlurTranslation(ctx, user, false); err != nil {
		t.Fatal(err)
	}
	if blur, err := st.BlurTranslation(ctx, user); err != nil || blur {
		t.Errorf("blur_translation after set: %v err=%v, want false/nil", blur, err)
	}
	if err := st.SetBlurTranslation(ctx, uuid.New(), false); err != ErrNotFound {
		t.Errorf("blur setting for unknown user: %v, want ErrNotFound", err)
	}

	// Checked while the user has no story_user_state row at all.
	if keys, err := st.FocusSnapshot(ctx, user); err != nil || keys != nil {
		t.Errorf("empty snapshot: %v err=%v", keys, err)
	}
	if err := st.SetFocusSnapshot(ctx, user, []string{"vocabulary:990101", "grammar:1"}); err != nil {
		t.Fatal(err)
	}
	keys, err := st.FocusSnapshot(ctx, user)
	if err != nil || len(keys) != 2 || keys[0] != "vocabulary:990101" {
		t.Errorf("snapshot round trip: %v err=%v", keys, err)
	}
	if err := st.SetFocusSnapshot(ctx, user, nil); err != nil {
		t.Fatal(err)
	}
	if keys, err := st.FocusSnapshot(ctx, user); err != nil || len(keys) != 0 {
		t.Errorf("cleared snapshot: %v err=%v", keys, err)
	}

	// Story prefs: empty means "surprise me", and the round trip stores
	// genre and theme together.
	if g, th, err := st.StoryPrefs(ctx, user); err != nil || g != "" || th != "" {
		t.Errorf("default prefs: %q/%q err=%v, want empty", g, th, err)
	}
	if err := st.SetStoryPrefs(ctx, user, "mystery", "ロボット"); err != nil {
		t.Fatal(err)
	}
	if g, th, err := st.StoryPrefs(ctx, user); err != nil || g != "mystery" || th != "ロボット" {
		t.Errorf("prefs round trip: %q/%q err=%v", g, th, err)
	}
	if err := st.SetStoryPrefs(ctx, user, "", ""); err != nil {
		t.Fatal(err)
	}
	if g, th, err := st.StoryPrefs(ctx, user); err != nil || g != "" || th != "" {
		t.Errorf("cleared prefs: %q/%q err=%v, want empty", g, th, err)
	}

	// UserIDs drives the background sweep.
	users, err := st.UserIDs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(users) < 2 {
		t.Errorf("user ids: %v", users)
	}
}

// The 00009 schema's guards, against the real schema: the SRS Level CHECK,
// the withdrawn-entry behaviour of story_tokens.ent_seq, and the two
// lookup indexes the read paths need.
func TestPostgresStorySchemaConstraints(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	st := NewPostgresStore(pool)

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, user, user.String()); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	const ent = 990199
	if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES ($1, true)`, ent); err != nil {
		t.Fatalf("seed jmdict: %v", err)
	}

	saved := saveStory(t, ctx, st, user, "schema", true)
	var sentence uuid.UUID
	if err := pool.QueryRow(ctx, `SELECT id FROM story_sentences WHERE story_id = $1`, saved.ID).Scan(&sentence); err != nil {
		t.Fatal(err)
	}
	insertToken := func(srs any, pos int) error {
		_, err := pool.Exec(ctx, `
			INSERT INTO story_tokens (id, story_id, sentence_id, position, surface, start, "end", reading, dictionary, ent_seq, tag, srs_level)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
			uuid.New(), saved.ID, sentence, pos, "ねこ", 0, 2, "ねこ", "猫", ent, "known", srs)
		return err
	}

	// mastery's scale is 0–9: a level outside it is a schema error, not a
	// silently meaningless number.
	if err := insertToken(10, 7); err == nil {
		t.Fatal("srs_level 10 accepted, want the CHECK to reject it")
	} else if !strings.Contains(err.Error(), "srs_level") {
		t.Fatalf("srs_level 10 rejected by %v, want the srs_level CHECK", err)
	}
	if err := insertToken(nil, 8); err != nil {
		t.Fatalf("unknown-token row (no level) rejected: %v", err)
	}
	if err := insertToken(0, 9); err != nil {
		t.Fatalf("level 0 rejected: %v", err)
	}

	// A jmdict entry withdrawn upstream unlinks the token rather than
	// deleting the Story: the row survives with ent_seq NULL, reading as
	// unlinked exactly like a token that never linked.
	if _, err := pool.Exec(ctx, `DELETE FROM jmdict_entries WHERE ent_seq = $1`, ent); err != nil {
		t.Fatalf("withdraw entry: %v", err)
	}
	var linked *int64
	if err := pool.QueryRow(ctx, `SELECT ent_seq FROM story_tokens WHERE sentence_id = $1 AND position = 8`, sentence).Scan(&linked); err != nil {
		t.Fatal(err)
	}
	if linked != nil {
		t.Fatalf("ent_seq survived the entry's deletion: %d, want NULL", *linked)
	}
	if _, err := st.Get(ctx, saved.ID, user); err != nil {
		t.Fatalf("story vanished with a withdrawn entry: %v", err)
	}

	// The read paths' indexes: spans by story, ratings by user.
	names, err := storyIndexes(ctx, pool, "story_grammar_spans", "story_ratings")
	if err != nil {
		t.Fatal(err)
	}
	if !names["story_grammar_spans_story_idx"] {
		t.Error("story_grammar_spans has no story_id index (Get would seq-scan every span)")
	}
	if !names["story_ratings_user_idx"] {
		t.Error("story_ratings has no user_id index (rating steering would seq-scan)")
	}
}

// storyIndexes lists the index names on the given tables of this test's
// schema.
func storyIndexes(ctx context.Context, pool *pgxpool.Pool, tables ...string) (map[string]bool, error) {
	rows, err := pool.Query(ctx, `
		SELECT tablename, indexname FROM pg_indexes
		WHERE schemaname = current_schema() AND tablename = ANY($1)`, tables)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var table, name string
		if err := rows.Scan(&table, &name); err != nil {
			return nil, err
		}
		out[name] = true
	}
	return out, rows.Err()
}

// wrapReadyConflict is pure: the one-ready-per-user partial index's 23505
// becomes the package's benign sentinel, while any other failure stays a
// genuine fault. (The race itself needs two servers to force, so the store's
// contract is pinned here and the service's handling in service_test.go.)
func TestWrapReadyConflict(t *testing.T) {
	unique := &pgconn.PgError{Code: "23505", ConstraintName: "stories_one_ready_per_user_idx", Message: "duplicate key value violates unique constraint"}
	err := wrapReadyConflict(unique)
	if !errors.Is(err, errReadyConflict) {
		t.Fatalf("23505 wrapped as %v, want it to wrap errReadyConflict", err)
	}
	fkey := &pgconn.PgError{Code: "23503", Message: "insert or update on table violates foreign key constraint"}
	if got := wrapReadyConflict(fkey); errors.Is(got, errReadyConflict) {
		t.Fatalf("a foreign-key failure wrapped as %v, must not look like a ready race", got)
	}
	if got := wrapReadyConflict(errors.New("network down")); errors.Is(got, errReadyConflict) {
		t.Fatalf("a transport failure wrapped as %v, must not look like a ready race", got)
	}
}

// The failure backoff's clock and the failed-story bound, against the real
// schema (skipped without TEST_DATABASE_URL).
func TestPostgresLastFailedAtAndFailurePruning(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	st := NewPostgresStore(pool)

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, user, user.String()); err != nil {
		t.Fatalf("seed user: %v", err)
	}

	// No stories yet: nothing to wait out.
	if at, failed, err := st.LastFailedAt(ctx, user); err != nil || failed || !at.IsZero() {
		t.Fatalf("empty user: at=%v failed=%v err=%v, want zero/false/nil", at, failed, err)
	}

	// A gate failure arms the backoff, with the story's own timestamp.
	failed1 := saveStory(t, ctx, st, user, "failed one", false)
	at, failed, err := st.LastFailedAt(ctx, user)
	if err != nil || !failed {
		t.Fatalf("after a failure: failed=%v err=%v, want true", failed, err)
	}
	var row time.Time
	if err := pool.QueryRow(ctx, `SELECT created_at FROM stories WHERE id = $1`, failed1.ID).Scan(&row); err != nil {
		t.Fatal(err)
	}
	if !at.Equal(row) {
		t.Fatalf("LastFailedAt = %v, want the newest failure's created_at %v", at, row)
	}

	// A newer validated story clears it: an old failure behind a success is
	// not a stuck user.
	saveStory(t, ctx, st, user, "validated", true)
	if _, failed, err := st.LastFailedAt(ctx, user); err != nil || failed {
		t.Fatalf("newest story validated: failed=%v err=%v, want false", failed, err)
	}

	// Bound the accumulation: each user keeps the newest maxStoredFailures
	// gate failures, and validated Stories are never pruned by it.
	var pruned []*Story
	for i := range maxStoredFailures + 2 {
		s := saveStory(t, ctx, st, user, fmt.Sprintf("failed %d", i), false)
		if i < 2 { // the two oldest of the batch are the ones that must go
			pruned = append(pruned, s)
		}
	}
	var failedRows, validatedRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM stories WHERE user_id = $1 AND NOT validated`, user).Scan(&failedRows); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM stories WHERE user_id = $1 AND validated`, user).Scan(&validatedRows); err != nil {
		t.Fatal(err)
	}
	if failedRows != maxStoredFailures {
		t.Fatalf("stored failures = %d, want the newest %d", failedRows, maxStoredFailures)
	}
	if validatedRows != 1 { // the one validated story is untouched by pruning
		t.Fatalf("validated rows = %d, want 1 (pruning must not touch them)", validatedRows)
	}
	for _, s := range pruned {
		if _, err := st.Get(ctx, s.ID, user); err != ErrNotFound {
			t.Fatalf("pruned story %v still readable: %v", s.ID, err)
		}
		var kids int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM story_sentences WHERE story_id = $1`, s.ID).Scan(&kids); err != nil {
			t.Fatal(err)
		}
		if kids != 0 {
			t.Fatalf("pruned story %v left %d sentence rows behind", s.ID, kids)
		}
	}
	// Another user's failures are none of this user's business.
	other := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, other, other.String()); err != nil {
		t.Fatalf("seed other user: %v", err)
	}
	saveStory(t, ctx, st, other, "their failure", false)
	if _, failed, err := st.LastFailedAt(ctx, other); err != nil || !failed {
		t.Fatalf("other user's failure: failed=%v err=%v, want true", failed, err)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM stories WHERE user_id = $1 AND NOT validated`, user).Scan(&failedRows); err != nil {
		t.Fatal(err)
	}
	if failedRows != maxStoredFailures {
		t.Fatalf("stored failures after another user saved one = %d, want %d", failedRows, maxStoredFailures)
	}
}

// saveStory writes a minimal Story with the given genre and validated flag.
func saveStory(t *testing.T, ctx context.Context, st *PostgresStore, userID uuid.UUID, genre string, validated bool) *Story {
	t.Helper()
	s := &Story{
		UserID: userID,
		Genre:  genre,
		Prompt: "p",
		Text:   "ました。",
		Sentences: []Sentence{{
			Pos: 0, JA: "ました。", EN: "past.",
			Tokens: []Token{{Pos: 0, Surface: "しました", Start: 0, End: 4, Tag: TagUnknown}},
		}},
		Questions: []Question{
			{Pos: 0, PromptJA: "q", OptionsJA: []string{"a", "b"}, AnswerIndex: 0},
			{Pos: 1, PromptJA: "q", OptionsJA: []string{"a", "b"}, AnswerIndex: 0},
			{Pos: 2, PromptJA: "q", OptionsJA: []string{"a", "b"}, AnswerIndex: 0},
		},
		Validated: validated,
		Attempts:  1,
	}
	if err := st.Save(ctx, s); err != nil {
		t.Fatalf("save %s: %v", genre, err)
	}
	return s
}

func ids(stories []*Story) []uuid.UUID {
	out := make([]uuid.UUID, len(stories))
	for i, s := range stories {
		out[i] = s.ID
	}
	return out
}

func ptr[T any](v T) *T { return &v }
