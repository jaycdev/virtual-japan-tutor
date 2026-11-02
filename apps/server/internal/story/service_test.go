package story

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
	_ "time/tzdata" // settings validation and the daily rule resolve IANA names anywhere the server runs
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

// --- fake store ---

type fakeStore struct {
	mu           sync.Mutex
	stories      map[uuid.UUID]*Story
	users        map[uuid.UUID]bool
	threshold    map[uuid.UUID]int
	blur         map[uuid.UUID]bool      // missing = default true, like the users column
	lookupHoldMs map[uuid.UUID]int       // missing = default 800, like the users column
	prefs        map[uuid.UUID][3]string // genre, theme ("" = surprise-me / no theme), timezone ("" = unset)
	now          time.Time
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		stories:      map[uuid.UUID]*Story{},
		users:        map[uuid.UUID]bool{},
		threshold:    map[uuid.UUID]int{},
		blur:         map[uuid.UUID]bool{},
		lookupHoldMs: map[uuid.UUID]int{},
		prefs:        map[uuid.UUID][3]string{},
		now:          time.Unix(1700000000, 0).UTC(),
	}
}

func (s *fakeStore) Save(_ context.Context, st *Story) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st.ID == uuid.Nil {
		st.ID = uuid.New()
	}
	if st.Origin == "" {
		st.Origin = OriginAutomatic // the stories.origin column default
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

// LatestAutomaticStory mirrors the Postgres store: the newest validated
// Automatic Story whatever its Read mark, On-demand Stories excluded.
func (s *fakeStore) LatestAutomaticStory(_ context.Context, userID uuid.UUID) (*Story, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var newest *Story
	for _, st := range s.stories {
		if st.UserID != userID || !st.Validated || st.Origin != OriginAutomatic {
			continue
		}
		if newest == nil || st.CreatedAt.After(newest.CreatedAt) {
			newest = st
		}
	}
	if newest == nil {
		return nil, false, nil
	}
	return newest, true, nil
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

func (s *fakeStore) LookupHoldMs(_ context.Context, userID uuid.UUID) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.lookupHoldMs[userID]
	if !ok {
		return DefaultLookupHoldMs, nil // the users column defaults to 800
	}
	return v, nil
}

func (s *fakeStore) SetLookupHoldMs(_ context.Context, userID uuid.UUID, holdMs int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lookupHoldMs[userID] = holdMs
	return nil
}

func (s *fakeStore) StoryPrefs(_ context.Context, userID uuid.UUID) (string, string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.prefs[userID]
	return p[0], p[1], p[2], nil
}

func (s *fakeStore) SetStoryPrefs(_ context.Context, userID uuid.UUID, genre, theme, timezone string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prefs[userID] = [3]string{genre, theme, timezone}
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

func (s *fakeStore) MarkRead(_ context.Context, id, userID uuid.UUID, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.stories[id]
	if !ok || st.UserID != userID {
		return ErrNotFound
	}
	st.ReadAt = &at
	return nil
}

func (s *fakeStore) ClearRead(_ context.Context, id, userID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.stories[id]
	if !ok || st.UserID != userID {
		return ErrNotFound
	}
	st.ReadAt = nil
	return nil
}

func (s *fakeStore) Delete(_ context.Context, id, userID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.stories[id]
	if !ok || st.UserID != userID {
		return ErrNotFound
	}
	delete(s.stories, id)
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

func TestEnsureAutomaticStoryWritesOnePerLocalDay(t *testing.T) {
	// The Automatic Story rule (issue #32): one per day in the Learner's
	// Timezone, and the scheduler's repeated passes are a cheap no-op once
	// the day's story is written.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.now = store.storeNow // one clock: the daily rule compares store stamps
	if err := store.SetStoryPrefs(ctx, user, "", "", "UTC"); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}

	// The first pass writes today's story — and the prompt carried the
	// Focus Set and Known Items (issue #10).
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}
	st, ok, err := store.LatestAutomaticStory(ctx, user)
	if err != nil || !ok {
		t.Fatalf("want an Automatic Story, ok=%v err=%v", ok, err)
	}
	if !st.Validated || st.Attempts != 1 || st.Origin != OriginAutomatic {
		t.Fatalf("story validated=%v attempts=%d origin=%q, want validated on the first try", st.Validated, st.Attempts, st.Origin)
	}
	if st.ReadAt != nil {
		t.Fatal("a freshly written Automatic Story must start unread")
	}
	prompt := provider.lastUserPrompt()
	if !strings.Contains(prompt, "ねこ") {
		t.Fatal("prompt missing the focus word")
	}

	// Still the same local day (and unread besides): later passes skip the
	// provider entirely.
	for i := 0; i < 3; i++ {
		if err := svc.ensureAutomaticStory(ctx, user); err != nil {
			t.Fatalf("ensureAutomaticStory (same day): %v", err)
		}
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d on the same local day, want still 1", provider.callCount())
	}

	// Reading it does not open a second slot on the same day.
	if err := store.MarkRead(ctx, st.ID, user, store.storeNow()); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (read, same day): %v", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d after reading on the same day, want still 1", provider.callCount())
	}

	// The next local day: the next pass writes the new day's story.
	store.advanceNow(24 * time.Hour)
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (next day): %v", err)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d on the next local day, want 2", provider.callCount())
	}
}

