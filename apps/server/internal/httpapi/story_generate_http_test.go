package httpapi_test

// HTTP tests for issue #33's generation routes: GET /stories/generation
// (the progress poll), POST /stories/generate (the On-demand start, its
// busy 409 and its length validation), and GET /stories/suggestions (the
// autocomplete box's options). The writing itself — pipeline, gate,
// progress windows — is locked at the story package level; here the shape
// of the wire and the status codes are the point.

import (
	"context"
	"net/http"
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

type generateEnv struct {
	e       env
	store   *storytest.MemStore
	svc     *story.Service
	aliceID uuid.UUID
}

// focusStub answers an empty Focus Set — every on-demand run then finishes
// failed with the fit-failure message without ever reaching a provider,
// which is all these wire tests need. block, when set, turns FocusFor into
// a handshake so a test can hold a run mid-flight.
type focusStub struct {
	block chan struct{}
}

func (f *focusStub) FocusFor(_ context.Context, _ uuid.UUID) (story.FocusSet, error) {
	if f.block != nil {
		f.block <- struct{}{}
		<-f.block
	}
	return story.FocusSet{}, nil
}

func (f *focusStub) KnownVocab(_ context.Context, _ uuid.UUID, _ []int64) (map[int64]story.KnownView, error) {
	return nil, nil
}

func (f *focusStub) KnownWords(_ context.Context, _ uuid.UUID, _ int) ([]story.VocabFocus, error) {
	return nil, nil
}

func newGenerateEnv(t *testing.T, focus story.Focus) *generateEnv {
	t.Helper()
	clock := authtest.NewFakeClock()
	authSvc := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour, Now: clock.Now})
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
	svc := story.NewService(store, nil, focus, nil, nil, story.Settings{}, nil)
	return &generateEnv{
		e:       env{h: httpapi.New(fakeDB{}, authSvc, httpapi.WithStory(svc)), svc: authSvc, clock: clock},
		store:   store,
		svc:     svc,
		aliceID: aliceID,
	}
}

func (o *generateEnv) as(t *testing.T, user, method, path string, body any) *httptest.ResponseRecorder {
	t.Helper()
	return o.e.do(t, method, path, "Bearer "+o.e.login(t, user), body)
}

type progressView struct {
	Status      string  `json:"status"`
	Stage       *string `json:"stage"`
	Percent     int     `json:"percent"`
	Message     *string `json:"message"`
	StoryID     *string `json:"storyId"`
	Attempt     *int    `json:"attempt"`
	MaxAttempts *int    `json:"maxAttempts"`
}

type suggestionsView struct {
	Genres []string `json:"genres"`
	Themes []string `json:"themes"`
}

type errView struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

func decodeProgress(t *testing.T, rec *httptest.ResponseRecorder) progressView {
	t.Helper()
	var got progressView
	mustJSON(t, rec, &got)
	return got
}

// The progress poll starts idle, and an On-demand run with nothing to
// build from comes back failed with the ticket's retry line — kept readable
// afterwards, so a client that reloaded mid-run still learns how it ended.
func TestGenerateStoryProgressFlow(t *testing.T) {
	o := newGenerateEnv(t, &focusStub{})

	rec := o.as(t, "alice", "GET", "/stories/generation", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET generation = %d, want 200", rec.Code)
	}
	if p := decodeProgress(t, rec); p.Status != "idle" || p.Percent != 0 || p.StoryID != nil {
		t.Fatalf("idle progress = %+v, want idle/0/no story", p)
	}

	rec = o.as(t, "alice", "POST", "/stories/generate", map[string]any{"genre": "travel"})
	if rec.Code != http.StatusAccepted {
		t.Fatalf("POST generate = %d %s, want 202", rec.Code, rec.Body)
	}
	p := decodeProgress(t, rec)
	if p.Status != "failed" || p.Message == nil || *p.Message != story.FitFailureMessage {
		t.Fatalf("failed run = %+v, want the fit-failure message", p)
	}

	rec = o.as(t, "alice", "GET", "/stories/generation", nil)
	if p2 := decodeProgress(t, rec); p2.Status != "failed" || p2.Message == nil || *p2.Message != story.FitFailureMessage {
		t.Fatalf("terminal state after the run = %+v, want it still readable", p2)
	}
}

