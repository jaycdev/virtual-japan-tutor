package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync/marumoritest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

// marumoriEnv serves the MaruMori endpoints over the real auth middleware, with the
// sync Service over an in-memory Store and a canned Upstream.
type marumoriEnv struct {
	e     env
	store *marumoritest.MemStore
	up    *marumoritest.FakeUpstream
	uid   uuid.UUID // alice's user id, for store inspection
}

// memRef is a canned marumorisync.Reference: 水 links to KANJIDIC, 日本 to JMdict.
type memRef struct{}

func (memRef) FindKanji(_ context.Context, literal string) (refdata.Kanji, bool, error) {
	if literal == "水" {
		return refdata.Kanji{KanjidicEntry: refdata.KanjidicEntry{Literal: "水"}}, true, nil
	}
	return refdata.Kanji{}, false, nil
}

func (memRef) FindVocabulary(_ context.Context, written, _ string) ([]refdata.Vocabulary, error) {
	if written == "日本" {
		return []refdata.Vocabulary{{JMdictEntry: refdata.JMdictEntry{EntSeq: 1234}, JLPTLevel: refdata.N5}}, nil
	}
	return nil, nil
}

func newMarumoriEnvWith(t *testing.T, up marumorisync.Upstream) *marumoriEnv {
	t.Helper()
	return newMarumoriEnvWithStores(t, up, authtest.NewMemStore(), marumoritest.NewMemStore())
}

