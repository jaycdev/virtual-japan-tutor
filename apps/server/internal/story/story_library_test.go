package story

// Ticket #31 — the library fields every Story carries: a model-written
// Title (with its English translation), the Theme it was written on, its
// Origin (Automatic vs On-demand), and the Read mark recording when the
// Learner finished it. Generation stamps the first three; answering the
// last comprehension question sets the fourth.

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// fixtureWithLibrary is the fixture generator with the ticket's three model
// fields filled in ("" leaves a field out of the JSON entirely).
func fixtureWithLibrary(t *testing.T, title, titleEN, theme string, clauses ...string) []byte {
	t.Helper()
	out := struct {
		Title     string  `json:"title,omitempty"`
		TitleEN   string  `json:"title_en,omitempty"`
		Theme     string  `json:"theme,omitempty"`
		Genre     string  `json:"genre"`
		Sentences []fSent `json:"sentences"`
		Questions []fQ    `json:"questions"`
	}{Genre: "travel", Title: title, TitleEN: titleEN, Theme: theme}
	for _, c := range clauses {
		out.Sentences = append(out.Sentences, fSent{JA: sentence(12, c), EN: "The cat found it."})
	}
	for i := 0; i < 3; i++ {
		out.Questions = append(out.Questions, fQ{PromptJA: "ねこは何を見つけましたか。", OptionsJA: []string{"ねこ", "ほん"}, AnswerIdx: 0})
	}
	b, err := json.Marshal(out)
	if err != nil {
		t.Fatalf("fixtureWithLibrary: %v", err)
	}
	return b
}

func libraryRequest() Request {
	req := baseRequest()
	req.Settings.MaxAttempts = 1
	req.Known = fakeKnown{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}
	return req
}

func generateOne(t *testing.T, reply []byte, req Request) *Story {
	t.Helper()
	client := &fakeChat{responses: [][]byte{reply}}
	gen := NewGenerator(cleanLookup())
	st, err := gen.Generate(context.Background(), client, req)
	if err != nil {
		t.Fatalf("Generate: %v", err)
	}
	return st
}

// ---- Title, Theme, Origin stamped at generation -------------------------

func TestGenerateCarriesLibraryFieldsFromTheModel(t *testing.T) {
	req := libraryRequest()
	st := generateOne(t,
		fixtureWithLibrary(t, "ねこの一日", "A Day of Cats", "A Stray Cat",
			cleanClause, cleanClause, cleanClause, cleanClause),
		req)
	if st.Title != "ねこの一日" {
		t.Errorf("Title = %q, want the model's title", st.Title)
	}
	if st.TitleEN != "A Day of Cats" {
		t.Errorf("TitleEN = %q, want the model's translation", st.TitleEN)
	}
	if st.Theme != "A Stray Cat" {
		t.Errorf("Theme = %q, want the theme the model named", st.Theme)
	}
	if st.Origin != OriginAutomatic {
		t.Errorf("Origin = %q, want %q: a plain Generate request is Automatic", st.Origin, OriginAutomatic)
	}
	if st.Read() {
		t.Error("a fresh story has not been read")
	}
}

// The Learner's stored theme preference beats the model's own theme name:
// the Story records the theme it was actually written on.
func TestGenerateStoredThemeBeatsTheModelsTheme(t *testing.T) {
	req := libraryRequest()
	req.Theme = "a night market"
	st := generateOne(t,
		fixtureWithLibrary(t, "夜店", "Night Market", "Something Else",
			cleanClause, cleanClause, cleanClause, cleanClause),
		req)
	if st.Theme != "a night market" {
		t.Errorf("Theme = %q, want the request's stored theme", st.Theme)
	}
}

func TestGenerateStampsOnDemandOrigin(t *testing.T) {
	req := libraryRequest()
	req.Origin = OriginOnDemand
	st := generateOne(t,
		fixtureWithLibrary(t, "ねこ", "Cats", "Cats",
			cleanClause, cleanClause, cleanClause, cleanClause),
		req)
	if st.Origin != OriginOnDemand {
		t.Errorf("Origin = %q, want %q", st.Origin, OriginOnDemand)
	}
}

// A model that ignores the title field must not produce an untitled story:
// the first sentence is the fallback, shortened rather than stored whole.
func TestGenerateFallsBackToATrimmedFirstSentence(t *testing.T) {
	st := generateOne(t,
		fixtureWithLibrary(t, "", "", "", cleanClause, cleanClause, cleanClause, cleanClause),
		libraryRequest())
	want := "ねこはねこをみつけました" // up to the first 。
	if st.Title != want {
		t.Errorf("Title = %q, want the first sentence cut at 。 (%q)", st.Title, want)
	}
}

