package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync/liveup"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

// The whole MaruMori feature end to end against the real API and real Postgres: the
// real handlers, the auth middleware, the sealed-key column, the Postgres-backed
// reference linker and the real *marumori.Client. Skipped unless MARUMORI_API_KEY
// (liveup) and TEST_DATABASE_URL (dbtest) are both set. This is the test that fails
// when MaruMori changes shape or a schema change breaks the knowledge-state SQL.

// liveMarumoriEnv is TestMaruMoriAgainstPostgres's wiring with the two fakes replaced:
// the upstream becomes the live client and the reference store becomes the Postgres one.
func liveMarumoriEnv(t *testing.T, pool *pgxpool.Pool) (*marumoriEnv, *liveup.Recorder) {
	t.Helper()
	up := liveup.Client(t)
	authSvc := auth.NewService(auth.NewPostgresStore(pool), auth.Options{TTL: time.Hour, PasswordParams: authtest.FastPasswordParams})
	alice, err := authSvc.CreateUser(context.Background(), "alice", password)
	if err != nil {
		t.Fatal(err)
	}
	box, err := secrets.NewFromKey(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	// The Service builds a fresh client per run from the decrypted key; route each
	// one through the Recorder so the assertions read what the live API returned.
	svc := marumorisync.NewService(marumorisync.NewPostgresStore(pool), box, refdata.NewStore(pool),
		func(baseURL, apiKey string) (marumorisync.Upstream, error) {
			c, err := marumori.New(baseURL, apiKey)
			if err != nil {
				return nil, err
			}
			up.Upstream = c
			return up, nil
		})
	m := &marumoriEnv{
		e:   env{h: httpapi.New(pool, authSvc, httpapi.WithMaruMori(svc)), svc: authSvc, clock: authtest.NewFakeClock()},
		uid: alice.ID,
	}
	return m, up
}

func TestLiveMaruMoriConnectSyncStatus(t *testing.T) {
	key := liveup.Key(t) // before dbtest.New: no schema is built when there is no key
	pool := dbtest.New(t)
	ctx := context.Background()
	m, up := liveMarumoriEnv(t, pool)
	alice := newMarumoriClient(t, m.e, "alice")

	rec := alice.do("GET", "/marumori", nil)
	var status api.MaruMoriStatus
	mustJSON(t, rec, &status)
	if rec.Code != http.StatusOK || status.Connected {
		t.Fatalf("initial GET /marumori = %d %+v, want 200 not-connected", rec.Code, status)
	}

	if rec = alice.do("PUT", "/marumori/key", map[string]any{"apiKey": key}); rec.Code != http.StatusOK {
		t.Fatalf("PUT key = %d %s", rec.Code, rec.Body)
	}
	var stored string
	if err := pool.QueryRow(ctx, `SELECT api_key_encrypted FROM marumori_settings WHERE user_id = $1`, m.uid).Scan(&stored); err != nil {
		t.Fatalf("key row: %v", err)
	}
	if !strings.HasPrefix(stored, "v1:") {
		t.Errorf("api key stored as %q, want v1: sealed ciphertext", stored)
	}
	liveup.NoLeak(t, "marumori_settings.api_key_encrypted", key, stored)

	if rec = alice.do("POST", "/marumori/sync", nil); rec.Code != http.StatusOK {
		t.Fatalf("POST sync = %d %s", rec.Code, rec.Body)
	}
	var run api.MaruMoriSyncRun
	mustJSON(t, rec, &run)
	if run.Status != api.MaruMoriSyncRunStatusOk || run.Counts == nil {
		t.Fatalf("sync run = %+v, want ok with counts", run)
	}
	liveup.CheckDrift(t, "live upstream", up)

	c := *run.Counts
	t.Logf("live sync over HTTP: %+v", c)
	// Self-consistency against what the client actually read. An unlinked
	// single-character kanji is both stored and counted in Unlinked, so the counts
	// reconcile against the stored rows, not against each other.
	if want := liveup.LevelZero(up.Kanji) + liveup.LevelZero(up.Vocabulary); c.SkippedLevelZero != want {
		t.Errorf("SkippedLevelZero = %d, want %d from the live lists", c.SkippedLevelZero, want)
	}

	// The rows mirror the Sync policy (ADR-0002) against the live data.
	var rows, storedVocabulary, linkedRows int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM marumori_known_items WHERE user_id = $1 AND kind = 'kanji'`, m.uid).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != c.Kanji {
		t.Errorf("stored kanji rows = %d, run counted %d", rows, c.Kanji)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM marumori_known_items WHERE user_id = $1 AND kind = 'vocabulary'`, m.uid).Scan(&storedVocabulary); err != nil {
		t.Fatal(err)
	}
	if storedVocabulary != c.Vocabulary {
		t.Errorf("stored vocabulary rows = %d, run counted %d", storedVocabulary, c.Vocabulary)
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM marumori_known_items
		WHERE user_id = $1 AND (kanji_literal IS NOT NULL OR jmdict_ent_seq IS NOT NULL)`, m.uid).Scan(&linkedRows); err != nil {
		t.Fatal(err)
	}
	if linkedRows != c.Linked {
		t.Errorf("linked rows = %d, run counted Linked = %d", linkedRows, c.Linked)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM marumori_known_items WHERE user_id = $1 AND kind = 'vocabulary' AND jmdict_ent_seq IS NULL`, m.uid).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("%d stored vocabulary rows are unlinked: MaruMori-only words must never be kept", rows)
	}
	// Every live Known item is stored or counted, exactly once each (S4 parity with
	// the memstore test): Unlinked = every Known item minus the linked ones.
	if want := liveup.KnownFilter(up.Kanji) + liveup.KnownFilter(up.Vocabulary) - c.Linked; c.Unlinked != want {
		t.Errorf("Unlinked = %d, want %d (all live Known items minus Linked)", c.Unlinked, want)
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM marumori_known_items
		WHERE user_id = $1 AND text IS NOT NULL AND (kanji_literal IS NOT NULL OR jmdict_ent_seq IS NOT NULL)`, m.uid).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("%d linked rows also carry MaruMori text: content must not survive a link", rows)
	}
	if err := pool.QueryRow(ctx, `
		SELECT count(*) FROM marumori_known_items
		WHERE user_id = $1 AND text IS NOT NULL AND length(text) > 1`, m.uid).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Errorf("%d unlinked rows keep multi-character text: only single-character kanji may do that", rows)
	}

	var storedHistory int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM marumori_known_item_history WHERE user_id = $1`, m.uid).Scan(&storedHistory); err != nil {
		t.Fatal(err)
	}
	if storedHistory != c.Kanji+c.Vocabulary {
		t.Errorf("history rows = %d, want one appeared entry per stored item (%d)", storedHistory, c.Kanji+c.Vocabulary)
	}
	var grammar int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM marumori_grammar_observations WHERE user_id = $1`, m.uid).Scan(&grammar); err != nil {
		t.Fatal(err)
	}
	// collect() stores every grammar observation with an id, merged across the two
	// endpoints: the rows must equal the live set, not merely fit inside it.
	if merged := len(liveup.UniqueIDs(up.Lessons, up.Reviews)); grammar != merged {
		t.Errorf("grammar rows = %d, want exactly %d merged live observations", grammar, merged)
	}
	var homeKanji int
	if err := pool.QueryRow(ctx, `SELECT kanji_learned FROM marumori_home_stats WHERE user_id = $1`, m.uid).Scan(&homeKanji); err != nil {
		t.Fatalf("home row: %v", err)
	}
	if homeKanji != up.HomeState.KanjiLearned {
		t.Errorf("home row kanji_learned = %d, client read %d", homeKanji, up.HomeState.KanjiLearned)
	}

	// Totals and the last run come back out of Postgres.
	if rec = alice.do("GET", "/marumori", nil); rec.Code != http.StatusOK {
		t.Fatalf("status GET = %d %s", rec.Code, rec.Body)
	}
	mustJSON(t, rec, &status)
	if !status.Connected || status.LastSync == nil || status.Counts == nil {
		t.Fatalf("status = %+v, want connected with lastSync and counts", status)
	}
	if status.LastSync.Id != run.Id {
		t.Errorf("lastSync = %+v, want the run just posted", status.LastSync)
	}
	if status.Counts.Kanji != c.Kanji || status.Counts.Vocabulary != c.Vocabulary {
		t.Errorf("totals = %+v, want the synced %d/%d", *status.Counts, c.Kanji, c.Vocabulary)
	}

	if rec = alice.do("GET", "/marumori/syncs", nil); rec.Code != http.StatusOK {
		t.Fatalf("GET syncs = %d %s", rec.Code, rec.Body)
	}
	var runs []api.MaruMoriSyncRun
	mustJSON(t, rec, &runs)
	if len(runs) != 1 || runs[0].Id != run.Id || runs[0].FinishedAt == nil {
		t.Errorf("sync history = %+v, want exactly the finished run", runs)
	}

	if rec = alice.do("DELETE", "/marumori/key", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE key = %d %s", rec.Code, rec.Body)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM marumori_settings WHERE user_id = $1`, m.uid).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	if rows != 0 {
		t.Error("the key row survived DELETE /marumori/key")
	}
	if rec = alice.do("GET", "/marumori", nil); rec.Code != http.StatusOK {
		t.Fatalf("status GET after delete = %d %s", rec.Code, rec.Body)
	}
	mustJSON(t, rec, &status)
	if status.Connected {
		t.Errorf("status = %+v, want not connected after DELETE /marumori/key", status)
	}

	// The live key must appear in no response body, in whole or in part. checkNoKeyLeak
	// only knows the package's fake key, so scan the recorded bodies for the real one.
	alice.checkNoKeyLeak()
	for _, body := range *alice.all {
		liveup.NoLeak(t, "response body", key, body)
	}
	liveup.NoLeak(t, "sync run error", key, func() string {
		if run.Error != nil {
			return *run.Error
		}
		return ""
	}())
}
