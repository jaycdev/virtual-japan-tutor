package story

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
	"unicode/utf8"

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

	// block, when non-nil, turns every completion into a two-phase
	// handshake: the handler sends on it once the request has been recorded,
	// then waits for the reply before answering. Tests use it to hold a
	// generation mid-flight while they exercise concurrent paths.
	block chan struct{}
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

		if f.block != nil {
			f.block <- struct{}{}
			<-f.block
		}
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

// setScript swaps what later calls answer with (the sequence index keeps
// counting), so one test can fail one sweep and succeed at the next.
func (f *fakeProvider) setScript(script ...string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.script = script
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
	blur      map[uuid.UUID]bool      // missing = default true, like the users column
	prefs     map[uuid.UUID][2]string // genre, theme ("" = surprise-me / no theme)
	snapshots map[uuid.UUID][]string
	now       time.Time

	// setReadyConflict makes SetReady answer like the Postgres store when a
	// concurrent generator took the one ready slot first (23505).
	setReadyConflict bool
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		stories:   map[uuid.UUID]*Story{},
		users:     map[uuid.UUID]bool{},
		threshold: map[uuid.UUID]int{},
		blur:      map[uuid.UUID]bool{},
		prefs:     map[uuid.UUID][2]string{},
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
	// Mirror the Postgres store's choke point: stored genres are sanitised
	// labels no matter who built the story.
	st.Genre = sanitizeLabel(st.Genre, maxLabelRunes)
	s.now = s.now.Add(time.Second)
	st.CreatedAt = s.now
	s.stories[st.ID] = st
	s.users[st.UserID] = true
	return nil
}

// advanceNow moves the fake store's clock (it stamps CreatedAt), so a test
// can step past the retry cooldown with the service clock pointed at
// storeNow.
func (s *fakeStore) advanceNow(d time.Duration) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.now = s.now.Add(d)
}

func (s *fakeStore) storeNow() time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.now
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
	if s.setReadyConflict {
		return fmt.Errorf("story set ready: %w", errReadyConflict)
	}
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

// LastFailedAt mirrors the Postgres store's contract: the timestamp counts
// only when the user's newest story failed the gate.
func (s *fakeStore) LastFailedAt(_ context.Context, userID uuid.UUID) (time.Time, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var newest *Story
	for _, st := range s.stories {
		if st.UserID != userID {
			continue
		}
		if newest == nil || st.CreatedAt.After(newest.CreatedAt) {
			newest = st
		}
	}
	if newest == nil || newest.Validated {
		return time.Time{}, false, nil
	}
	return newest.CreatedAt, true, nil
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

func (s *fakeStore) BlurTranslation(_ context.Context, userID uuid.UUID) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.blur[userID]
	if !ok {
		return true, nil // the users column defaults to TRUE
	}
	return v, nil
}

func (s *fakeStore) SetBlurTranslation(_ context.Context, userID uuid.UUID, blur bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blur[userID] = blur
	return nil
}

func (s *fakeStore) StoryPrefs(_ context.Context, userID uuid.UUID) (string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.prefs[userID]
	return p[0], p[1], nil
}