// newMarumoriEnvWithStores builds the same environment over chosen stores, so the
// Postgres-backed tests exercise the real Store SQL behind the same handlers.
func newMarumoriEnvWithStores(t *testing.T, up marumorisync.Upstream, authStore auth.Store, syncStore marumorisync.Store) *marumoriEnv {
	t.Helper()
	clock := authtest.NewFakeClock()
	authSvc := auth.NewService(authStore, auth.Options{TTL: time.Hour, Now: clock.Now})
	alice, err := authSvc.CreateUser(context.Background(), "alice", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authSvc.CreateUser(context.Background(), "bob", password); err != nil {
		t.Fatal(err)
	}

	box, err := secrets.NewFromKey(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	fake, _ := up.(*marumoritest.FakeUpstream)
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	svc := marumorisync.NewService(syncStore, box, memRef{},
		func(_ string, _ string) (marumorisync.Upstream, error) { return up, nil },
		marumorisync.WithClock(func() time.Time { t := now; now = now.Add(time.Second); return t }))

	handler := httpapi.New(fakeDB{}, authSvc, httpapi.WithMaruMori(svc))
	return &marumoriEnv{
		e:     env{h: handler, svc: authSvc, clock: clock},
		store: memOnly(syncStore),
		up:    fake,
		uid:   alice.ID,
	}
}

// memOnly returns the in-memory store when the wiring uses one; Postgres-backed
// environments inspect state through HTTP instead.
func memOnly(s marumorisync.Store) *marumoritest.MemStore {
	m, _ := s.(*marumoritest.MemStore)
	return m
}

func newMarumoriEnv(t *testing.T) *marumoriEnv {
	t.Helper()
	return newMarumoriEnvWith(t, &marumoritest.FakeUpstream{})
}

func happyMarumoriData(up *marumoritest.FakeUpstream) {
	up.Kanji = []marumori.KnownItem{
		{MaruMoriID: "Kanji/1", Text: "水", Level: 2},
		{MaruMoriID: "Kanji/2", Text: "火", Level: 1},
	}
	up.Vocabulary = []marumori.KnownItem{
		{MaruMoriID: "VocabularyForms/1", Text: "日本", Level: 3},
		{MaruMoriID: "VocabularyForms/2", Text: "日本语", Level: 1}, // no JMdict match
	}
	up.Reviews = []marumori.GrammarObservation{{MaruMoriID: "Grammar/202", Level: intPtr(3)}}
	up.Lessons = []marumori.GrammarObservation{{MaruMoriID: "Grammar/101"}}
	up.HomeState = marumori.Home{KanjiLearned: 42, VocabularyLearned: 77}
}

func intPtr(v int) *int { return &v }

type marumoriClient struct {
	e     env
	token string
	t     *testing.T
	all   *[]string // every response body, for the blanket "no key anywhere" check
}

func (c marumoriClient) do(method, path string, body any) *httptest.ResponseRecorder {
	c.t.Helper()
	rec := c.e.do(c.t, method, path, "Bearer "+c.token, body)
	*c.all = append(*c.all, method+" "+path+" -> "+rec.Body.String())
	return rec
}

func newMarumoriClient(t *testing.T, e env, user string) marumoriClient {
	t.Helper()
	return marumoriClient{e: e, token: e.login(t, user), t: t, all: new([]string)}
}

func (c marumoriClient) checkNoKeyLeak() {
	c.t.Helper()
	for _, body := range *c.all {
		assertNoKey(c.t, "response", body)
	}
}

// --- lifecycle ---

func TestMaruMoriConnectSyncStatusDisconnect(t *testing.T) {
	m := newMarumoriEnv(t)
	happyMarumoriData(m.up)
	alice := newMarumoriClient(t, m.e, "alice")

	// Before connecting: not connected, no error.
	rec := alice.do("GET", "/marumori", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status GET = %d %s", rec.Code, rec.Body)
	}
	var status api.MaruMoriStatus
	mustJSON(t, rec, &status)
	if status.Connected || status.Counts != nil || status.LastSync != nil {
		t.Fatalf("initial status = %+v, want not connected with no data", status)
	}

	// Connecting returns the new status, and never the key.
	rec = alice.do("PUT", "/marumori/key", map[string]any{"apiKey": apiKey})
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT key = %d %s", rec.Code, rec.Body)
	}
	mustJSON(t, rec, &status)
	if !status.Connected || status.ConnectedAt == nil {
		t.Fatalf("after PUT = %+v, want connected with a connectedAt", status)
	}

	// Sync stores what MaruMori knows and reports its counts.
	rec = alice.do("POST", "/marumori/sync", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST sync = %d %s", rec.Code, rec.Body)
	}
	var run api.MaruMoriSyncRun
	mustJSON(t, rec, &run)
	if run.Status != api.MaruMoriSyncRunStatusOk || run.Counts == nil {
		t.Fatalf("sync run = %+v, want ok with counts", run)
	}
	if run.Counts.Kanji != 2 || run.Counts.Vocabulary != 1 || run.Counts.Linked != 2 || run.Counts.Unlinked != 2 {
		// 水+火 stored (火 unlinked); 日本 stored linked; 日本语 counted unlinked but not
		// stored — MaruMori-only vocabulary never enters our knowledge state.
		t.Errorf("counts = %+v", *run.Counts)
	}

	// Status now carries totals and the last sync.
	rec = alice.do("GET", "/marumori", nil)
	mustJSON(t, rec, &status)
	if !status.Connected || status.LastSync == nil || status.Counts == nil {
		t.Fatalf("status = %+v, want connected with lastSync and counts", status)
	}
	if status.Counts.Kanji != 2 || status.Counts.Vocabulary != 1 {
		t.Errorf("totals = %+v, want 2 kanji 1 vocabulary", *status.Counts)
	}
	if status.Counts.VocabularyLinkRate != 1 {
		// Stored Known vocabulary is always linked: an unlinked item is counted in the
		// Sync's unlinked total but never stored as Known.
		t.Errorf("vocabularyLinkRate = %v, want 1", status.Counts.VocabularyLinkRate)
	}
	if status.Counts.LastSyncAt == nil {
		t.Error("counts.lastSyncAt is nil after a successful Sync")
	}

	// The run is listed newest-first.
	rec = alice.do("GET", "/marumori/syncs", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET syncs = %d %s", rec.Code, rec.Body)
	}
	var runs []api.MaruMoriSyncRun
	mustJSON(t, rec, &runs)
	if len(runs) != 1 || runs[0].Id != run.Id || runs[0].Status != api.MaruMoriSyncRunStatusOk {
		t.Fatalf("syncs = %+v, want the one ok run", runs)
	}

	// Disconnecting: 204, idempotent, and the synced knowledge stays.
	if rec = alice.do("DELETE", "/marumori/key", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE key = %d %s", rec.Code, rec.Body)
	}
	if rec = alice.do("DELETE", "/marumori/key", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("second DELETE = %d, want 204", rec.Code)
	}
	rec = alice.do("GET", "/marumori", nil)
	mustJSON(t, rec, &status)
	if status.Connected {
		t.Error("still connected after DELETE")
	}
	if status.Counts == nil || status.Counts.Kanji != 2 {
		t.Errorf("stored totals after disconnect = %+v, want the synced kanji kept", status.Counts)
	}

	// The key appears nowhere in any response, including the failed-path bodies below.
	alice.checkNoKeyLeak()
}

// --- validation and error mapping ---

func TestMaruMoriSetKeyValidation(t *testing.T) {
	m := newMarumoriEnv(t)
	alice := newMarumoriClient(t, m.e, "alice")

	for _, body := range []any{
		map[string]any{"apiKey": ""},          // empty
		map[string]any{"apiKey": "has space"}, // not a printable-ASCII run
		map[string]any{"apiKey": "日本語キー"},     // non-ASCII
		map[string]any{"apiKey": nil},         // wrong type
		map[string]any{},                      // missing
	} {
		rec := alice.do("PUT", "/marumori/key", body)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("PUT %v = %d, want 400 (%s)", body, rec.Code, rec.Body)
		}
		wantError(t, rec, http.StatusBadRequest, "invalid_key")
	}

	// Malformed JSON never reaches the Service: the request layer rejects it.
	if rec := alice.do("PUT", "/marumori/key", `{"apiKey": "unterminated`); rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed PUT = %d, want 400 (%s)", rec.Code, rec.Body)
	}

	if rec := alice.do("PUT", "/marumori/key", map[string]any{"apiKey": apiKey}); rec.Code != http.StatusOK {
		t.Fatalf("valid key = %d %s", rec.Code, rec.Body)
	}
	alice.checkNoKeyLeak()
}