func TestEnsureAutomaticStoryUnreadHoldsTheSlot(t *testing.T) {
	// The unread rule: an unread Automatic Story holds the slot however
	// many days pass — no second story stacks up behind it. Once it is
	// read, the next pass writes for today (the catch-up case: the day
	// started while the old story was still unread).
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.now = store.storeNow
	if err := store.SetStoryPrefs(ctx, user, "", "", "UTC"); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	st, ok, _ := store.LatestAutomaticStory(ctx, user)
	if !ok {
		t.Fatal("want an Automatic Story first")
	}

	store.advanceNow(5 * 24 * time.Hour)
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (unread, five days on): %v", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d while the story sat unread, want still 1", provider.callCount())
	}

	// Opening it frees the day: the very next pass catches up.
	if err := store.MarkRead(ctx, st.ID, user, store.storeNow()); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (caught up): %v", err)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d after reading, want the catch-up write", provider.callCount())
	}
	newer, ok, _ := store.LatestAutomaticStory(ctx, user)
	if !ok || newer.ID == st.ID {
		t.Fatal("the catch-up pass produced no new Automatic Story")
	}
}

func TestEnsureAutomaticStoryUsesTheLearnersTimezone(t *testing.T) {
	// The day is the Learner's, not the server's: Tokyo's date flips while
	// the server's UTC day still has hours left, and the pass writes the
	// new story then.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.now = store.storeNow
	if err := store.SetStoryPrefs(ctx, user, "", "", "Asia/Tokyo"); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}

	// Park the clock at 14:00 UTC — 23:00 the same day in Tokyo.
	store.advanceNow(15*time.Hour + 46*time.Minute + 40*time.Second)
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	st, ok, _ := store.LatestAutomaticStory(ctx, user)
	if !ok {
		t.Fatal("want an Automatic Story first")
	}
	if err := store.MarkRead(ctx, st.ID, user, store.storeNow()); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}

	// Two hours on: still the same UTC day, but Tokyo has turned its date.
	store.advanceNow(2 * time.Hour)
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (Tokyo's new day): %v", err)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d after the Learner's day rolled over, want 2", provider.callCount())
	}

	// And the same UTC-hours-later pass must NOT fire when the Learner's
	// day has not rolled over: same clock walk with a UTC Learner.
	user2 := uuid.New()
	if err := store.SetStoryPrefs(ctx, user2, "", "", "UTC"); err != nil {
		t.Fatalf("SetStoryPrefs (user2): %v", err)
	}
	if err := svc.ensureAutomaticStory(ctx, user2); err != nil {
		t.Fatalf("ensureAutomaticStory (user2 first): %v", err)
	}
	st2, ok, _ := store.LatestAutomaticStory(ctx, user2)
	if !ok {
		t.Fatal("want user2's Automatic Story")
	}
	if err := store.MarkRead(ctx, st2.ID, user2, store.storeNow()); err != nil {
		t.Fatalf("MarkRead (user2): %v", err)
	}
	before := provider.callCount()
	store.advanceNow(2 * time.Hour) // same UTC day, a later Tokyo day
	if err := svc.ensureAutomaticStory(ctx, user2); err != nil {
		t.Fatalf("ensureAutomaticStory (user2 same UTC day): %v", err)
	}
	if provider.callCount() != before {
		t.Fatalf("provider calls = %d on user2's same local day, want still %d", provider.callCount(), before)
	}
}