func (s *fakeStore) SetStoryPrefs(_ context.Context, userID uuid.UUID, genre, theme string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prefs[userID] = [2]string{genre, theme}
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

// ResetPracticed mirrors the Postgres store: it clears the claim only when
// it is still exactly the value MarkPracticed set.
func (s *fakeStore) ResetPracticed(_ context.Context, id uuid.UUID, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.stories[id]
	if !ok {
		return ErrNotFound
	}
	if st.PracticedAt != nil && st.PracticedAt.Equal(at) {
		st.PracticedAt = nil
	}
	return nil
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
	// fail, when set, makes AppendResult error — the Practice Record
	// append failure the Answer rollback must recover from.
	fail bool
}

type practiceCall struct {
	UserID  uuid.UUID
	Item    mastery.ItemKey
	Correct bool
}

func (r *resultsSpy) AppendResult(_ context.Context, userID uuid.UUID, item mastery.ItemKey, correct bool, _ time.Time) error {
	if r.fail {
		return errors.New("practice record append failed (test)")
	}
	r.calls = append(r.calls, practiceCall{UserID: userID, Item: item, Correct: correct})
	return nil
}

func (r *resultsSpy) callCount() int { return len(r.calls) }

// --- wiring helper ---

func newTestService(t *testing.T, provider *fakeProvider) (*Service, *fakeStore, *fakeFocus, *resultsSpy) {
	t.Helper()
	return newTestServiceOn(t, provider, newFakeStore())
}

// newTestServiceOn wires a Service over an existing store, so a test can
// hand one service's saved stories to another service (for instance a
// provider-less one, to prove the read path needs no AI provider at all).
func newTestServiceOn(t *testing.T, provider *fakeProvider, store *fakeStore) (*Service, *fakeStore, *fakeFocus, *resultsSpy) {
	t.Helper()
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

func TestEnsureReadyFailureKeepsSnapshotArmed(t *testing.T) {
	// A failed sweep must not advance the significance snapshot: otherwise
	// the new Focus Set is burned by the failure and the generator goes
	// quiet without ever offering a story for it. Only a VALIDATED story
	// retires the snapshot.
	ctx := context.Background()
	user := uuid.New()
	clean := string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause))
	dirty := string(fixture(t, "travel", dirtyClause, dirtyClause, dirtyClause, dirtyClause))
	provider := newFakeProvider(t, clean, dirty, clean)
	svc, store, focus, _ := newTestService(t, provider)

	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady (first): %v", err)
	}
	id1, ready, _ := store.ReadyStoryID(ctx, user)
	if !ready {
		t.Fatal("the first story should be ready")
	}
	snap1, err := store.FocusSnapshot(ctx, user)
	if err != nil {
		t.Fatalf("FocusSnapshot: %v", err)
	}

	// A significant Focus Set change re-arms, and this sweep fails the gate.
	focus.set.Vocab = []VocabFocus{{EntSeq: 1}, {EntSeq: 2}, {EntSeq: 3}}
	if err := svc.EnsureReady(ctx, user); err == nil {
		t.Fatal("want the failed sweep surfaced as an error")
	}
	// The old ready story stays…
	id2, ready, _ := store.ReadyStoryID(ctx, user)
	if !ready || id2 != id1 {
		t.Fatalf("failed sweep disturbed the ready story: id=%v ready=%v", id2, ready)
	}
	// …and the snapshot must NOT have advanced to the new Focus Set.
	snap2, err := store.FocusSnapshot(ctx, user)
	if err != nil {
		t.Fatalf("FocusSnapshot: %v", err)
	}
	if !reflect.DeepEqual(snap2, snap1) {
		t.Fatalf("snapshot advanced to %v after a failed sweep, want %v", snap2, snap1)
	}

	// The next sweep therefore retries the new Focus Set — and succeeds.
	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady (retry): %v", err)
	}
	if provider.callCount() != 3 {
		t.Fatalf("provider calls = %d, want the failed Focus Set retried (3)", provider.callCount())
	}
	id3, ready, _ := store.ReadyStoryID(ctx, user)
	if !ready || id3 == id1 {
		t.Fatalf("the retry produced no new ready story: id=%v ready=%v", id3, ready)
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

	// The read path runs on a provider-less service: if opening a story
	// needed anything but storage it would fail here — that is the
	// instant-open rule. (The post-open regeneration kick gets its own
	// test; with no provider it is a no-op.)
	reader, _, _, _ := newTestServiceOn(t, nil, store)
	st, err := reader.OpenReady(ctx, user)
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
	if _, err := reader.OpenReady(ctx, user); !errors.Is(err, ErrNoReadyStory) {
		t.Fatalf("second OpenReady err = %v, want ErrNoReadyStory", err)
	}
}

