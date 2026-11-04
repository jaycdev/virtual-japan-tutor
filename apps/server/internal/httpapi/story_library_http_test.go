package httpapi_test

// HTTP tests for issue #31: the Story Library fields riding on the existing
// list/get views (title, title translation, theme, Story Origin, Read mark),
// plus the endpoints a Library row drives — set Read, unset Read, delete.
// The story service runs over storytest.MemStore, seeded directly: these
// tests are about the view and the library endpoints, not generation.

import (
	"context"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story/storytest"
)

type libraryEnv struct {
	e       env
	store   *storytest.MemStore
	aliceID uuid.UUID
}

func newLibraryEnv(t *testing.T) *libraryEnv {
	t.Helper()
	clock := authtest.NewFakeClock()
	authSvc := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour, Now: clock.Now, PasswordParams: authtest.FastPasswordParams})
	var aliceID uuid.UUID
	for _, name := range []string{"alice", "bob"} {
		u, err := authSvc.CreateUser(context.Background(), name, password)
		if err != nil {
			t.Fatal(err)
		}
		if name == "alice" {
			aliceID = u.ID
		}
	}
	store := storytest.New()
	svc := story.NewService(store, nil, nil, nil, nil, story.Settings{}, nil)
	return &libraryEnv{
		e:       env{h: httpapi.New(fakeDB{}, authSvc, httpapi.WithStory(svc)), svc: authSvc, clock: clock},
		store:   store,
		aliceID: aliceID,
	}
}

func (o *libraryEnv) as(t *testing.T, user, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	return o.e.do(t, method, path, "Bearer "+o.e.login(t, user), body)
}

// seedStory stores a finished, validated story and returns its id.
func (o *libraryEnv) seedStory(t *testing.T, userID uuid.UUID, st *story.Story) uuid.UUID {
	t.Helper()
	st.ID = uuid.New()
	st.UserID = userID
	st.Validated = true
	if st.CreatedAt.IsZero() {
		st.CreatedAt = time.Now().UTC().Truncate(time.Millisecond)
	}
	if err := o.store.Save(context.Background(), st); err != nil {
		t.Fatalf("seed story: %v", err)
	}
	return st.ID
}

func (o *libraryEnv) stored(t *testing.T, storyID, userID uuid.UUID) *story.Story {
	t.Helper()
	st, err := o.store.Get(context.Background(), storyID, userID)
	if err != nil {
		t.Fatalf("stored story: %v", err)
	}
	return st
}

// libStoryFields decodes just the issue #31 fields from a story view.
type libStoryFields struct {
	ID      string     `json:"id"`
	Title   string     `json:"title"`
	TitleEn *string    `json:"titleEn"`
	Theme   *string    `json:"theme"`
	Origin  string     `json:"origin"`
	ReadAt  *time.Time `json:"readAt"`
	Rating  *string    `json:"rating"`
}

type libStoryPage struct {
	Items []libStoryFields `json:"items"`
	Total int              `json:"total"`
}

func libFields(t *testing.T, rec *httptest.ResponseRecorder) libStoryFields {
	t.Helper()
	var got libStoryFields
	mustJSON(t, rec, &got)
	return got
}

func libPage(t *testing.T, rec *httptest.ResponseRecorder) libStoryPage {
	t.Helper()
	var got libStoryPage
	mustJSON(t, rec, &got)
	return got
}

// The list and get views carry the library fields: a story's title, its
// translation, its theme, its Story Origin - and no Read mark while it is
// unread, because new stories start unread.
func TestLibraryFieldsInListViewAndGet(t *testing.T) {
	o := newLibraryEnv(t)
	storyID := o.seedStory(t, o.aliceID, &story.Story{
		Genre:     "slice_of_life",
		Title:     "朝の喫茶店",
		TitleEN:   "The Morning Café",
		Theme:     "a quiet morning before work",
		Origin:    story.OriginAutomatic,
		Text:      "朝の喫茶店は静かでした。",
		Sentences: []story.Sentence{{Pos: 0, JA: "朝の喫茶店は静かでした。", EN: "The morning café was quiet."}},
		Questions: []story.Question{
			{Pos: 0, PromptJA: "どこでしたか。", OptionsJA: []string{"喫茶店", "公園"}, AnswerIndex: 0},
			{Pos: 1, PromptJA: "どんな感じでしたか。", OptionsJA: []string{"静か", "にぎやか"}, AnswerIndex: 0},
		},
	})

	rec := o.as(t, "alice", "GET", "/stories?limit=20&offset=0", nil)
	if rec.Code != 200 {
		t.Fatalf("list: got %d body %s", rec.Code, rec.Body.String())
	}
	page := libPage(t, rec)
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("list size: %+v", page)
	}
	got := page.Items[0]
	if got.ID != storyID.String() {
		t.Fatalf("list id: got %q want %s", got.ID, storyID)
	}
	if got.Title != "朝の喫茶店" {
		t.Errorf("list title: got %q", got.Title)
	}
	if got.TitleEn == nil || *got.TitleEn != "The Morning Café" {
		t.Errorf("list titleEn: got %v", got.TitleEn)
	}
	if got.Theme == nil || *got.Theme != "a quiet morning before work" {
		t.Errorf("list theme: got %v", got.Theme)
	}
	if got.Origin != "automatic" {
		t.Errorf("list origin: got %q want automatic", got.Origin)
	}
	if got.ReadAt != nil {
		t.Errorf("list readAt on a new story: got %v, want null (new stories are unread)", *got.ReadAt)
	}

	rec = o.as(t, "alice", "GET", "/stories/"+storyID.String(), nil)
	if rec.Code != 200 {
		t.Fatalf("get: got %d body %s", rec.Code, rec.Body.String())
	}
	got = libFields(t, rec)
	if got.Title != "朝の喫茶店" || got.Origin != "automatic" || got.ReadAt != nil {
		t.Errorf("get fields: %+v", got)
	}
}