// fallbackTitle is the fallback rule itself: cut at 。？！, else 40 runes,
// with a space break allowed for latin text when the 40-rune window has one.
func TestFallbackTitle(t *testing.T) {
	cases := []struct {
		text string
		want string
	}{
		{"私は猫です。ずっと気になっていたことがあり", "私は猫です"},
		{"これは何ですか。続き", "これは何ですか"},
		{"ここで会ったが百年目！続き", "ここで会ったが百年目"},
		{strings.Repeat("猫", 80), strings.Repeat("猫", 40)},
		{"the cat sat on the mat and then it got up and stretched", "the cat sat on the mat and then it got u"},
		{"短い", "短い"},
	}
	for _, c := range cases {
		if got := fallbackTitle(c.text); got != c.want {
			t.Errorf("fallbackTitle(%q) = %q, want %q", c.text, got, c.want)
		}
	}
}

// A model title that runs away is trimmed to the label cap, not stored raw.
func TestGenerateTrimsOverlongLibraryFields(t *testing.T) {
	long := strings.Repeat("夢", 100)
	req := libraryRequest()
	req.Theme = strings.Repeat("好", maxPreferredThemeLen+100)
	st := generateOne(t,
		fixtureWithLibrary(t, long, long, long, cleanClause, cleanClause, cleanClause, cleanClause),
		req)
	if st.Title != strings.Repeat("夢", maxLabelRunes) {
		t.Errorf("Title = %q, want it capped at %d runes", st.Title, maxLabelRunes)
	}
	if len([]rune(st.TitleEN)) != maxLabelRunes {
		t.Errorf("TitleEN is %d runes, want it capped at %d", len([]rune(st.TitleEN)), maxLabelRunes)
	}
	if st.Theme != strings.Repeat("好", maxPreferredThemeLen) {
		t.Errorf("Theme = %q, want it capped at %d runes", st.Theme, maxPreferredThemeLen)
	}
}

// ---- Read mark on the last comprehension question -----------------------

func answeredStory(t *testing.T) (*fakeStore, *Service, *Story) {
	t.Helper()
	ctx := context.Background()
	store := newFakeStore()
	st := &Story{
		UserID:    uuid.New(),
		Text:      "ねこはねこをみつけました。",
		Validated: true,
		Sentences: []Sentence{{Pos: 0, JA: "ねこはねこをみつけました。", EN: "The cat found it."}},
		Questions: []Question{{Pos: 0, PromptJA: "q1", OptionsJA: []string{"ねこ", "ほん"}, AnswerIndex: 0}, {Pos: 1, PromptJA: "q2", OptionsJA: []string{"ねこ", "ほん"}, AnswerIndex: 0}, {Pos: 2, PromptJA: "q3", OptionsJA: []string{"ねこ", "ほん"}, AnswerIndex: 0}},
	}
	if err := store.Save(ctx, st); err != nil {
		t.Fatalf("Save: %v", err)
	}
	svc, _, _, _ := newTestServiceOn(t, nil, store)
	return store, svc, st
}