func TestOpenReadyQueuesRegeneration(t *testing.T) {
	// Having consumed the ready story, OpenReady kicks a background
	// regeneration: the next story becomes ready without waiting for the
	// scheduler's next sweep.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	first, ready, err := store.ReadyStoryID(ctx, user)
	if err != nil || !ready {
		t.Fatalf("want a ready story first, ready=%v err=%v", ready, err)
	}
	before := provider.callCount()

	if _, err := svc.OpenReady(ctx, user); err != nil {
		t.Fatalf("OpenReady: %v", err)
	}

	deadline := time.Now().Add(10 * time.Second)
	for {
		id, ready, err := store.ReadyStoryID(ctx, user)
		if err != nil {
			t.Fatalf("ReadyStoryID: %v", err)
		}
		if ready && id != first {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the post-open regeneration never produced a new ready story")
		}
		time.Sleep(10 * time.Millisecond)
	}
	if after := provider.callCount(); after <= before {
		t.Fatalf("provider calls = %d after opening, want a regeneration kick (was %d)", after, before)
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
		Sentences: []Sentence{{Pos: 0, JA: "ねこ", EN: "cat",
			Tokens: []Token{{Pos: 0, Surface: "ねこ", Tag: TagKnown, SRSLevel: &lvl}},
			// The grammar half of the Focus Set gets Practice Records too:
			// one per distinct focus point however many spans share it;
			// non-focus spans are skipped.
			Spans: []Span{
				{Start: 0, End: 2, GrammarPointID: 900, IsFocus: true},
				{Start: 0, End: 2, GrammarPointID: 900, IsFocus: true},
				{Start: 0, End: 2, GrammarPointID: 901},
			},
		}},
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
	want := map[mastery.ItemKey]bool{
		{Kind: mastery.KindVocabulary, Ref: "1"}: true,
		{Kind: mastery.KindGrammar, Ref: "900"}:  true,
	}
	if len(results.calls) != len(want) {
		t.Fatalf("practice rows = %d, want %d (focus vocab + distinct focus grammar)", len(results.calls), len(want))
	}
	for _, c := range results.calls {
		if !want[c.Item] {
			t.Fatalf("unexpected practice row %+v, want only focus items", c)
		}
		if !c.Correct {
			t.Fatalf("practice row %+v: correct=false, want the answer's verdict", c)
		}
		delete(want, c.Item)
	}
	if len(want) != 0 {
		t.Fatalf("missing practice rows for %v", want)
	}

	// At most once ever: a second answer grades but writes nothing new.
	res2, err := svc.Answer(ctx, st.ID, user, 0, 0)
	if err != nil {
		t.Fatalf("Answer (second): %v", err)
	}
	if res2.Correct || res2.PracticeRecorded {
		t.Fatalf("second answer: correct=%v recorded=%v, want grading only", res2.Correct, res2.PracticeRecorded)
	}
	if len(results.calls) != 2 {
		t.Fatalf("practice rows = %d after a second answer, want still 2", len(results.calls))
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
	if us.PreferredGenre != "" || us.PreferredTheme != "" {
		t.Fatalf("default prefs = %q/%q, want surprise-me (empty)", us.PreferredGenre, us.PreferredTheme)
	}

	us, err = svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 7, PreferredGenre: "  mystery  ", PreferredTheme: "robots"})
	if err != nil {
		t.Fatalf("PutSettings: %v", err)
	}
	if us.FuriganaThresholdSRSLevel != 7 {
		t.Fatalf("threshold after PutSettings = %d, want 7", us.FuriganaThresholdSRSLevel)
	}
	if us.PreferredGenre != "mystery" || us.PreferredTheme != "robots" {
		t.Fatalf("prefs after PutSettings = %q/%q, want trimmed round-trip", us.PreferredGenre, us.PreferredTheme)
	}
	us, err = svc.GetSettings(ctx, user)
	if err != nil {
		t.Fatalf("GetSettings (after put): %v", err)
	}
	if us.PreferredGenre != "mystery" || us.PreferredTheme != "robots" {
		t.Fatalf("prefs after GetSettings = %q/%q, want the stored values", us.PreferredGenre, us.PreferredTheme)
	}

	if _, err := svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 10}); err == nil {
		t.Fatal("threshold above the mastery scale must be rejected")
	}
	// Length caps count runes, so Japanese text is capped like English.
	long := strings.Repeat("猫", maxPreferredThemeLen+1)
	if _, err := svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 3, PreferredTheme: long}); err == nil {
		t.Fatal("theme over the cap must be rejected")
	}
	long = strings.Repeat("猫", maxPreferredGenreLen+1)
	if _, err := svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 3, PreferredGenre: long}); err == nil {
		t.Fatal("genre over the cap must be rejected")
	}

	// Putting without prefs means "surprise me" again: PUT replaces.
	us, err = svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 3})
	if err != nil {
		t.Fatalf("PutSettings (clearing prefs): %v", err)
	}
	if us.PreferredGenre != "" || us.PreferredTheme != "" {
		t.Fatalf("prefs after clearing = %q/%q, want empty", us.PreferredGenre, us.PreferredTheme)
	}
}

