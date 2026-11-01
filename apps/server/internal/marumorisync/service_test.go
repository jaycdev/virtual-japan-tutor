package marumorisync_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync/marumoritest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

const testKey = "QZXPFX-middle-secret-SFXQZX"

// fakeRef is a canned marumorisync.Reference: kanji found by literal, vocabulary
// matches by written text (the service always searches with reading "").
type fakeRef struct {
	kanji map[string]refdata.Kanji
	vocab map[string][]refdata.Vocabulary
}

func (r *fakeRef) FindKanji(_ context.Context, literal string) (refdata.Kanji, bool, error) {
	k, ok := r.kanji[literal]
	return k, ok, nil
}

func (r *fakeRef) FindVocabulary(_ context.Context, written, reading string) ([]refdata.Vocabulary, error) {
	if reading != "" {
		return nil, nil // the linker never passes a reading
	}
	return r.vocab[written], nil
}

func vocab(entSeq int64, level refdata.Level) refdata.Vocabulary {
	return refdata.Vocabulary{JMdictEntry: refdata.JMdictEntry{EntSeq: entSeq}, JLPTLevel: level}
}

func kanji(literal string) refdata.Kanji {
	return refdata.Kanji{KanjidicEntry: refdata.KanjidicEntry{Literal: literal}}
}

type env struct {
	store *marumoritest.MemStore
	up    *marumoritest.FakeUpstream
	ref   *fakeRef
	svc   *marumorisync.Service
	box   *secrets.Box
	uid   uuid.UUID
	ctx   context.Context
	now   time.Time
}

