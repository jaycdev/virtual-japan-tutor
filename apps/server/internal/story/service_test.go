package story

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
)

// Service-level tests run the real Generator against an httptest provider
// speaking the OpenAI-compatible protocol — never a live AI provider — and
// an in-memory Store.

// --- fake provider (scripted completions, recorded requests) ---

type fakeProvider struct {
	server *httptest.Server

	mu     sync.Mutex
	script []string // assistant content per call; repeats the last when exhausted
	calls  int
	msgs   [][]llm.Message
}

func newFakeProvider(t *testing.T, script ...string) *fakeProvider {
	t.Helper()
	f := &fakeProvider{script: script}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Model    string        `json:"model"`
			Messages []llm.Message `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, `{"error":{"message":"fake provider got invalid JSON"}}`, http.StatusBadRequest)
			return
		}
		f.mu.Lock()
		idx := f.calls
		f.calls++
		f.msgs = append(f.msgs, body.Messages)
		content := ""
		if idx < len(f.script) {
			content = f.script[idx]
		} else if len(f.script) > 0 {
			content = f.script[len(f.script)-1]
		}
		f.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model": body.Model,
			"choices": []any{map[string]any{
				"index":         0,
				"message":       map[string]any{"role": "assistant", "content": content},
				"finish_reason": "stop",
			}},
		})
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeProvider) client(t *testing.T) *llm.Client {
	t.Helper()
	c, err := llm.New(llm.Config{BaseURL: f.server.URL, Model: "test-model", APIKey: "fake-key"},
		llm.WithMaxAttempts(1), llm.WithTimeout(15*time.Second))
	if err != nil {
		t.Fatalf("llm.New: %v", err)
	}
	return c
}

func (f *fakeProvider) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func (f *fakeProvider) lastUserPrompt() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var parts []string
	for _, m := range f.msgs[len(f.msgs)-1] {
		if m.Role == llm.RoleUser {
			parts = append(parts, m.Content)
		}
	}
	return strings.Join(parts, "\n")
}

// --- fake resolver ---

type fakeResolver struct{ client *llm.Client }

func (r fakeResolver) ResolveProvider(_ context.Context, _ uuid.UUID, task aiprovider.Task) (aiprovider.Resolved, error) {
	if task != aiprovider.TaskStory || r.client == nil {
		return aiprovider.Resolved{}, aiprovider.ErrNotAssigned
	}
	return aiprovider.Resolved{Client: r.client}, nil
}

// --- fake focus ---

type fakeFocus struct {
	set   FocusSet
	known map[int64]KnownView
}

func (f *fakeFocus) FocusFor(_ context.Context, _ uuid.UUID) (FocusSet, error) { return f.set, nil }

func (f *fakeFocus) KnownVocab(_ context.Context, _ uuid.UUID, seqs []int64) (map[int64]KnownView, error) {
	out := map[int64]KnownView{}
	for _, s := range seqs {
		if v, ok := f.known[s]; ok {
			out[s] = v
		}
	}
	return out, nil
}

func (f *fakeFocus) KnownWords(_ context.Context, _ uuid.UUID, _ int) ([]VocabFocus, error) {
	return f.set.Vocab, nil
}

func (f *fakeFocus) SnapshotKeys(fs FocusSet) []string {
	keys := make([]string, 0, len(fs.Vocab)+len(fs.Grammar))
	for _, v := range fs.Vocab {
		keys = append(keys, "vocabulary:"+strconv.FormatInt(v.EntSeq, 10))
	}
	for _, g := range fs.Grammar {
		keys = append(keys, "grammar:"+strconv.FormatInt(g.PointID, 10))
	}
	return keys
}

// --- fake store ---

type fakeStore struct {
	mu        sync.Mutex
	stories   map[uuid.UUID]*Story
	users     map[uuid.UUID]bool
	threshold map[uuid.UUID]int
	snapshots map[uuid.UUID][]string
	now       time.Time
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		stories:   map[uuid.UUID]*Story{},
		users:     map[uuid.UUID]bool{},
		threshold: map[uuid.UUID]int{},
		snapshots: map[uuid.UUID][]string{},
		now:       time.Unix(1700000000, 0).UTC(),
	}
}

func (s *fakeStore) Save(_ context.Context, st *Story) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st.ID == uuid.Nil {
		st.ID = uuid.New()
	}
	s.now = s.now.Add(time.Second)
	st.CreatedAt = s.now
	s.stories[st.ID] = st
	s.users[st.UserID] = true
	return nil
}

func (s *fakeStore) get(id, userID uuid.UUID) (*Story, error) {
	st, ok := s.stories[id]
	if !ok || st.UserID != userID {
		return nil, ErrNotFound
	}
	return st, nil
}

func (s *fakeStore) Get(_ context.Context, id, userID uuid.UUID) (*Story, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.get(id, userID)
}

func (s *fakeStore) List(_ context.Context, userID uuid.UUID, limit, offset int) ([]*Story, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var mine []*Story
	for _, st := range s.stories {
		if st.UserID == userID && st.Validated {
			mine = append(mine, st)
		}
	}
	sortByCreatedDesc(mine)
	total := len(mine)
	if offset >= total {
		return nil, total, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return mine[offset:end], total, nil
}

func sortByCreatedDesc(xs []*Story) {
	for i := 1; i < len(xs); i++ {
		for j := i; j > 0 && xs[j].CreatedAt.After(xs[j-1].CreatedAt); j-- {
			xs[j], xs[j-1] = xs[j-1], xs[j]
		}
	}
}

func (s *fakeStore) Rate(_ context.Context, id, userID uuid.UUID, r Rating) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.get(id, userID)
	if err != nil {
		return err
	}
	st.Rating = &r
	return nil
}

func (s *fakeStore) RatingCounts(_ context.Context, userID uuid.UUID) (map[string]map[Rating]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]map[Rating]int{}
	for _, st := range s.stories {
		if st.UserID != userID || st.Rating == nil {
			continue
		}
		if out[st.Genre] == nil {
			out[st.Genre] = map[Rating]int{}
		}
		out[st.Genre][*st.Rating]++
	}
	return out, nil
}

func (s *fakeStore) ReadyStoryID(_ context.Context, userID uuid.UUID) (uuid.UUID, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, st := range s.stories {
		if st.UserID == userID && st.ReadyAt != nil {
			return st.ID, true, nil
		}
	}
	return uuid.Nil, false, nil
}

func (s *fakeStore) SetReady(_ context.Context, id, userID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.get(id, userID)
	if err != nil {
		return err
	}
	now := time.Now()
	for _, other := range s.stories {
		if other.UserID == userID {
			other.ReadyAt = nil
		}
	}
	st.ReadyAt = &now
	return nil
}

func (s *fakeStore) ClearReady(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st, ok := s.stories[id]; ok {
		st.ReadyAt = nil
	}
	return nil
}

func (s *fakeStore) GenresByLastActivity(_ context.Context, userID uuid.UUID, limit int) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var mine []*Story
	for _, st := range s.stories {
		if st.UserID == userID {
			mine = append(mine, st)
		}
	}
	sortByCreatedDesc(mine)
	var out []string
	for _, st := range mine {
		if len(out) >= limit {
			break
		}
		out = append(out, st.Genre)
	}
	return out, nil
}

func (s *fakeStore) FuriganaThreshold(_ context.Context, userID uuid.UUID) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.threshold[userID]; ok {
		return v, nil
	}
	return 3, nil
}

func (s *fakeStore) SetFuriganaThreshold(_ context.Context, userID uuid.UUID, level int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.threshold[userID] = level
	return nil
}

func (s *fakeStore) FocusSnapshot(_ context.Context, userID uuid.UUID) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshots[userID], nil
}

func (s *fakeStore) SetFocusSnapshot(_ context.Context, userID uuid.UUID, keys []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshots[userID] = keys
	return nil
}

func (s *fakeStore) MarkPracticed(_ context.Context, id uuid.UUID, at time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.stories[id]
	if !ok {
		return false, ErrNotFound
	}
	if st.PracticedAt != nil {
		return false, nil
	}
	st.PracticedAt = &at
	return true, nil
}

func (s *fakeStore) UserIDs(_ context.Context) ([]uuid.UUID, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []uuid.UUID
	for u := range s.users {
		out = append(out, u)
	}
	return out, nil
}

// --- results spy ---

var _ practice.ResultWriter = (*resultsSpy)(nil)

type resultsSpy struct {
	calls []practiceCall
}

type practiceCall struct {
	UserID  uuid.UUID
	Item    mastery.ItemKey
	Correct bool
}

func (r *resultsSpy) AppendResult(_ context.Context, userID uuid.UUID, item mastery.ItemKey, correct bool, _ time.Time) error {
	r.calls = append(r.calls, practiceCall{UserID: userID, Item: item, Correct: correct})
	return nil
}

// --- wiring helper ---

func newTestService(t *testing.T, provider *fakeProvider) (*Service, *fakeStore, *fakeFocus, *resultsSpy) {
	t.Helper()
	store := newFakeStore()
	focus := &fakeFocus{
		set:   FocusSet{Vocab: []VocabFocus{{EntSeq: 1, JA: "ねこ", EN: "cat", SRSLevel: 5}}},
		known: map[int64]KnownView{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}},
	}
	gen := NewGenerator(cleanLookup())
	var resolve Resolver = fakeResolver{}
	if provider != nil {
		resolve = fakeResolver{client: provider.client(t)}
	}
	results := &resultsSpy{}
	svc := NewService(store, gen, focus, resolve, results, Settings{MaxAttempts: 1}, nil)
	return svc, store, focus, results
}

// --- tests ---

func TestEnsureReadyGeneratesOnceUntilFocusChanges(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, focus, _ := newTestService(t, provider)

	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}
	id, ready, err := store.ReadyStoryID(ctx, user)
	if err != nil || !ready {
		t.Fatalf("want a ready story, ready=%v err=%v", ready, err)
	}
	st := store.stories[id]
	if !st.Validated || st.Attempts != 1 {
		t.Fatalf("story validated=%v attempts=%d, want validated on the first try", st.Validated, st.Attempts)
	}
	// The prompt carried the Focus Set and Known Items (issue #10).
	prompt := provider.lastUserPrompt()
	if !strings.Contains(prompt, "ねこ") {
		t.Fatal("prompt missing the focus word")
	}

	// Unchanged Focus Set: the cheap snapshot check must skip the provider.
	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady (unchanged): %v", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d after an unchanged sweep, want 1 (significance rule)", provider.callCount())
	}

	// A significant Focus Set change (2 of 3 members new, over the 1/3 rule)
	// re-arms generation, and the older story loses its ready flag — always
	// exactly one ready story.
	focus.set.Vocab = []VocabFocus{{EntSeq: 1}, {EntSeq: 2}, {EntSeq: 3}}
	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady (changed focus): %v", err)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d, want regeneration after a significant focus change", provider.callCount())
	}
	var readyCount int
	for _, st := range store.stories {
		if st.UserID == user && st.ReadyAt != nil {
			readyCount++
		}
	}
	if readyCount != 1 {
		t.Fatalf("ready stories = %d, want exactly 1", readyCount)
	}
}

func TestEnsureReadySkipsEmptyFocusSet(t *testing.T) {
	provider := newFakeProvider(t, "{}")
	svc, _, focus, _ := newTestService(t, provider)
	focus.set = FocusSet{}
	if err := svc.EnsureReady(context.Background(), uuid.New()); err != nil {
		t.Fatalf("EnsureReady (empty focus): %v", err)
	}
	if provider.callCount() != 0 {
		t.Fatal("an empty Focus Set must not spend a provider call")
	}
}

func TestEnsureReadyNoProvider(t *testing.T) {
	svc, _, _, _ := newTestService(t, nil) // resolver answers ErrNotAssigned
	if err := svc.EnsureReady(context.Background(), uuid.New()); !errors.Is(err, aiprovider.ErrNotAssigned) {
		t.Fatalf("EnsureReady err = %v, want ErrNotAssigned", err)
	}
}

func TestEnsureReadyFailureStoredNotReady(t *testing.T) {
	// Failed-story policy: the last candidate is stored with its counts but
	// never becomes the ready story.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", dirtyClause, dirtyClause, dirtyClause, dirtyClause)))
	svc, store, _, _ := newTestService(t, provider)

	if err := svc.EnsureReady(ctx, user); err == nil {
		t.Fatal("want the gate's rejection surfaced as an error")
	}
	if _, ready, _ := store.ReadyStoryID(ctx, user); ready {
		t.Fatal("a failed story must never become the ready story")
	}
	var stored *Story
	for _, st := range store.stories {
		stored = st
	}
	if stored == nil || stored.Validated || stored.ContentWords == 0 || stored.Attempts != 1 {
		t.Fatalf("failed story not stored with its gate counts: %+v", stored)
	}
}

func TestOpenReadyIsInstantAndConsumes(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	before := provider.callCount()

	st, err := svc.OpenReady(ctx, user)
	if err != nil {
		t.Fatalf("OpenReady: %v", err)
	}
	if st == nil || st.Genre != "travel" {
		t.Fatalf("OpenReady returned %+v", st)
	}
	if provider.callCount() != before {
		t.Fatal("OpenReady must serve from storage, never the provider — that is the instant-open rule")
	}
	if _, ready, _ := store.ReadyStoryID(ctx, user); ready {
		t.Fatal("opening the ready story must clear the ready flag")
	}
	if _, err := svc.OpenReady(ctx, user); !errors.Is(err, ErrNoReadyStory) {
		t.Fatalf("second OpenReady err = %v, want ErrNoReadyStory", err)
	}
}

func TestAnswerWritesPracticeOnceForFocusItems(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	svc, store, _, results := newTestService(t, nil)

	lvl := 5
	st := &Story{
		UserID: user, Genre: "travel", Validated: true,
		Questions:  []Question{{Pos: 0, PromptJA: "q", OptionsJA: []string{"a", "b"}, AnswerIndex: 1}},
		VocabItems: []VocabItem{{EntSeq: 1, IsFocus: true, IsKnown: true}, {EntSeq: 2, IsFocus: false, IsKnown: true}},
		Sentences:  []Sentence{{Pos: 0, JA: "ねこ", EN: "cat", Tokens: []Token{{Pos: 0, Surface: "ねこ", Tag: TagKnown, SRSLevel: &lvl}}}},
	}
	if err := store.Save(ctx, st); err != nil {
		t.Fatalf("Save: %v", err)
	}

	res, err := svc.Answer(ctx, st.ID, user, 0, 1) // the correct option
	if err != nil {
		t.Fatalf("Answer: %v", err)
	}
	if !res.Correct || !res.PracticeRecorded {
		t.Fatalf("first answer: correct=%v recorded=%v, want both true", res.Correct, res.PracticeRecorded)
	}
	if len(results.calls) != 1 {
		t.Fatalf("practice rows = %d, want exactly 1 (focus items only)", len(results.calls))
	}
	c := results.calls[0]
	if c.Item != (mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1"}) || !c.Correct {
		t.Fatalf("practice row = %+v, want vocabulary:1 correct", c)
	}

	// At most once ever: a second answer grades but writes nothing new.
	res2, err := svc.Answer(ctx, st.ID, user, 0, 0)
	if err != nil {
		t.Fatalf("Answer (second): %v", err)
	}
	if res2.Correct || res2.PracticeRecorded {
		t.Fatalf("second answer: correct=%v recorded=%v, want grading only", res2.Correct, res2.PracticeRecorded)
	}
	if len(results.calls) != 1 {
		t.Fatalf("practice rows = %d after a second answer, want still 1", len(results.calls))
	}

	if _, err := svc.Answer(ctx, st.ID, user, 9, 0); err == nil {
		t.Fatal("out-of-range question index must be an error")
	}
	if _, err := svc.Answer(ctx, st.ID, uuid.New(), 0, 0); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign user Answer err = %v, want ErrNotFound", err)
	}
}

func TestStorySettingsRoundTrip(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	svc, _, _, _ := newTestService(t, nil)

	us, err := svc.GetSettings(ctx, user)
	if err != nil {
		t.Fatalf("GetSettings: %v", err)
	}
	if us.FuriganaThresholdSRSLevel != 3 {
		t.Fatalf("default threshold = %d, want 3", us.FuriganaThresholdSRSLevel)
	}
	us, err = svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 7})
	if err != nil {
		t.Fatalf("PutSettings: %v", err)
	}
	if us.FuriganaThresholdSRSLevel != 7 {
		t.Fatalf("threshold after PutSettings = %d, want 7", us.FuriganaThresholdSRSLevel)
	}
	if _, err := svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 10}); err == nil {
		t.Fatal("threshold above the mastery scale must be rejected")
	}
}