// An on-demand story's origin reaches the API as on_demand.
func TestLibraryOriginOnDemand(t *testing.T) {
	o := newLibraryEnv(t)
	o.seedStory(t, o.aliceID, &story.Story{
		Genre:     "children",
		Title:     "星の提灯",
		Theme:     "the lost cat",
		Origin:    story.OriginOnDemand,
		Text:      "星の提灯が光りました。",
		Sentences: []story.Sentence{{Pos: 0, JA: "星の提灯が光りました。"}},
	})

	rec := o.as(t, "alice", "GET", "/stories?limit=20&offset=0", nil)
	if rec.Code != 200 {
		t.Fatalf("list: got %d body %s", rec.Code, rec.Body.String())
	}
	page := libPage(t, rec)
	if len(page.Items) != 1 || page.Items[0].Origin != "on_demand" {
		t.Fatalf("on_demand origin not served: %+v", page.Items)
	}
}

// The learner can set and unset the Read mark; setting it by hand leaves the
// last-practised stamp alone.
func TestLibrarySetAndClearRead(t *testing.T) {
	o := newLibraryEnv(t)
	alice := o.aliceID
	practiced := time.Now().UTC().Add(-48 * time.Hour)
	storyID := o.seedStory(t, alice, &story.Story{
		Genre:       "slice_of_life",
		Title:       "雨の日",
		Origin:      story.OriginAutomatic,
		Text:        "雨が降っていました。",
		Sentences:   []story.Sentence{{Pos: 0, JA: "雨が降っていました。"}},
		PracticedAt: &practiced,
	})

	rec := o.as(t, "alice", "PUT", "/stories/"+storyID.String()+"/read", nil)
	if rec.Code != 204 {
		t.Fatalf("set read: got %d body %s", rec.Code, rec.Body.String())
	}
	got := o.stored(t, storyID, alice)
	if !got.Read() || got.ReadAt == nil {
		t.Fatalf("set read did not persist: ReadAt %v", got.ReadAt)
	}
	if got.PracticedAt == nil || !got.PracticedAt.Equal(practiced) {
		t.Errorf("setting Read must not touch when the learner last practised: got %v", got.PracticedAt)
	}

	rec = o.as(t, "alice", "GET", "/stories/"+storyID.String(), nil)
	if rec.Code != 200 {
		t.Fatalf("get after set read: got %d", rec.Code)
	}
	if v := libFields(t, rec); v.ReadAt == nil {
		t.Fatalf("readAt null after setting Read")
	}

	rec = o.as(t, "alice", "DELETE", "/stories/"+storyID.String()+"/read", nil)
	if rec.Code != 204 {
		t.Fatalf("clear read: got %d body %s", rec.Code, rec.Body.String())
	}
	if stored := o.stored(t, storyID, alice); stored.Read() {
		t.Fatalf("clear read did not persist: ReadAt %v", stored.ReadAt)
	}
	rec = o.as(t, "alice", "GET", "/stories/"+storyID.String(), nil)
	if v := libFields(t, rec); v.ReadAt != nil {
		t.Errorf("readAt still served after clearing Read: %v", *v.ReadAt)
	}
}