func newEnv(t *testing.T, refs *fakeRef) *env {
	t.Helper()
	now := time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	e := &env{
		store: marumoritest.NewMemStore(),
		up:    &marumoritest.FakeUpstream{},
		ref:   refs,
		uid:   uuid.New(),
		now:   now,
	}
	e.ctx = auth.WithIdentity(context.Background(), auth.Identity{User: auth.User{ID: e.uid}})
	box, err := secrets.NewFromKey(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	e.box = box
	e.svc = marumorisync.NewService(e.store, box, e.ref,
		func(_, _ string) (marumorisync.Upstream, error) { return e.up, nil },
		marumorisync.WithClock(func() time.Time { t := e.now; e.now = t.Add(time.Second); return t }))
	return e
}

func (e *env) connect(t *testing.T) {
	t.Helper()
	if err := e.svc.SetAPIKey(e.ctx, testKey); err != nil {
		t.Fatal(err)
	}
}

func known(id, text string, level int) marumori.KnownItem {
	return marumori.KnownItem{MaruMoriID: id, Text: text, Level: level}
}

// happyData fills the fake upstream: two kanji (one in KANJIDIC, one not), three
// vocabulary (one exact link, one unmatched, one ambiguous between N5 and N3), one
// level-0 item, and grammar observations.
func testRefs() *fakeRef {
	return &fakeRef{
		kanji: map[string]refdata.Kanji{"水": kanji("水")},
		vocab: map[string][]refdata.Vocabulary{
			"日本":   {vocab(1234, refdata.N5)},
			"難しい文": {vocab(30, refdata.N5), vocab(20, refdata.N3)},
		},
	}
}

func happyData(up *marumoritest.FakeUpstream) {
	up.Kanji = []marumori.KnownItem{
		known("Kanji/1", "水", 2),
		known("Kanji/2", "火", 1),
		known("Kanji/3", "目", 0), // learning, not Known
	}
	up.Vocabulary = []marumori.KnownItem{
		known("VocabularyForms/1", "日本", 3),
		known("VocabularyForms/2", "日本语", 1), // no JMdict match (a MaruMori-only spelling)
		known("VocabularyForms/3", "難しい文", 2),
	}
	up.Lessons = []marumori.GrammarObservation{{MaruMoriID: "Grammar/101"}}
	up.Reviews = []marumori.GrammarObservation{
		{MaruMoriID: "Grammar/202", Level: i(3)},
		{MaruMoriID: "Grammar/203", Level: i(5), Suspended: b(true)},
	}
	up.HomeState = marumori.Home{KanjiLearned: 42, VocabularyLearned: 77}
}

func TestSyncHappyPathLinksStoresAndCounts(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)

	run, err := e.svc.Sync(e.ctx)
	if err != nil || run.Status != marumorisync.RunOK {
		t.Fatalf("Sync = %+v, %v", run, err)
	}
	want := marumorisync.Counts{
		Kanji: 2, Vocabulary: 2, GrammarLessons: 1, GrammarReviews: 2,
		Linked: 3, Unlinked: 2, Ambiguous: 1, New: 4, SkippedLevelZero: 1,
	}
	if run.Counts == nil || *run.Counts != want {
		t.Fatalf("counts = %+v, want %+v", run.Counts, want)
	}
	if e.up.CallsOf("/home") != 1 || e.up.CallsOf("/known/kanji") != 1 || e.up.CallsOf("/known/vocabulary") != 1 ||
		e.up.CallsOf("/srs/grammar-lessons") != 1 || e.up.CallsOf("/srs/grammar-reviews") != 1 {
		t.Errorf("upstream calls = %v, want each endpoint once", e.up.Calls)
	}

	// Linked kanji keeps only the link; unlinked kanji keeps only the MaruMori text.
	if level, _, literal, text, ok := e.store.KnownItemLink(e.uid, marumorisync.KindKanji, "Kanji/1"); !ok ||
		level != 2 || literal == nil || *literal != "水" || text != nil {
		t.Errorf("水 link = %v %v %v %v", level, literal, text, ok)
	}
	if level, _, literal, text, ok := e.store.KnownItemLink(e.uid, marumorisync.KindKanji, "Kanji/2"); !ok ||
		level != 1 || literal != nil || text == nil || *text != "火" {
		t.Errorf("火 link = %v %v %v %v", level, literal, text, ok)
	}
	// The level-0 item was skipped entirely.
	if _, _, _, _, ok := e.store.KnownItemLink(e.uid, marumorisync.KindKanji, "Kanji/3"); ok {
		t.Error("level-0 kanji was stored")
	}
	// The ambiguous vocabulary picked the easiest JLPT Level.
	if _, entSeq, _, text, ok := e.store.KnownItemLink(e.uid, marumorisync.KindVocabulary, "VocabularyForms/3"); !ok ||
		entSeq == nil || *entSeq != 30 || text != nil {
		t.Errorf("ambiguous pick = ent %v text %v ok %v, want ent 30", entSeq, text, ok)
	}

	// History: everything appeared.
	h := e.store.HistoryRows()
	if len(h) != 4 {
		t.Fatalf("history = %+v, want 4 appeared rows", h)
	}
	for _, entry := range h {
		if entry.Change != marumorisync.ChangeAppeared || entry.NewLevel == nil || entry.OldLevel != nil {
			t.Errorf("history row = %+v, want appeared with new level", entry)
		}
	}
	// Grammar and home survived the Sync.
	if len(e.store.GrammarRows()) != 3 {
		t.Errorf("grammar rows = %d, want 3", len(e.store.GrammarRows()))
	}
	if h := e.store.HomeRow(); h.KanjiLearned != 42 {
		t.Errorf("home = %+v", h)
	}

	// Status now reports the connection, the run, and the totals.
	st, err := e.svc.Status(e.ctx)
	if err != nil || !st.Connected || st.LastSync == nil || st.LastSync.ID != run.ID {
		t.Fatalf("status = %+v, %v", st, err)
	}
	if st.Totals == nil || st.Totals.Kanji != 2 || st.Totals.Vocabulary != 2 || st.Totals.VocabularyLinked != 2 {
		t.Errorf("totals = %+v, want 2/2 with 2 linked", st.Totals)
	}
	runs, err := e.svc.RecentSyncs(e.ctx)
	if err != nil || len(runs) != 1 || runs[0].ID != run.ID {
		t.Errorf("recent syncs = %+v, %v", runs, err)
	}
}

func TestReSyncWithNoChangesProducesNoHistory(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)
	if _, err := e.svc.Sync(e.ctx); err != nil {
		t.Fatal(err)
	}
	run, err := e.svc.Sync(e.ctx)
	if err != nil || run.Status != marumorisync.RunOK {
		t.Fatalf("second Sync = %+v, %v", run, err)
	}
	want := marumorisync.Counts{
		Kanji: 2, Vocabulary: 2, GrammarLessons: 1, GrammarReviews: 2,
		Linked: 3, Unlinked: 2, Ambiguous: 1, New: 0, LevelChanges: 0, Disappeared: 0, SkippedLevelZero: 1,
	}
	if run.Counts == nil || *run.Counts != want {
		t.Fatalf("second counts = %+v, want %+v", run.Counts, want)
	}
	if h := e.store.HistoryRows(); len(h) != 4 {
		t.Errorf("history grew on an unchanged Sync: %d rows", len(h))
	}
}