func TestEnsureReadyUsesPreferredGenreAndTheme(t *testing.T) {
	// The Learner's chosen genre beats the rating-steered pick and the
	// theme reaches the prompt; the stored story carries the preferred
	// genre. All of it is prompt steering only — the gate is untouched.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "surprise", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	if err := store.SetStoryPrefs(ctx, user, "mystery", "robots running a ramen shop"); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}

	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	prompt := provider.lastUserPrompt()
	if !strings.Contains(prompt, "- Genre/theme: mystery.") {
		t.Fatalf("prompt did not use the preferred genre:\n%s", prompt)
	}
	if !strings.Contains(prompt, "- Theme: robots running a ramen shop.") {
		t.Fatalf("prompt missing the preferred theme:\n%s", prompt)
	}
	id, ready, _ := store.ReadyStoryID(ctx, user)
	if !ready {
		t.Fatal("want a ready story")
	}
	if g := store.stories[id].Genre; g != "mystery" {
		t.Fatalf("stored genre = %q, want the preferred one", g)
	}
	if p := store.stories[id].Prompt; p == "" || !strings.Contains(p, "ねこ") {
		t.Fatalf("stories.prompt not populated with the brief: %q", p)
	}
}

func TestEnsureReadyAvoidsDislikedGenres(t *testing.T) {
	// Net-down-rated genres never get re-picked — not even from recent
	// reading — and the prompt names them as "avoid".
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	down := RatingDown
	if err := store.Save(ctx, &Story{UserID: user, Genre: "mystery", Validated: true, Rating: &down}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady: %v", err)
	}
	prompt := provider.lastUserPrompt()
	if !strings.Contains(prompt, "Avoid these genres, the reader did not like them: mystery") {
		t.Fatalf("prompt missing the avoid-genres line:\n%s", prompt)
	}
	if strings.Contains(prompt, "- Genre/theme: mystery.") {
		t.Fatal("a disliked genre must not be re-picked from recent reading")
	}
	if !strings.Contains(prompt, "surprise the reader") {
		t.Fatal("with only disliked genres in history the fallback is surprise-me")
	}
}

func TestEnsureReadyFailureWaitsOutRetryCooldown(t *testing.T) {
	// Failure backoff: while the user's newest Story is a gate failure
	// younger than Settings.RetryCooldown, later passes are skipped — a
	// stuck provider costs one generation per cooldown window, not one per
	// scheduler interval.
	ctx := context.Background()
	user := uuid.New()
	dirty := string(fixture(t, "travel", dirtyClause, dirtyClause, dirtyClause, dirtyClause))
	clean := string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause))
	provider := newFakeProvider(t, dirty, clean)
	svc, store, _, _ := newTestService(t, provider)
	svc.settings.RetryCooldown = 6 * time.Hour
	svc.now = store.storeNow // one clock: the cooldown compares store stamps

	if err := svc.EnsureReady(ctx, user); err == nil {
		t.Fatal("want the gate's rejection surfaced as an error")
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}

	// Inside the window: no spend, no error — the pass is simply skipped.
	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady (inside cooldown): %v", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d inside the cooldown, want still 1", provider.callCount())
	}

	// Past the window: the next pass generates again, and the success also
	// clears the backoff (the newest story is no longer a failure).
	store.advanceNow(6 * time.Hour)
	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady (after cooldown): %v", err)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d past the cooldown, want 2", provider.callCount())
	}
	if _, ready, _ := store.ReadyStoryID(ctx, user); !ready {
		t.Fatal("the post-cooldown pass should produce the ready story")
	}
	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady (ready): %v", err)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d with a ready story, want still 2", provider.callCount())
	}
}

func TestEnsureReadySingleFlightAcrossSweeps(t *testing.T) {
	// The at-most-one-generation-per-user rule lives in EnsureReady, so
	// every route shares it (the scheduler pass and the post-open kick
	// alike): while one is in flight, a later call returns without spending
	// a second provider call.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	provider.block = make(chan struct{}, 4) // two-phase handshake per call
	svc, store, focus, _ := newTestService(t, provider)

	firstDone := make(chan error, 1)
	go func() { firstDone <- svc.EnsureReady(ctx, user) }()
	<-provider.block // first call recorded, still mid-flight

	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady (deduped): %v", err)
	}
	if n := provider.callCount(); n != 1 {
		provider.block <- struct{}{}
		<-firstDone
		t.Fatalf("provider calls = %d while one generation was in flight, want 1", n)
	}

	provider.block <- struct{}{} // let the in-flight call answer
	if err := <-firstDone; err != nil {
		t.Fatalf("EnsureReady (first): %v", err)
	}
	if _, ready, _ := store.ReadyStoryID(ctx, user); !ready {
		t.Fatal("the in-flight generation should still have produced the ready story")
	}

	// The blocked call's slot was released: the guard is not stuck, so a
	// later focus change generates again rather than deadlocking.
	focus.set.Vocab = []VocabFocus{{EntSeq: 1}, {EntSeq: 2}, {EntSeq: 3}}
	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady (after): %v", err)
	}
	if n := provider.callCount(); n != 2 {
		t.Fatalf("provider calls = %d after the flight ended, want 2", n)
	}
}