// Answering the last comprehension question marks the story Read; earlier
// questions do not. The Read mark is separate from the Practiced At stamp,
// which the first answer sets.
func TestAnsweringLastQuestionMarksStoryRead(t *testing.T) {
	ctx := context.Background()
	store, svc, st := answeredStory(t)

	var practiced time.Time
	for i := 0; i < 2; i++ {
		if _, err := svc.Answer(ctx, st.ID, st.UserID, i, 0); err != nil {
			t.Fatalf("Answer q%d: %v", i+1, err)
		}
		got, err := store.Get(ctx, st.ID, st.UserID)
		if err != nil {
			t.Fatalf("Get: %v", err)
		}
		if got.Read() {
			t.Errorf("question %d must not mark the story Read", i+1)
		}
		if got.PracticedAt == nil {
			t.Fatal("the first answer must still stamp Practiced At")
		}
		practiced = *got.PracticedAt
	}

	if _, err := svc.Answer(ctx, st.ID, st.UserID, 2, 0); err != nil {
		t.Fatalf("Answer q3: %v", err)
	}
	got, err := store.Get(ctx, st.ID, st.UserID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !got.Read() {
		t.Fatal("answering the last question must mark the story Read")
	}
	if got.ReadAt == nil {
		t.Fatal("ReadAt must record when the story was read")
	}
	if got.PracticedAt == nil || !got.PracticedAt.Equal(practiced) {
		t.Error("the Read mark must leave the earlier Practiced At stamp alone")
	}
}

// ---- Store: read state, delete, and user scoping ------------------------

func TestStoryStoreReadAndDelete(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	at := time.Now().UTC()

	st := &Story{UserID: uuid.New(), Text: "x", Validated: true}
	if err := store.Save(ctx, st); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := store.MarkRead(ctx, st.ID, st.UserID, at); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	got, err := store.Get(ctx, st.ID, st.UserID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if !got.Read() {
		t.Error("MarkRead must set the read mark")
	}
	if got.ReadAt == nil || !got.ReadAt.Equal(at) {
		t.Errorf("ReadAt = %v, want %v", got.ReadAt, at)
	}

	if err := store.ClearRead(ctx, st.ID, st.UserID); err != nil {
		t.Fatalf("ClearRead: %v", err)
	}
	got, err = store.Get(ctx, st.ID, st.UserID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Read() {
		t.Error("ClearRead must unset the read mark")
	}

	if err := store.Delete(ctx, st.ID, st.UserID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, err := store.Get(ctx, st.ID, st.UserID); err != ErrNotFound {
		t.Errorf("Get after Delete: %v, want ErrNotFound", err)
	}
}

func TestStoryStoreReadAndDeleteAreScopedToTheOwner(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()

	st := &Story{UserID: uuid.New(), Text: "x", Validated: true}
	if err := store.Save(ctx, st); err != nil {
		t.Fatalf("Save: %v", err)
	}
	other := uuid.New()

	if err := store.MarkRead(ctx, st.ID, other, time.Now()); err != ErrNotFound {
		t.Errorf("MarkRead for another user: %v, want ErrNotFound", err)
	}
	if err := store.ClearRead(ctx, st.ID, other); err != ErrNotFound {
		t.Errorf("ClearRead for another user: %v, want ErrNotFound", err)
	}
	if err := store.Delete(ctx, st.ID, other); err != ErrNotFound {
		t.Errorf("Delete for another user: %v, want ErrNotFound", err)
	}
	got, err := store.Get(ctx, st.ID, st.UserID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.Read() {
		t.Error("another user's MarkRead attempt must not have touched the story")
	}
}

// ---- Service wrappers ----------------------------------------------------

func TestServiceMarkClearReadAndDelete(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc, _, _, _ := newTestServiceOn(t, nil, store)
	at := time.Now().UTC()

	st := &Story{UserID: uuid.New(), Text: "x", Validated: true}
	if err := store.Save(ctx, st); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if err := svc.MarkRead(ctx, st.ID, st.UserID, at); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if got, err := store.Get(ctx, st.ID, st.UserID); err != nil || !got.Read() {
		t.Errorf("the service must set the read mark (got=%v err=%v)", got, err)
	}
	if err := svc.ClearRead(ctx, st.ID, st.UserID); err != nil {
		t.Fatalf("ClearRead: %v", err)
	}
	if got, err := store.Get(ctx, st.ID, st.UserID); err != nil || got.Read() {
		t.Errorf("the service must unset the read mark (got=%v err=%v)", got, err)
	}
	if err := svc.Delete(ctx, st.ID, st.UserID); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if err := svc.Delete(ctx, st.ID, st.UserID); err != ErrNotFound {
		t.Errorf("second Delete: %v, want ErrNotFound", err)
	}
}

// Deleting Today's Story reveals the older Automatic Story underneath —
// and deleting that leaves none at all, which frees the day for the next
// scheduler pass (issue #32).
func TestDeleteTodaysStoryFallsBackToTheOlderOne(t *testing.T) {
	ctx := context.Background()
	store := newFakeStore()
	svc, _, _, _ := newTestServiceOn(t, nil, store)

	user := uuid.New()
	older := &Story{UserID: user, Text: "x", Validated: true, Origin: OriginAutomatic}
	if err := store.Save(ctx, older); err != nil {
		t.Fatalf("Save (older): %v", err)
	}
	newer := &Story{UserID: user, Text: "y", Validated: true, Origin: OriginAutomatic}
	if err := store.Save(ctx, newer); err != nil {
		t.Fatalf("Save (newer): %v", err)
	}
	got, ok, err := store.LatestAutomaticStory(ctx, user)
	if err != nil || !ok || got.ID != newer.ID {
		t.Fatalf("LatestAutomaticStory = %v/%v/%v, want the newest", got, ok, err)
	}

	if err := svc.Delete(ctx, newer.ID, user); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	got, ok, err = store.LatestAutomaticStory(ctx, user)
	if err != nil || !ok || got.ID != older.ID {
		t.Fatalf("after deleting today's story: %v/%v/%v, want the older one", got, ok, err)
	}

	if err := svc.Delete(ctx, older.ID, user); err != nil {
		t.Fatalf("Delete (older): %v", err)
	}
	if _, ok, err := store.LatestAutomaticStory(ctx, user); err != nil || ok {
		t.Errorf("after deleting every Automatic Story: ok=%v err=%v, want none", ok, err)
	}
}