func TestSyncRecordsLevelChangesAndDisappearances(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)
	if _, err := e.svc.Sync(e.ctx); err != nil {
		t.Fatal(err)
	}

	// 水 levels up, 火 is no longer known, 川 is new, 日本 drops to level 0 (learning).
	e.up.Kanji = []marumori.KnownItem{known("Kanji/1", "水", 5), known("Kanji/9", "川", 1)}
	e.up.Vocabulary = []marumori.KnownItem{
		known("VocabularyForms/1", "日本", 0),
		known("VocabularyForms/2", "日本语", 1),
		known("VocabularyForms/3", "難しい文", 2),
	}
	run, err := e.svc.Sync(e.ctx)
	if err != nil || run.Status != marumorisync.RunOK {
		t.Fatalf("Sync = %+v, %v", run, err)
	}
	c := run.Counts
	if c == nil || c.New != 1 || c.LevelChanges != 1 || c.Disappeared != 2 || c.SkippedLevelZero != 1 {
		t.Fatalf("counts = %+v, want new 1, changes 1, disappeared 2, skipped 1", c)
	}

	var sawLevelChange, sawDisappeared int
	for _, h := range e.store.HistoryRows() {
		switch h.Change {
		case marumorisync.ChangeLevelChanged:
			sawLevelChange++
			if h.MaruMoriID != "Kanji/1" || h.OldLevel == nil || *h.OldLevel != 2 || h.NewLevel == nil || *h.NewLevel != 5 {
				t.Errorf("level_changed row = %+v, want 水 2→5", h)
			}
		case marumorisync.ChangeDisappeared:
			sawDisappeared++
			if h.OldLevel == nil {
				t.Errorf("disappeared row lost its old level: %+v", h)
			}
		}
	}
	if sawLevelChange != 1 || sawDisappeared != 2 {
		t.Fatalf("history changes = %d/%d, want 1 changed 2 disappeared (rows: %+v)",
			sawLevelChange, sawDisappeared, e.store.HistoryRows())
	}
	// The level-0 vocabulary is no longer a Known Item.
	kl, _ := e.store.KnownLevels(e.ctx, e.uid)
	for _, k := range kl {
		if k.MaruMoriID == "VocabularyForms/1" {
			t.Error("level-0 vocabulary stayed Known")
		}
	}
}

func TestUpstreamFailureBecomesAFailedRunNotAnHTTPError(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	e.up.Err = &marumori.Error{Kind: marumori.ErrAuth, Status: 401, Detail: "invalid api key: " + testKey}

	run, err := e.svc.Sync(e.ctx)
	if err != nil {
		t.Fatalf("a failed Sync must return the run, got err %v", err)
	}
	if run.Status != marumorisync.RunFailed || run.Counts != nil {
		t.Fatalf("run = %+v, want failed without counts", run)
	}
	if run.Error == nil || !strings.Contains(*run.Error, "API key") {
		t.Fatalf("run error = %v, want learner-facing key advice", run.Error)
	}
	assertNoKeyFragment(t, "run error", *run.Error)
	// Nothing was stored, and the failure is in the Sync history.
	if kl, _ := e.store.KnownLevels(e.ctx, e.uid); len(kl) != 0 {
		t.Errorf("a failed Sync stored items: %+v", kl)
	}
	runs, _ := e.svc.RecentSyncs(e.ctx)
	if len(runs) != 1 || runs[0].Status != marumorisync.RunFailed {
		t.Fatalf("recent syncs = %+v", runs)
	}
	st, err := e.svc.Status(e.ctx)
	if err != nil || !st.Connected || st.LastSync != nil || st.Totals != nil {
		t.Errorf("status after a failed first Sync = %+v, %v; want connected with no successful data", st, err)
	}
}

func assertNoKeyFragment(t *testing.T, where, s string) {
	t.Helper()
	for _, frag := range []string{testKey, "QZXPFX", "SFXQZX", "middle-secret"} {
		if strings.Contains(s, frag) {
			t.Errorf("%s leaks (part of) the API key %q: %s", where, frag, s)
		}
	}
}