func TestBeginGenerationGuardIsExclusiveAndReleasable(t *testing.T) {
	// The guard's contract, without goroutines: one slot per user, released
	// exactly once by its paired closure.
	user, other := uuid.New(), uuid.New()
	svc, _, _, _ := newTestService(t, nil)

	inFlight := func() []uuid.UUID {
		svc.genMu.Lock()
		defer svc.genMu.Unlock()
		out := make([]uuid.UUID, 0, len(svc.genInFlight))
		for id := range svc.genInFlight {
			out = append(out, id)
		}
		sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
		return out
	}

	rel, ok := svc.beginGeneration(user)
	if !ok {
		t.Fatal("first beginGeneration: ok=false, want the slot")
	}
	if _, ok := svc.beginGeneration(user); ok {
		t.Fatal("beginGeneration handed out a second slot for the same user")
	}
	if _, ok := svc.beginGeneration(other); !ok {
		t.Fatal("another user's generation must not be blocked")
	}
	if got := inFlight(); len(got) != 2 {
		t.Fatalf("in flight = %v, want this user and the other", got)
	}
	rel()
	rel() // the paired release is idempotent
	if got := inFlight(); len(got) != 1 || got[0] != other {
		t.Fatalf("in flight after release = %v, want only the other user", got)
	}
	rel2, ok := svc.beginGeneration(user)
	if !ok {
		t.Fatal("the slot is not reusable after release")
	}
	rel2()
}