func TestDeletingTodaysStoryFreesTheDay(t *testing.T) {
	// Issue #32: deleting today's story frees the day, so the next pass
	// writes a replacement.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.now = store.storeNow
	if err := store.SetStoryPrefs(ctx, user, "", "", "UTC"); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	st, ok, _ := store.LatestAutomaticStory(ctx, user)
	if !ok {
		t.Fatal("want an Automatic Story first")
	}

	if err := svc.Delete(ctx, st.ID, user); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if _, ok, _ := store.LatestAutomaticStory(ctx, user); ok {
		t.Fatal("deleting the story must remove it from storage")
	}
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (after delete): %v", err)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d after deleting today's story, want the replacement", provider.callCount())
	}
}

func TestTodaysStoryReturnsTheNewestAutomaticStory(t *testing.T) {
	// Today's Story (GLOSSARY.md): the newest validated Automatic Story
	// whatever its Read mark; On-demand Stories and gate failures never
	// qualify; opening it changes nothing.
	ctx := context.Background()
	user := uuid.New()
	svc, store, _, _ := newTestService(t, nil) // the read path needs no provider

	onDemand := &Story{UserID: user, Genre: "travel", Validated: true, Origin: OriginOnDemand}
	if err := store.Save(ctx, onDemand); err != nil {
		t.Fatalf("Save (on-demand): %v", err)
	}
	failed := &Story{UserID: user, Genre: "travel", Validated: false, Origin: OriginAutomatic}
	if err := store.Save(ctx, failed); err != nil {
		t.Fatalf("Save (failed): %v", err)
	}
	if _, err := svc.TodaysStory(ctx, user); !errors.Is(err, ErrNoStory) {
		t.Fatalf("TodaysStory over on-demand and failed stories err = %v, want ErrNoStory", err)
	}

	first := &Story{UserID: user, Genre: "travel", Validated: true, Origin: OriginAutomatic}
	if err := store.Save(ctx, first); err != nil {
		t.Fatalf("Save (first): %v", err)
	}
	second := &Story{UserID: user, Genre: "mystery", Validated: true, Origin: OriginAutomatic}
	if err := store.Save(ctx, second); err != nil {
		t.Fatalf("Save (second): %v", err)
	}

	got, err := svc.TodaysStory(ctx, user)
	if err != nil {
		t.Fatalf("TodaysStory: %v", err)
	}
	if got.ID != second.ID {
		t.Fatalf("TodaysStory = %v, want the newest Automatic Story %v", got.ID, second.ID)
	}

	// Reading it — or unreading it — leaves the same story offered.
	if err := svc.MarkRead(ctx, second.ID, user, store.storeNow()); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	got, err = svc.TodaysStory(ctx, user)
	if err != nil || got.ID != second.ID {
		t.Fatalf("TodaysStory after reading = %v/%v, want %v", got, err, second.ID)
	}

	if _, err := svc.TodaysStory(ctx, uuid.New()); !errors.Is(err, ErrNoStory) {
		t.Fatal("a user with no stories must get ErrNoStory")
	}
}

func TestEnsureAutomaticStorySkipsEmptyFocusSet(t *testing.T) {
	provider := newFakeProvider(t, "{}")
	svc, _, focus, _ := newTestService(t, provider)
	focus.set = FocusSet{}
	if err := svc.ensureAutomaticStory(context.Background(), uuid.New()); err != nil {
		t.Fatalf("ensureAutomaticStory (empty focus): %v", err)
	}
	if provider.callCount() != 0 {
		t.Fatal("an empty Focus Set must not spend a provider call")
	}
}