// TestLongFailureMessageKeepsWholeCharacters: MaruMori's own detail text is mostly
// Japanese, and slicing it by bytes leaves the Learner with half a character.
func TestLongFailureMessageKeepsWholeCharacters(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	e.up.Err = errors.New(strings.Repeat("マーモリ日本語エラー ", 300)) // multi-byte throughout

	run, err := e.svc.Sync(e.ctx)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != marumorisync.RunFailed || run.Error == nil {
		t.Fatalf("run = %+v, want a failed run with a message", run)
	}
	message := *run.Error
	if len(message) > 2000 {
		t.Errorf("message is %d bytes, want at most 2000", len(message))
	}
	if !utf8.ValidString(message) {
		t.Errorf("message cuts a rune in half, tail = %q", message[len(message)-12:])
	}
	if !strings.HasSuffix(message, "…") {
		t.Errorf("message tail = %q, want the truncation marker", message[len(message)-8:])
	}
	if !strings.HasPrefix(message, "MaruMori sync failed: マーモリ") {
		t.Errorf("message lost its head: %q", message)
	}
}

func TestSyncWithoutAKeyIsRejectedBeforeARunStarts(t *testing.T) {
	e := newEnv(t, testRefs())
	_, err := e.svc.Sync(e.ctx)
	if !errors.Is(err, marumorisync.ErrNoKey) {
		t.Fatalf("err = %v, want ErrNoKey", err)
	}
	if runs, _ := e.svc.RecentSyncs(e.ctx); len(runs) != 0 {
		t.Errorf("a run was recorded for a keyless Sync: %+v", runs)
	}
}

// cutShortStore wraps a Store and cuts the caller's context the way a request deadline
// does, immediately after one write succeeds. It also refuses writes on a context that is
// already done, which is what Postgres does: that is how a cancelled request can turn into
// a lost run outcome.
type cutShortStore struct {
	marumorisync.Store
	after string // "apply": cut the context once the batch is written
	done  context.CancelFunc
}

func (s cutShortStore) StartRun(ctx context.Context, userID, runID uuid.UUID, startedAt time.Time) error {
	if ctx.Err() != nil {
		return fmt.Errorf("start run: %w", ctx.Err())
	}
	return s.Store.StartRun(ctx, userID, runID, startedAt)
}

func (s cutShortStore) ApplySync(ctx context.Context, userID, runID uuid.UUID, batch marumorisync.SyncBatch) error {
	if ctx.Err() != nil {
		return fmt.Errorf("record synced knowledge: %w", ctx.Err())
	}
	if err := s.Store.ApplySync(ctx, userID, runID, batch); err != nil {
		return err
	}
	if s.after == "apply" {
		s.done()
	}
	return nil
}

func (s cutShortStore) FinishRun(ctx context.Context, userID, runID uuid.UUID, finishedAt time.Time, failure *string, counts *marumorisync.Counts) error {
	if ctx.Err() != nil {
		return fmt.Errorf("finish run: %w", ctx.Err())
	}
	return s.Store.FinishRun(ctx, userID, runID, finishedAt, failure, counts)
}

// cancelOnRead cancels the caller's context at one endpoint read, which is what happens to
// a Sync whose Learner navigated away: the fetch in flight is cut short.
type cancelOnRead struct {
	marumorisync.Upstream
	at     string
	cancel context.CancelFunc
}

func (c cancelOnRead) GrammarReviews(ctx context.Context) ([]marumori.GrammarObservation, error) {
	if c.at == "reviews" {
		c.cancel()
	}
	return c.Upstream.GrammarReviews(ctx)
}

// TestSyncOutcomeIsRecordedWhenTheRequestIsCancelled guards the guarantee the Store
// interface documents for StartRun: a round must leave its run row closed. Postgres refuses
// writes on a done context, so closing a run on the caller's context hands a cancelled
// request the power to leave the Learner locked out until the stale-run window reaps the
// row. The outcome is written on a context the caller no longer controls.
func TestSyncOutcomeIsRecordedWhenTheRequestIsCancelled(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)

	ctx, cancel := context.WithCancel(e.ctx)
	defer cancel()
	svc := marumorisync.NewService(cutShortStore{e.store, "apply", cancel}, e.box, e.ref,
		func(_, _ string) (marumorisync.Upstream, error) { return e.up, nil },
		marumorisync.WithClock(func() time.Time { t := e.now; e.now = t.Add(time.Second); return t }))

	run, err := svc.SyncUser(ctx, e.uid)
	if err != nil {
		t.Fatalf("SyncUser = %+v, %v; want the round recorded despite the cut-short request", run, err)
	}
	if run.Status != marumorisync.RunOK {
		t.Errorf("run = %+v, want completed", run)
	}
	runs, _ := e.svc.RecentSyncs(e.ctx)
	if len(runs) != 1 || runs[0].Status != marumorisync.RunOK {
		t.Fatalf("stored runs = %+v, want the completed round", runs)
	}
}