func TestMaruMoriSyncWithoutKey(t *testing.T) {
	m := newMarumoriEnv(t)
	alice := newMarumoriClient(t, m.e, "alice")

	rec := alice.do("POST", "/marumori/sync", nil)
	wantError(t, rec, http.StatusBadRequest, "no_key")

	// A keyless Sync records no run: the syncs list stays empty.
	rec = alice.do("GET", "/marumori/syncs", nil)
	var runs []api.MaruMoriSyncRun
	mustJSON(t, rec, &runs)
	if len(runs) != 0 {
		t.Fatalf("syncs after keyless attempt = %+v, want none", runs)
	}
	alice.checkNoKeyLeak()
}

// blockingUpstream holds Home open so a second Sync can collide with the first.
type blockingUpstream struct {
	*marumoritest.FakeUpstream
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (b *blockingUpstream) Home(ctx context.Context) (marumori.Home, error) {
	b.once.Do(func() { close(b.entered) })
	select {
	case <-b.release:
	case <-ctx.Done():
		return marumori.Home{}, ctx.Err()
	}
	return b.FakeUpstream.Home(ctx)
}

func TestMaruMoriSyncWhileOneIsRunning(t *testing.T) {
	fake := &marumoritest.FakeUpstream{}
	happyMarumoriData(fake)
	blocked := &blockingUpstream{
		FakeUpstream: fake,
		entered:      make(chan struct{}),
		release:      make(chan struct{}),
	}
	m := newMarumoriEnvWith(t, blocked)
	alice := newMarumoriClient(t, m.e, "alice")
	alice.do("PUT", "/marumori/key", map[string]any{"apiKey": apiKey})

	firstDone := make(chan *httptest.ResponseRecorder, 1)
	go func() { firstDone <- alice.e.do(alice.t, "POST", "/marumori/sync", "Bearer "+alice.token, nil) }()

	<-blocked.entered // the first Sync is in flight upstream

	rec := alice.do("POST", "/marumori/sync", nil)
	wantError(t, rec, http.StatusConflict, "sync_running")

	close(blocked.release)
	select {
	case first := <-firstDone:
		if first.Code != http.StatusOK {
			t.Fatalf("first sync = %d %s", first.Code, first.Body)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("first sync never finished")
	}
	alice.checkNoKeyLeak()
}

func TestMaruMoriUpstreamFailureIsAFailedRunNotAnHTTPError(t *testing.T) {
	m := newMarumoriEnv(t)
	alice := newMarumoriClient(t, m.e, "alice")
	alice.do("PUT", "/marumori/key", map[string]any{"apiKey": apiKey})

	m.up.Err = &marumori.Error{Kind: marumori.ErrAuth, Status: 401, Detail: "invalid token"}

	rec := alice.do("POST", "/marumori/sync", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("failed sync status = %d, want 200 (%s)", rec.Code, rec.Body)
	}
	var run api.MaruMoriSyncRun
	mustJSON(t, rec, &run)
	if run.Status != api.MaruMoriSyncRunStatusFailed || run.Error == nil {
		t.Fatalf("run = %+v, want failed with an error", run)
	}
	if !strings.Contains(*run.Error, "API key") {
		t.Errorf("failure text = %q, want the API-key hint", *run.Error)
	}

	// A failed run is not the status page's lastSync, but it is the failure the
	// Learner last saw, and it is in the history.
	rec = alice.do("GET", "/marumori", nil)
	var status api.MaruMoriStatus
	mustJSON(t, rec, &status)
	if status.LastSync != nil {
		t.Errorf("lastSync = %+v, want only successful runs", status.LastSync)
	}
	if status.LastFailure == nil {
		t.Fatalf("lastFailure = nil, want the failed run")
	}
	if status.LastFailure.Status != api.MaruMoriSyncRunStatusFailed || status.LastFailure.Error == nil ||
		!strings.Contains(*status.LastFailure.Error, "API key") {
		t.Errorf("lastFailure = %+v, want the failed run with the API-key hint", status.LastFailure)
	}
	rec = alice.do("GET", "/marumori/syncs", nil)
	var runs []api.MaruMoriSyncRun
	mustJSON(t, rec, &runs)
	if len(runs) != 1 || runs[0].Status != api.MaruMoriSyncRunStatusFailed {
		t.Fatalf("syncs = %+v, want the failed run listed", runs)
	}

	// The failure text is scrubbed: the key (and any part of it) appears nowhere.
	alice.checkNoKeyLeak()
}

func TestMaruMoriLastFailureClearsAfterANewerSuccess(t *testing.T) {
	m := newMarumoriEnv(t)
	alice := newMarumoriClient(t, m.e, "alice")
	alice.do("PUT", "/marumori/key", map[string]any{"apiKey": apiKey})

	m.up.Err = &marumori.Error{Kind: marumori.ErrAuth, Status: 401, Detail: "invalid token"}
	if rec := alice.do("POST", "/marumori/sync", nil); rec.Code != http.StatusOK {
		t.Fatalf("failed sync = %d (%s)", rec.Code, rec.Body)
	}
	var status api.MaruMoriStatus
	mustJSON(t, alice.do("GET", "/marumori", nil), &status)
	if status.LastFailure == nil {
		t.Fatalf("lastFailure = nil after a failed run")
	}

	// A newer successful Sync supersedes the failure: the Learner's newest news is ok,
	// and the failed run stays where it belongs, in the history.
	m.up.Err = nil
	happyMarumoriData(m.up)
	if rec := alice.do("POST", "/marumori/sync", nil); rec.Code != http.StatusOK {
		t.Fatalf("sync after recovery = %d (%s)", rec.Code, rec.Body)
	}
	status = api.MaruMoriStatus{}
	mustJSON(t, alice.do("GET", "/marumori", nil), &status)
	if status.LastFailure != nil {
		t.Errorf("lastFailure = %+v, want nil once a newer run succeeded", status.LastFailure)
	}
	if status.LastSync == nil || status.LastSync.Status != api.MaruMoriSyncRunStatusOk {
		t.Errorf("lastSync = %+v, want the successful run", status.LastSync)
	}
	var runs []api.MaruMoriSyncRun
	mustJSON(t, alice.do("GET", "/marumori/syncs", nil), &runs)
	if len(runs) != 2 {
		t.Fatalf("syncs = %+v, want both runs in the history", runs)
	}
	alice.checkNoKeyLeak()
}

// --- auth and isolation ---

func TestMaruMoriEndpointsRequireAuth(t *testing.T) {
	m := newMarumoriEnv(t)
	for _, call := range []struct{ method, path string }{
		{"GET", "/marumori"}, {"POST", "/marumori/sync"}, {"GET", "/marumori/syncs"}, {"DELETE", "/marumori/key"},
	} {
		rec := m.e.do(t, call.method, call.path, "", nil)
		wantError(t, rec, http.StatusUnauthorized, "unauthorized")
	}
	rec := m.e.do(t, "PUT", "/marumori/key", "", map[string]any{"apiKey": apiKey})
	wantError(t, rec, http.StatusUnauthorized, "unauthorized")
}

func TestMaruMoriIsPerUser(t *testing.T) {
	m := newMarumoriEnv(t)
	happyMarumoriData(m.up)
	alice := newMarumoriClient(t, m.e, "alice")
	bob := newMarumoriClient(t, m.e, "bob")

	alice.do("PUT", "/marumori/key", map[string]any{"apiKey": apiKey})

	rec := bob.do("GET", "/marumori", nil)
	var status api.MaruMoriStatus
	mustJSON(t, rec, &status)
	if status.Connected {
		t.Fatal("bob sees alice's connection")
	}
	rec = bob.do("POST", "/marumori/sync", nil)
	wantError(t, rec, http.StatusBadRequest, "no_key")

	// bob's attempt left alice's store untouched.
	if _, _, _, _, ok := m.store.KnownItemLink(m.uid, marumorisync.KindKanji, "Kanji/1"); ok {
		t.Fatal("synced items appeared without alice syncing")
	}
	alice.checkNoKeyLeak()
	bob.checkNoKeyLeak()
}

func TestMaruMoriNotConfiguredIsAServiceError(t *testing.T) {
	// An httpapi.New without WithMaruMori (the pre-MaruMori wiring) answers 500.
	e := newEnv(t, fakeDB{})
	rec := e.do(t, "GET", "/marumori", "Bearer "+e.login(t, "alice"), nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (%s)", rec.Code, rec.Body)
	}
}