func TestEnsureAutomaticStoryNoProvider(t *testing.T) {
	svc, _, _, _ := newTestService(t, nil) // resolver answers ErrNotAssigned
	if err := svc.ensureAutomaticStory(context.Background(), uuid.New()); !errors.Is(err, aiprovider.ErrNotAssigned) {
		t.Fatalf("ensureAutomaticStory err = %v, want ErrNotAssigned", err)
	}
}

func TestEnsureAutomaticStoryFailureStoredAndCooledDown(t *testing.T) {
	// Failed-story policy: the last candidate is stored with its gate
	// counts but never becomes Today's Story. The retry backoff keeps a
	// stuck provider affordable: one generation per cooldown window, not
	// one per scheduler pass.
	ctx := context.Background()
	user := uuid.New()
	dirty := string(fixture(t, "travel", dirtyClause, dirtyClause, dirtyClause, dirtyClause))
	clean := string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause))
	provider := newFakeProvider(t, dirty, clean)
	svc, store, _, _ := newTestService(t, provider)
	svc.settings.RetryCooldown = 6 * time.Hour
	svc.now = store.storeNow // one clock: the cooldown compares store stamps

	if err := svc.ensureAutomaticStory(ctx, user); err == nil {
		t.Fatal("want the gate's rejection surfaced as an error")
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}
	if _, ok, _ := store.LatestAutomaticStory(ctx, user); ok {
		t.Fatal("a failed story must never become Today's Story")
	}
	var stored *Story
	for _, st := range store.stories {
		stored = st
	}
	if stored == nil || stored.Validated || stored.ContentWords == 0 || stored.Attempts != 1 {
		t.Fatalf("failed story not stored with its gate counts: %+v", stored)
	}

	// Inside the window: no spend, no error — the pass is simply skipped.
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (inside cooldown): %v", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d inside the cooldown, want still 1", provider.callCount())
	}

	// Past the window: the next pass generates again, and the success also
	// clears the backoff (the newest story is no longer a failure).
	store.advanceNow(6 * time.Hour)
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (after cooldown): %v", err)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d past the cooldown, want 2", provider.callCount())
	}
	if _, ok, _ := store.LatestAutomaticStory(ctx, user); !ok {
		t.Fatal("the post-cooldown pass should produce Today's Story")
	}
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (unread again): %v", err)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d with an unread story, want still 2", provider.callCount())
	}
}