func TestEnsureReadySetReadyConflictIsBenign(t *testing.T) {
	// A concurrent generator (another instance) that took the one ready
	// slot first surfaces as errReadyConflict; it is logged, not an error:
	// the loser's story stays stored and validated, just not ready.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	store.setReadyConflict = true

	if err := svc.EnsureReady(ctx, user); err != nil {
		t.Fatalf("EnsureReady with a lost SetReady race = %v, want nil", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}
	var stored *Story
	for _, st := range store.stories {
		stored = st
	}
	if stored == nil || !stored.Validated || stored.ReadyAt != nil {
		t.Fatalf("story after a lost ready race: %+v, want stored, validated, unready", stored)
	}
}

func TestAnswerRejectsFailedStory(t *testing.T) {
	// A gate failure is kept for analysis, never offered: answering one by
	// id (stale or forged) is a 400, and it writes no Practice Records and
	// never claims the practiced marker.
	ctx := context.Background()
	user := uuid.New()
	svc, store, _, results := newTestService(t, nil)
	st := &Story{
		UserID: user, Genre: "travel", Validated: false,
		Questions:  []Question{{Pos: 0, PromptJA: "q", OptionsJA: []string{"a", "b"}, AnswerIndex: 1}},
		VocabItems: []VocabItem{{EntSeq: 1, IsFocus: true, IsKnown: true}},
	}
	if err := store.Save(ctx, st); err != nil {
		t.Fatalf("Save: %v", err)
	}

	_, err := svc.Answer(ctx, st.ID, user, 0, 1)
	var se *Error
	if !errors.As(err, &se) || se.Status != 400 {
		t.Fatalf("Answer on a failed story err = %v, want a 400 story error", err)
	}
	if results.callCount() != 0 {
		t.Fatalf("practice rows = %d for a failed story, want 0", results.callCount())
	}
	if store.stories[st.ID].PracticedAt != nil {
		t.Fatal("a rejected answer must not claim the practiced marker")
	}
}

func TestAnswerRollsBackPracticedMarkerWhenAppendFails(t *testing.T) {
	// The practiced marker claims the at-most-once Practice Records write.
	// If the append fails after the claim, the claim is undone, so the
	// Learner's retry records the items instead of being silently skipped.
	ctx := context.Background()
	user := uuid.New()
	svc, store, _, results := newTestService(t, nil)
	st := &Story{
		UserID: user, Genre: "travel", Validated: true,
		Questions:  []Question{{Pos: 0, PromptJA: "q", OptionsJA: []string{"a", "b"}, AnswerIndex: 1}},
		VocabItems: []VocabItem{{EntSeq: 1, IsFocus: true, IsKnown: true}},
	}
	if err := store.Save(ctx, st); err != nil {
		t.Fatalf("Save: %v", err)
	}

	results.fail = true
	if _, err := svc.Answer(ctx, st.ID, user, 0, 1); err == nil {
		t.Fatal("Answer must surface the Practice Record append failure")
	}
	if store.stories[st.ID].PracticedAt != nil {
		t.Fatal("the failed append must roll the practiced marker back")
	}
	if results.callCount() != 0 {
		t.Fatalf("practice rows = %d, want 0 (the append failed)", results.callCount())
	}

	// Retry after the outage: the marker is free again, so the records land.
	results.fail = false
	res, err := svc.Answer(ctx, st.ID, user, 0, 1)
	if err != nil {
		t.Fatalf("Answer (retry): %v", err)
	}
	if !res.PracticeRecorded {
		t.Fatal("retry after a failed append must write the Practice Records")
	}
	if results.callCount() != 1 {
		t.Fatalf("practice rows = %d, want exactly 1 after one successful write", results.callCount())
	}
}

func TestPutSettingsStripsControlCharactersFromPrefs(t *testing.T) {
	// Stored preferences go through the same sanitizer as model genres:
	// newlines and control characters collapse to spaces, so a preference
	// can never smuggle a line break into a prompt or the UI.
	ctx := context.Background()
	user := uuid.New()
	svc, _, _, _ := newTestService(t, nil)

	us, err := svc.PutSettings(ctx, user, UserSettings{
		FuriganaThresholdSRSLevel: 3,
		PreferredGenre:            "road\ntrip",
		PreferredTheme:            "ramen\tshop\r\nvisit",
	})
	if err != nil {
		t.Fatalf("PutSettings: %v", err)
	}
	if us.PreferredGenre != "road trip" {
		t.Fatalf("genre = %q, want control characters collapsed", us.PreferredGenre)
	}
	if us.PreferredTheme != "ramen shop visit" {
		t.Fatalf("theme = %q, want control characters collapsed", us.PreferredTheme)
	}
}

func TestReadingSettingsDefaultToBlurred(t *testing.T) {
	svc, store, _, _ := newTestService(t, nil)
	s, err := svc.GetReadingSettings(context.Background(), uuid.New())
	if err != nil {
		t.Fatalf("GetReadingSettings: %v", err)
	}
	if !s.BlurTranslation {
		t.Errorf("BlurTranslation = false, want the default true")
	}
	// Sanity: the fake store models the users column, which defaults to TRUE.
	if blur, err := store.BlurTranslation(context.Background(), uuid.New()); err != nil || !blur {
		t.Errorf("store default = %v/%v, want true/nil", blur, err)
	}
}

func TestReadingSettingsRoundTrip(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	svc, store, _, _ := newTestService(t, nil)

	s, err := svc.PutReadingSettings(ctx, user, ReadingSettings{BlurTranslation: false})
	if err != nil {
		t.Fatalf("PutReadingSettings(false): %v", err)
	}
	if s.BlurTranslation {
		t.Errorf("returned BlurTranslation = true, want false")
	}

	s, err = svc.GetReadingSettings(ctx, user)
	if err != nil {
		t.Fatalf("GetReadingSettings: %v", err)
	}
	if s.BlurTranslation {
		t.Errorf("GetReadingSettings after save = true, want the saved false")
	}
	if blur, err := store.BlurTranslation(ctx, user); err != nil || blur {
		t.Errorf("store BlurTranslation = %v/%v, want false/nil", blur, err)
	}

	s, err = svc.PutReadingSettings(ctx, user, ReadingSettings{BlurTranslation: true})
	if err != nil {
		t.Fatalf("PutReadingSettings(true): %v", err)
	}
	if !s.BlurTranslation {
		t.Errorf("re-enabled BlurTranslation = false, want true")
	}
}

func TestSanitizeLabel(t *testing.T) {
	if got := sanitizeLabel("romance\nwith\tnewlines", 60); got != "romance with newlines" {
		t.Fatalf("collapse = %q", got)
	}
	if got := sanitizeLabel("  spaces   everywhere  ", 60); got != "spaces everywhere" {
		t.Fatalf("collapse = %q", got)
	}
	if got := sanitizeLabel(strings.Repeat("猫", 70), maxLabelRunes); got != strings.Repeat("猫", maxLabelRunes) {
		t.Fatalf("cap: got %d runes, want %d", utf8.RuneCountInString(got), maxLabelRunes)
	}
	if got := sanitizeLabel("  \n ", 60); got != "" {
		t.Fatalf("blank label = %q, want empty", got)
	}
}