// Answering the last comprehension question marks the story Read; answering
// an earlier one does not.
func TestLibraryLastAnswerMarksRead(t *testing.T) {
	o := newLibraryEnv(t)
	alice := o.aliceID
	storyID := o.seedStory(t, alice, &story.Story{
		Genre:     "slice_of_life",
		Title:     "朝の喫茶店",
		Origin:    story.OriginAutomatic,
		Text:      "朝の喫茶店は静かでした。",
		Sentences: []story.Sentence{{Pos: 0, JA: "朝の喫茶店は静かでした。"}},
		Questions: []story.Question{
			{Pos: 0, PromptJA: "どこでしたか。", OptionsJA: []string{"喫茶店", "公園"}, AnswerIndex: 0},
			{Pos: 1, PromptJA: "どんな感じでしたか。", OptionsJA: []string{"静か", "にぎやか"}, AnswerIndex: 0},
		},
	})

	post := func(qi, ai int) {
		t.Helper()
		rec := o.as(t, "alice", "POST", "/stories/"+storyID.String()+"/answers", map[string]int{
			"questionIndex": qi, "answerIndex": ai,
		})
		if rec.Code != 200 {
			t.Fatalf("answer q%d: got %d body %s", qi, rec.Code, rec.Body.String())
		}
	}

	post(0, 0)
	if got := o.stored(t, storyID, alice); got.Read() {
		t.Errorf("story Read after first of two questions: ReadAt %v", got.ReadAt)
	}

	post(1, 0)
	if got := o.stored(t, storyID, alice); !got.Read() || got.ReadAt == nil {
		t.Errorf("last comprehension question did not mark the story Read: ReadAt %v", got.ReadAt)
	}

	rec := o.as(t, "alice", "GET", "/stories/"+storyID.String(), nil)
	if v := libFields(t, rec); v.ReadAt == nil {
		t.Errorf("readAt null in the view after the last question")
	}
}

// Delete removes the story and its rating from the library; a second delete,
// someone else's story, and a malformed id all read as not found.
func TestLibraryDeleteStory(t *testing.T) {
	o := newLibraryEnv(t)
	alice := o.aliceID
	up := story.RatingUp
	storyID := o.seedStory(t, alice, &story.Story{
		Genre:     "slice_of_life",
		Title:     "消える話",
		Origin:    story.OriginAutomatic,
		Text:      "これは消えます。",
		Sentences: []story.Sentence{{Pos: 0, JA: "これは消えます。"}},
		Rating:    &up,
	})

	rec := o.as(t, "bob", "DELETE", "/stories/"+storyID.String(), nil)
	wantError(t, rec, 404, "not_found")

	rec = o.as(t, "alice", "DELETE", "/stories/"+storyID.String(), nil)
	if rec.Code != 204 {
		t.Fatalf("delete: got %d body %s", rec.Code, rec.Body.String())
	}
	if _, err := o.store.Get(context.Background(), storyID, alice); err == nil {
		t.Errorf("story still in storage after delete")
	}
	rec = o.as(t, "alice", "GET", "/stories/"+storyID.String(), nil)
	wantError(t, rec, 404, "not_found")
	rec = o.as(t, "alice", "DELETE", "/stories/"+storyID.String(), nil)
	wantError(t, rec, 404, "not_found")
	rec = o.as(t, "alice", "DELETE", "/stories/not-a-uuid", nil)
	wantError(t, rec, 404, "not_found")

	rec = o.as(t, "alice", "GET", "/stories?limit=20&offset=0", nil)
	if rec.Code != 200 {
		t.Fatalf("list after delete: got %d", rec.Code)
	}
	page := libPage(t, rec)
	if page.Total != 0 || len(page.Items) != 0 {
		t.Errorf("deleted story still listed: %+v", page)
	}
}

// Set/unset Read on a missing, foreign or malformed story id is a 404 like
// every other story route, and touches nothing.
func TestLibraryReadRoutesNotFound(t *testing.T) {
	o := newLibraryEnv(t)
	alice := o.aliceID
	storyID := o.seedStory(t, alice, &story.Story{
		Genre:     "slice_of_life",
		Title:     "他人の話",
		Origin:    story.OriginAutomatic,
		Text:      "アリスの話。",
		Sentences: []story.Sentence{{Pos: 0, JA: "アリスの話。"}},
	})

	rec := o.as(t, "bob", "PUT", "/stories/"+storyID.String()+"/read", nil)
	wantError(t, rec, 404, "not_found")
	if got := o.stored(t, storyID, alice); got.Read() {
		t.Errorf("foreign PUT /read marked the story Read")
	}
	rec = o.as(t, "bob", "DELETE", "/stories/"+storyID.String()+"/read", nil)
	wantError(t, rec, 404, "not_found")
	rec = o.as(t, "alice", "PUT", "/stories/"+uuid.NewString()+"/read", nil)
	wantError(t, rec, 404, "not_found")
	rec = o.as(t, "alice", "PUT", "/stories/not-a-uuid/read", nil)
	wantError(t, rec, 404, "not_found")
	rec = o.as(t, "alice", "DELETE", "/stories/not-a-uuid/read", nil)
	wantError(t, rec, 404, "not_found")
}