func TestEnsureAutomaticStorySingleFlightAcrossPasses(t *testing.T) {
	// The at-most-one-generation-per-user rule lives in
	// ensureAutomaticStory, so every route shares it (the scheduler pass
	// and any other caller alike): while one is in flight, a later call
	// returns without spending a second provider call.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	provider.block = make(chan struct{}, 4) // two-phase handshake per call
	svc, store, _, _ := newTestService(t, provider)
	svc.now = store.storeNow
	if err := store.SetStoryPrefs(ctx, user, "", "", "UTC"); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}

	firstDone := make(chan error, 1)
	go func() { firstDone <- svc.ensureAutomaticStory(ctx, user) }()
	<-provider.block // first call recorded, still mid-flight

	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (deduped): %v", err)
	}
	if n := provider.callCount(); n != 1 {
		provider.block <- struct{}{}
		<-firstDone
		t.Fatalf("provider calls = %d while one generation was in flight, want 1", n)
	}

	provider.block <- struct{}{} // let the in-flight call answer
	if err := <-firstDone; err != nil {
		t.Fatalf("ensureAutomaticStory (first): %v", err)
	}
	if _, ok, _ := store.LatestAutomaticStory(ctx, user); !ok {
		t.Fatal("the in-flight generation should still have produced Today's Story")
	}

	// The blocked call's slot was released: the guard is not stuck, so the
	// next day generates again rather than deadlocking.
	st, _, _ := store.LatestAutomaticStory(ctx, user)
	if err := store.MarkRead(ctx, st.ID, user, store.storeNow()); err != nil {
		t.Fatalf("MarkRead: %v", err)
	}
	store.advanceNow(24 * time.Hour)
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory (after): %v", err)
	}
	if n := provider.callCount(); n != 2 {
		t.Fatalf("provider calls = %d after the flight ended, want 2", n)
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

	us, err = svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 7, PreferredGenre: "  mystery  ", PreferredTheme: "robots", Timezone: " Asia/Tokyo "})
	if err != nil {
		t.Fatalf("PutSettings: %v", err)
	}
	if us.FuriganaThresholdSRSLevel != 7 {
		t.Fatalf("threshold after PutSettings = %d, want 7", us.FuriganaThresholdSRSLevel)
	}
	if us.PreferredGenre != "mystery" || us.PreferredTheme != "robots" {
		t.Fatalf("prefs after PutSettings = %q/%q, want trimmed round-trip", us.PreferredGenre, us.PreferredTheme)
	}
	if us.Timezone != "Asia/Tokyo" {
		t.Fatalf("timezone after PutSettings = %q, want the trimmed IANA name", us.Timezone)
	}
	us, err = svc.GetSettings(ctx, user)
	if err != nil {
		t.Fatalf("GetSettings (after put): %v", err)
	}
	if us.PreferredGenre != "mystery" || us.PreferredTheme != "robots" {
		t.Fatalf("prefs after GetSettings = %q/%q, want the stored values", us.PreferredGenre, us.PreferredTheme)
	}
	if us.Timezone != "Asia/Tokyo" {
		t.Fatalf("timezone after GetSettings = %q, want the stored value", us.Timezone)
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
	if us.Timezone != "" {
		t.Fatalf("timezone after clearing = %q, want the unset state back", us.Timezone)
	}
}

func TestPutSettingsTimezoneValidation(t *testing.T) {
	// The Learner's Timezone (issue #32): "" is the unset state (the
	// server's own timezone decides until the Learner picks), any other
	// value must be an IANA name the embedded zone data can read — a bad
	// name is a 400, never a silent fallback.
	ctx := context.Background()
	user := uuid.New()
	svc, _, _, _ := newTestService(t, nil)

	var se *Error
	if _, err := svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 3, Timezone: "Mars/Olympus_Mons"}); !errors.As(err, &se) || se.Code != "invalid_timezone" {
		t.Fatalf("PutSettings bad timezone err = %v, want an invalid_timezone error", err)
	}
	long := strings.Repeat("A", maxTimezoneLen+1)
	if _, err := svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 3, Timezone: long}); !errors.As(err, &se) || se.Code != "invalid_timezone" {
		t.Fatalf("PutSettings over-long timezone err = %v, want an invalid_timezone error", err)
	}

	us, err := svc.PutSettings(ctx, user, UserSettings{FuriganaThresholdSRSLevel: 3, Timezone: "Pacific/Kiritimati"})
	if err != nil {
		t.Fatalf("PutSettings (valid far-flung zone): %v", err)
	}
	if us.Timezone != "Pacific/Kiritimati" {
		t.Fatalf("timezone = %q, want the stored name", us.Timezone)
	}
}

func TestUserLocationFallsBackToTheServerTimezone(t *testing.T) {
	// Unset — or a name the embedded zone data cannot read (the settings
	// validation stops those, so this is the belt for old rows) — follows
	// the server's own timezone, as the issue requires.
	if got := userLocation(""); got != time.Local {
		t.Fatalf("userLocation(\"\") = %v, want time.Local", got)
	}
	if got := userLocation("Not/AZone"); got != time.Local {
		t.Fatalf("userLocation(Not/AZone) = %v, want time.Local", got)
	}
	if _, offset := time.Unix(1700000000, 0).In(userLocation("Asia/Tokyo")).Zone(); offset != 9*3600 {
		t.Fatal("userLocation(Asia/Tokyo) did not resolve to UTC+9")
	}
}