// The same guarantee for a round cut short before it could finish: it must close its run as
// a failure instead of leaving the row 'running', which is what blocks the Learner's next
// Sync.
func TestCancelledRoundClosesItsRunAsFailed(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)

	ctx, cancel := context.WithCancel(e.ctx)
	defer cancel()
	svc := marumorisync.NewService(cutShortStore{e.store, "", cancel}, e.box, e.ref,
		func(_, _ string) (marumorisync.Upstream, error) {
			return cancelOnRead{e.up, "reviews", cancel}, nil
		},
		marumorisync.WithClock(func() time.Time { t := e.now; e.now = t.Add(time.Second); return t }))

	run, err := svc.SyncUser(ctx, e.uid)
	if err != nil {
		t.Fatalf("SyncUser err = %v, want the failure recorded as a run", err)
	}
	if run.Status != marumorisync.RunFailed {
		t.Errorf("run = %+v, want failed", run)
	}
	runs, _ := e.svc.RecentSyncs(e.ctx)
	if len(runs) != 1 || runs[0].Status != marumorisync.RunFailed {
		t.Fatalf("stored runs = %+v, want one failed round, not one left running", runs)
	}
	// The Learner can Sync again: no abandoned row blocks them.
	if _, err := e.svc.Sync(e.ctx); err != nil {
		t.Errorf("the abandoned run blocked the next Sync: %v", err)
	}
}

func TestConcurrentSyncIsRejected(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)
	if err := e.store.StartRun(e.ctx, e.uid, uuid.New(), time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.Sync(e.ctx); !errors.Is(err, marumorisync.ErrSyncRunning) {
		t.Fatalf("err = %v, want ErrSyncRunning", err)
	}
}

func TestUnreadableStoredKeyFailsTheRunWithAdvice(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)
	// Swap in a Service whose box cannot decrypt what the first one stored.
	otherKey := make([]byte, 32)
	otherKey[0] = 1
	badBox, err := secrets.NewFromKey(otherKey)
	if err != nil {
		t.Fatal(err)
	}
	badSvc := marumorisync.NewService(e.store, badBox, e.ref,
		func(_, _ string) (marumorisync.Upstream, error) { return e.up, nil })
	run, err := badSvc.SyncUser(e.ctx, e.uid)
	if err != nil {
		t.Fatalf("SyncUser = %+v, %v", run, err)
	}
	if run.Status != marumorisync.RunFailed || run.Error == nil || !strings.Contains(*run.Error, "SECRETS_KEY") {
		t.Fatalf("run = %+v, want failed with SECRETS_KEY advice", run)
	}
	if e.up.CallsOf("/known/kanji") != 0 {
		t.Error("upstream was read despite an unreadable key")
	}
}

func TestSetAPIKeyValidatesWithoutStoring(t *testing.T) {
	e := newEnv(t, testRefs())
	for _, bad := range []string{"", "   ", "has space", "tab\tinside", strings.Repeat("k", 4097)} {
		if err := e.svc.SetAPIKey(e.ctx, bad); !errors.Is(err, marumorisync.ErrInvalidKey) {
			t.Errorf("SetAPIKey(%q) err = %v, want ErrInvalidKey", bad, err)
		}
	}
	if _, err := e.store.GetSettings(e.ctx, e.uid); !errors.Is(err, marumorisync.ErrNoKey) {
		t.Error("an invalid key was stored")
	}
	if err := e.svc.SetAPIKey(e.ctx, testKey); err != nil {
		t.Fatal(err)
	}
	// The stored ciphertext is not the key, and Status never shows it.
	set, err := e.store.GetSettings(e.ctx, e.uid)
	if err != nil || set.APIKeyEncrypted == "" || strings.Contains(set.APIKeyEncrypted, testKey) {
		t.Fatalf("settings = %+v, %v; key stored in the clear?", set, err)
	}
	st, err := e.svc.Status(e.ctx)
	if err != nil || !st.Connected {
		t.Fatalf("status = %+v, %v", st, err)
	}
}