// One generation per Learner: while a run holds the slot, a second start
// answers the MaruMori sync_running shape — 409 generation_running.
func TestGenerateStoryBusyConflict(t *testing.T) {
	busy := make(chan struct{})
	o := newGenerateEnv(t, &focusStub{block: busy})

	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() {
		rec := o.as(t, "alice", "POST", "/stories/generate", map[string]any{})
		firstDone <- rec
	}()
	<-busy // alice's run is now in flight

	rec := o.as(t, "alice", "POST", "/stories/generate", map[string]any{"genre": "history"})
	if rec.Code != http.StatusConflict {
		t.Fatalf("second start = %d %s, want 409", rec.Code, rec.Body)
	}
	var e errView
	mustJSON(t, rec, &e)
	if e.Code != "generation_running" {
		t.Errorf("conflict code = %q, want generation_running", e.Code)
	}

	close(busy) // let the first run finish
	if first := <-firstDone; first.Code != http.StatusAccepted {
		t.Errorf("first start = %d %s, want 202", first.Code, first.Body)
	}
}

// The Generate box's free text is capped, not trusted: an overlong genre
// or theme is a 400 before any run starts.
func TestGenerateStoryValidatesInputLengths(t *testing.T) {
	o := newGenerateEnv(t, &focusStub{})
	long := make([]byte, 0)
	for range 61 {
		long = append(long, 'g')
	}
	rec := o.as(t, "alice", "POST", "/stories/generate", map[string]any{"genre": string(long)})
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("overlong genre = %d %s, want 400", rec.Code, rec.Body)
	}
	var e errView
	mustJSON(t, rec, &e)
	if e.Code != "invalid_input" {
		t.Errorf("code = %q, want invalid_input", e.Code)
	}
}

// The suggestions endpoint offers the preset genres plus the Learner's own
// validated history — and the routes are authenticated by default.
func TestStorySuggestionsAndAuth(t *testing.T) {
	o := newGenerateEnv(t, &focusStub{})
	ctx := context.Background()
	seed := func(st *story.Story) {
		st.UserID = o.aliceID
		if err := o.store.Save(ctx, st); err != nil { // MemStore stamps CreatedAt, oldest-first per call
			t.Fatalf("seed: %v", err)
		}
	}
	seed(&story.Story{Genre: "travel", Theme: "a night train", Validated: true, Text: "x",
		Sentences: []story.Sentence{{Pos: 0, JA: "x", EN: "x"}}})
	seed(&story.Story{Genre: "cyberpunk", Theme: "a robot running a ramen shop", Validated: true, Origin: story.OriginOnDemand, Text: "x",
		Sentences: []story.Sentence{{Pos: 0, JA: "x", EN: "x"}}})
	seed(&story.Story{Genre: "secret", Theme: "private", Validated: false, Text: "x",
		Sentences: []story.Sentence{{Pos: 0, JA: "x", EN: "x"}}})

	rec := o.as(t, "alice", "GET", "/stories/suggestions", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET suggestions = %d, want 200", rec.Code)
	}
	var got suggestionsView
	mustJSON(t, rec, &got)
	has := func(xs []string, want string) bool {
		for _, x := range xs {
			if x == want {
				return true
			}
		}
		return false
	}
	if !has(got.Genres, "mystery") { // a preset genre
		t.Errorf("genres = %v, want the presets included", got.Genres)
	}
	if !has(got.Genres, "cyberpunk") || !has(got.Genres, "travel") {
		t.Errorf("genres = %v, want the Learner's history", got.Genres)
	}
	if has(got.Genres, "secret") || has(got.Themes, "private") {
		t.Errorf("suggestions = %+v, a gate-failed Story must not appear", got)
	}
	if !has(got.Themes, "a night train") {
		t.Errorf("themes = %v, want the Learner's themes", got.Themes)
	}

	// Authenticated by default: every new route answers 401 without a session.
	for _, r := range []struct{ method, path string }{
		{"GET", "/stories/generation"},
		{"POST", "/stories/generate"},
		{"GET", "/stories/suggestions"},
	} {
		if rec := o.e.do(t, r.method, r.path, "", nil); rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s without auth = %d, want 401", r.method, r.path, rec.Code)
		}
	}
}