func TestSameLocalDay(t *testing.T) {
	tokyo, err := time.LoadLocation("Asia/Tokyo")
	if err != nil {
		t.Fatalf("LoadLocation: %v", err)
	}
	noon := time.Date(2026, 3, 14, 12, 0, 0, 0, tokyo)
	if !sameLocalDay(noon, noon.Add(10*time.Hour)) {
		t.Fatal("ten hours later is still the same Tokyo calendar day")
	}
	if sameLocalDay(noon, noon.Add(13*time.Hour)) {
		t.Fatal("thirteen hours later crosses into the next Tokyo day")
	}
	if !sameLocalDay(noon.UTC(), noon.Add(13*time.Hour).UTC()) {
		t.Fatal("the same two instants sit on one UTC day — the day must be the Learner's")
	}
}

func TestAutomaticGenrePreferenceShare(t *testing.T) {
	// The issue #32 mix, at the helper's seam: the Preferred Genre wins
	// rolls under PreferredShare; the variety branch keeps the rating-
	// steered PickGenre; a random preset genre covers the case where the
	// ratings have nothing to offer; and with no preference set at all the
	// old behaviour is untouched.
	if got := automaticGenre("mystery", nil, nil, 0.0); got != "mystery" {
		t.Fatalf("roll 0 with a preference = %q, want the preference", got)
	}
	if got := automaticGenre("mystery", nil, nil, PreferredShare-0.01); got != "mystery" {
		t.Fatalf("roll just under the share = %q, want the preference", got)
	}
	up := RatingUp
	ratings := map[string]map[Rating]int{"travel": {up: 2}}
	if got := automaticGenre("mystery", ratings, nil, PreferredShare); got != "travel" {
		t.Fatalf("variety roll with ratings = %q, want the rating-steered pick", got)
	}
	for i := 0; i < 20; i++ {
		got := automaticGenre("romance", nil, nil, 0.95)
		if got == "romance" {
			t.Fatalf("variety roll fell back to the preference itself (iteration %d)", i)
		}
		if !slices.Contains(presetGenres, got) {
			t.Fatalf("variety roll fallback = %q, want one of the preset genres", got)
		}
	}
	if got := automaticGenre("", ratings, nil, 0.0); got != "travel" {
		t.Fatalf("no preference, roll 0 = %q, want the rating-steered pick (today's behaviour)", got)
	}
	if got := automaticGenre("", nil, nil, 0.0); got != "" {
		t.Fatalf("no preference and no ratings = %q, want surprise-me", got)
	}
}

func TestAutomaticThemePreferenceShare(t *testing.T) {
	if got := automaticTheme("", 0.0); got != "" {
		t.Fatalf("no preference = %q, want the model to choose", got)
	}
	if got := automaticTheme("robots", PreferredShare-0.01); got != "robots" {
		t.Fatalf("roll under the share = %q, want the preference", got)
	}
	if got := automaticTheme("robots", PreferredShare); got != "" {
		t.Fatalf("variety roll = %q, want the model to choose", got)
	}
}

func TestEnsureAutomaticStoryUsesPreferredGenreAndTheme(t *testing.T) {
	// The Learner's chosen genre beats the rating-steered pick and the
	// theme reaches the prompt; the stored story carries the preferred
	// genre and theme. All of it is prompt steering only — the gate is
	// untouched.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "surprise", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.roll = func() float64 { return 0 } // always the preference branch
	if err := store.SetStoryPrefs(ctx, user, "mystery", "robots running a ramen shop", ""); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}

	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	prompt := provider.lastUserPrompt()
	if !strings.Contains(prompt, "- Genre/theme: mystery.") {
		t.Fatalf("prompt did not use the preferred genre:\n%s", prompt)
	}
	if !strings.Contains(prompt, "- Theme: robots running a ramen shop.") {
		t.Fatalf("prompt missing the preferred theme:\n%s", prompt)
	}
	st, ok, _ := store.LatestAutomaticStory(ctx, user)
	if !ok {
		t.Fatal("want an Automatic Story")
	}
	if g := st.Genre; g != "mystery" {
		t.Fatalf("stored genre = %q, want the preferred one", g)
	}
	if th := st.Theme; th != "robots running a ramen shop" {
		t.Fatalf("stored theme = %q, want the preferred one", th)
	}
	if p := st.Prompt; p == "" || !strings.Contains(p, "ねこ") {
		t.Fatalf("stories.prompt not populated with the brief: %q", p)
	}
}

