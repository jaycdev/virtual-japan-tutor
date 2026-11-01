package story

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

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
			Spans: []Span{{Start: 9, End: 13, GrammarPointID: grammarPoint}},
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

	// UserIDs drives the background sweep.
	users, err := st.UserIDs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(users) < 2 {
		t.Errorf("user ids: %v", users)
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