func TestRemoveKeyKeepsKnowledgeAndStopsSyncing(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)
	if _, err := e.svc.Sync(e.ctx); err != nil {
		t.Fatal(err)
	}
	if err := e.svc.RemoveAPIKey(e.ctx); err != nil {
		t.Fatal(err)
	}
	st, err := e.svc.Status(e.ctx)
	if err != nil || st.Connected {
		t.Fatalf("status after removal = %+v, %v", st, err)
	}
	kl, _ := e.store.KnownLevels(e.ctx, e.uid)
	if len(kl) != 4 {
		t.Errorf("knowledge dropped with the key: %d items", len(kl))
	}
	if _, err := e.svc.Sync(e.ctx); !errors.Is(err, marumorisync.ErrNoKey) {
		t.Errorf("sync after removal err = %v", err)
	}
	// Removing again is harmless.
	if err := e.svc.RemoveAPIKey(e.ctx); err != nil {
		t.Errorf("second removal: %v", err)
	}
}

func TestSyncWithoutAuthenticatedContextFails(t *testing.T) {
	e := newEnv(t, testRefs())
	if _, err := e.svc.Sync(context.Background()); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("err = %v, want ErrUnauthenticated", err)
	}
	if _, err := e.svc.Status(context.Background()); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("Status err = %v", err)
	}
}

func TestScheduledSyncCoversEveryConnectedUser(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	other := uuid.New()
	otherCtx := auth.WithIdentity(context.Background(), auth.Identity{User: auth.User{ID: other}})
	otherSvc := marumorisync.NewService(e.store, e.box, e.ref,
		func(_, _ string) (marumorisync.Upstream, error) { return e.up, nil })
	if err := otherSvc.SetAPIKey(otherCtx, testKey); err != nil {
		t.Fatal(err)
	}
	happyData(e.up)
	if err := e.svc.SyncScheduled(context.Background()); err != nil {
		t.Fatal(err)
	}
	// Both connected users were synced; the fake upstream served two full Syncs.
	if e.up.CallsOf("/known/kanji") != 2 {
		t.Errorf("kanji reads = %d, want 2 (one per connected user)", e.up.CallsOf("/known/kanji"))
	}
	for _, u := range []uuid.UUID{e.uid, other} {
		kl, _ := e.store.KnownLevels(context.Background(), u)
		if len(kl) != 4 {
			t.Errorf("user %v got %d items, want 4", u, len(kl))
		}
	}
}

func TestScheduledSyncSurvivesOneBadUser(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	other := uuid.New()
	if _, err := e.store.SetAPIKey(context.Background(), other, "v1:bad", time.Now()); err != nil {
		t.Fatal(err)
	}
	happyData(e.up)
	// The second user's key cannot be decrypted by this box: their Sync fails as a run,
	// and the sweep continues with the rest.
	if err := e.svc.SyncScheduled(context.Background()); err != nil {
		t.Fatalf("scheduled sweep failed outright: %v", err)
	}
	runs, _ := e.store.RecentRuns(context.Background(), other, 10)
	if len(runs) != 1 || runs[0].Status != marumorisync.RunFailed {
		t.Errorf("bad user's runs = %+v, want one failed run", runs)
	}
	kl, _ := e.store.KnownLevels(context.Background(), e.uid)
	if len(kl) != 4 {
		t.Errorf("good user was skipped: %d items", len(kl))
	}
}

func TestServiceClockIsInjectable(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)
	run, err := e.svc.Sync(e.ctx)
	if err != nil {
		t.Fatal(err)
	}
	st, err := e.svc.Status(e.ctx)
	if err != nil || st.ConnectedAt == nil {
		t.Fatalf("status = %+v, %v", st, err)
	}
	// Every timestamp came from the injected clock, in order: connect, start, finish.
	if !(st.ConnectedAt.Before(run.StartedAt) || st.ConnectedAt.Equal(run.StartedAt)) {
		t.Errorf("ConnectedAt %v not before StartedAt %v", st.ConnectedAt, run.StartedAt)
	}
	if run.FinishedAt == nil || run.FinishedAt.Before(run.StartedAt) {
		t.Errorf("run.FinishedAt = %v, want after StartedAt %v", run.FinishedAt, run.StartedAt)
	}
	if run.StartedAt.After(e.now) {
		t.Errorf("run.StartedAt %v is ahead of the injected clock (%v)", run.StartedAt, e.now)
	}
}