func TestEnsureAutomaticStoryVarietyRollLeavesThemeToTheModel(t *testing.T) {
	// The other 30%: the genre keeps the rating-steered pick and the theme
	// ask goes back to the model (today's blank-theme behaviour).
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "surprise", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.roll = func() float64 { return 0.95 } // always the variety branch
	up := RatingUp
	if err := store.Save(ctx, &Story{UserID: user, Genre: "travel", Validated: true, Origin: OriginOnDemand, Rating: &up}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := store.SetStoryPrefs(ctx, user, "mystery", "robots running a ramen shop", ""); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}

	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	prompt := provider.lastUserPrompt()
	if !strings.Contains(prompt, "- Genre/theme: travel.") {
		t.Fatalf("variety roll should keep the rating-steered genre:\n%s", prompt)
	}
	if strings.Contains(prompt, "- Theme:") {
		t.Fatalf("variety roll must leave the theme to the model:\n%s", prompt)
	}
	st, ok, _ := store.LatestAutomaticStory(ctx, user)
	if !ok {
		t.Fatal("want an Automatic Story")
	}
	if st.Genre != "travel" {
		t.Fatalf("stored genre = %q, want the rating-steered pick", st.Genre)
	}
}

func TestEnsureAutomaticStoryAvoidsDislikedGenres(t *testing.T) {
	// Net-down-rated genres never get re-picked — not even from recent
	// reading — and the prompt names them as "avoid".
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	down := RatingDown
	if err := store.Save(ctx, &Story{UserID: user, Genre: "mystery", Validated: true, Origin: OriginOnDemand, Rating: &down}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
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
	if s.LookupHoldMs != DefaultLookupHoldMs {
		t.Errorf("LookupHoldMs = %d, want the default %d", s.LookupHoldMs, DefaultLookupHoldMs)
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

	s, err := svc.PutReadingSettings(ctx, user, ReadingSettingsUpdate{BlurTranslation: false})
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

	s, err = svc.PutReadingSettings(ctx, user, ReadingSettingsUpdate{BlurTranslation: true})
	if err != nil {
		t.Fatalf("PutReadingSettings(true): %v", err)
	}
	if !s.BlurTranslation {
		t.Errorf("re-enabled BlurTranslation = false, want true")
	}

	// Issue #12: the lookup-hold threshold rides along and round-trips.
	hold := 1500
	s, err = svc.PutReadingSettings(ctx, user, ReadingSettingsUpdate{BlurTranslation: true, LookupHoldMs: &hold})
	if err != nil {
		t.Fatalf("PutReadingSettings(hold 1500): %v", err)
	}
	if s.LookupHoldMs != 1500 {
		t.Errorf("returned LookupHoldMs = %d, want the saved 1500", s.LookupHoldMs)
	}
	if s, err = svc.GetReadingSettings(ctx, user); err != nil || s.LookupHoldMs != 1500 {
		t.Errorf("GetReadingSettings hold = %d/%v, want 1500/nil", s.LookupHoldMs, err)
	}
	if hold, err := store.LookupHoldMs(ctx, user); err != nil || hold != 1500 {
		t.Errorf("store LookupHoldMs = %d/%v, want 1500/nil", hold, err)
	}

	// An update without lookupHoldMs keeps the stored threshold: 0 is a
	// meaningful value ("signal every lookup"), so an absent field must
	// never land as 0.
	s, err = svc.PutReadingSettings(ctx, user, ReadingSettingsUpdate{BlurTranslation: false})
	if err != nil {
		t.Fatalf("PutReadingSettings(no hold): %v", err)
	}
	if s.LookupHoldMs != 1500 {
		t.Errorf("hold after omitted-field put = %d, want the prior 1500 kept", s.LookupHoldMs)
	}
	if s.BlurTranslation {
		t.Errorf("blur = true, want the updated false (the required field still applied)")
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
