package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync/marumoritest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

// The same login/me/logout flow, but through the real Postgres store (skipped without
// TEST_DATABASE_URL). Catches SQL/schema drift the in-memory store cannot.
func TestLoginMeLogoutAgainstPostgres(t *testing.T) {
	pool := dbtest.New(t)
	svc := auth.NewService(auth.NewPostgresStore(pool), auth.Options{TTL: time.Hour})
	if _, err := svc.CreateUser(context.Background(), "alice", password); err != nil {
		t.Fatal(err)
	}
	e := env{h: httpapi.New(pool, svc), svc: svc}

	wantError(t, e.do(t, "GET", "/me", "", nil), http.StatusUnauthorized, "unauthorized")
	tok := e.login(t, "alice")
	if rec := e.do(t, "GET", "/me", "Bearer "+tok, nil); rec.Code != http.StatusOK {
		t.Fatalf("/me = %d: %s", rec.Code, rec.Body)
	}
	if rec := e.do(t, "POST", "/auth/logout", "Bearer "+tok, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("logout = %d", rec.Code)
	}
	wantError(t, e.do(t, "GET", "/me", "Bearer "+tok, nil), http.StatusUnauthorized, "unauthorized")
}

// The AI Provider API through the real Postgres store: the key is v1 ciphertext in the
// column, users are isolated, and the composite FK enforces the delete rule.
func TestAIProvidersAgainstPostgres(t *testing.T) {
	pool := dbtest.New(t)
	box, err := secrets.NewFromKey(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	svc := auth.NewService(auth.NewPostgresStore(pool), auth.Options{TTL: time.Hour})
	for _, n := range []string{"alice", "bob"} {
		if _, err := svc.CreateUser(context.Background(), n, password); err != nil {
			t.Fatal(err)
		}
	}
	ai := aiprovider.NewService(aiprovider.NewPostgresStore(pool), box)
	e := env{h: httpapi.New(pool, svc, httpapi.WithAIProviders(ai)), svc: svc, ai: ai}
	alice, bob := newAIClient(t, e, "alice"), newAIClient(t, e, "bob")

	p := alice.create("Main", "http://localhost:11434", apiKey)
	var stored string
	if err := pool.QueryRow(context.Background(), `SELECT api_key_encrypted FROM ai_providers WHERE id = $1`, p.Id).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	t.Logf("ai_providers.api_key_encrypted = %.40s...", stored)
	if !strings.HasPrefix(stored, "v1:") {
		t.Errorf("column holds %q, want v1: ciphertext", stored)
	}
	assertNoKey(t, "database column", stored)

	keyless := alice.create("Keyless", "http://localhost:11434", nil)
	var isNull bool
	_ = pool.QueryRow(context.Background(), `SELECT api_key_encrypted IS NULL FROM ai_providers WHERE id = $1`, keyless.Id).Scan(&isNull)
	if !isNull {
		t.Error("a keyless provider must store NULL")
	}

	wantError(t, bob.do("GET", "/ai-providers/"+p.Id.String(), nil), 404, "not_found")
	wantError(t, bob.do("PUT", "/ai-tasks/story", map[string]any{"providerId": p.Id}), 404, "not_found")
	if rec := alice.do("PUT", "/ai-tasks/story", map[string]any{"providerId": p.Id}); rec.Code != 200 {
		t.Fatalf("assign = %d %s", rec.Code, rec.Body)
	}
	wantError(t, alice.do("DELETE", "/ai-providers/"+p.Id.String(), nil), 409, "provider_in_use")
	alice.do("DELETE", "/ai-tasks/story", nil)
	if rec := alice.do("DELETE", "/ai-providers/"+p.Id.String(), nil); rec.Code != 204 {
		t.Fatalf("delete = %d %s", rec.Code, rec.Body)
	}
	wantError(t, alice.do("POST", "/ai-providers", map[string]any{"name": "keyless", "baseUrl": "http://x", "model": "m"}), 409, "name_taken")
}

// The MaruMori connect → sync → status → disconnect flow through the real Postgres
// Store (skipped without TEST_DATABASE_URL): the key is sealed ciphertext in its own
// table, a Sync writes linked items as links into reference data and unlinked kanji as
// MaruMori text only, unlinked vocabulary is counted but never stored, and removing the
// key keeps the learned items. The upstream stays the in-memory fake — tests never
// talk to MaruMori itself.
func TestMaruMoriAgainstPostgres(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	// The reference rows linked items point at.
	if _, err := pool.Exec(ctx, `INSERT INTO kanji (literal) VALUES ('水') ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES (1234, true) ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}

	up := &marumoritest.FakeUpstream{}
	happyMarumoriData(up)
	m := newMarumoriEnvWithStores(t, up, auth.NewPostgresStore(pool), marumorisync.NewPostgresStore(pool))
	alice := newMarumoriClient(t, m.e, "alice")

	rec := alice.do("GET", "/marumori", nil)
	var status api.MaruMoriStatus
	mustJSON(t, rec, &status)
	if rec.Code != http.StatusOK || status.Connected {
		t.Fatalf("initial GET /marumori = %d %+v, want 200 not-connected", rec.Code, status)
	}

	if rec = alice.do("PUT", "/marumori/key", map[string]any{"apiKey": apiKey}); rec.Code != http.StatusOK {
		t.Fatalf("PUT key = %d %s", rec.Code, rec.Body)
	}
	var stored string
	if err := pool.QueryRow(ctx, `SELECT api_key_encrypted FROM marumori_settings WHERE user_id = $1`, m.uid).Scan(&stored); err != nil {
		t.Fatalf("key row: %v", err)
	}
	if !strings.HasPrefix(stored, "v1:") {
		t.Errorf("api key stored as %q, want v1: sealed ciphertext", stored)
	}
	assertNoKey(t, "marumori_settings.api_key_encrypted", stored)

	if rec = alice.do("POST", "/marumori/sync", nil); rec.Code != http.StatusOK {
		t.Fatalf("POST sync = %d %s", rec.Code, rec.Body)
	}
	var run api.MaruMoriSyncRun
	mustJSON(t, rec, &run)
	if run.Status != api.MaruMoriSyncRunStatusOk || run.Counts == nil || run.Counts.Kanji != 2 || run.Counts.Vocabulary != 1 {
		t.Fatalf("sync run = %+v, want ok with 2 kanji / 1 vocabulary", run)
	}

	// The rows mirror the Sync policy: 水 is a link (no MaruMori text kept), 火 is an
	// unlinked kanji with its text, 日本 links JMdict 1234, and 日本语 — unlinked
	// vocabulary — is in the run's counts but nowhere in the knowledge state.
	var rows int
	for _, probe := range []struct {
		query string
		want  int
	}{
		{`SELECT count(*) FROM marumori_known_items WHERE user_id = $1 AND kind = 'kanji'`, 2},
		{`SELECT count(*) FROM marumori_known_items WHERE user_id = $1 AND kind = 'vocabulary'`, 1},
		{`SELECT count(*) FROM marumori_known_item_history WHERE user_id = $1`, 3},
	} {
		if err := pool.QueryRow(ctx, probe.query, m.uid).Scan(&rows); err != nil {
			t.Fatalf("count: %v", err)
		}
		if rows != probe.want {
			t.Errorf("%s = %d rows, want %d", probe.query, rows, probe.want)
		}
	}

	var waterText, fireText *string
	var entSeq *int64
	if err := pool.QueryRow(ctx, `SELECT text FROM marumori_known_items WHERE user_id = $1 AND kind = 'kanji' AND marumori_id = 'Kanji/1'`, m.uid).Scan(&waterText); err != nil {
		t.Fatalf("水 row: %v", err)
	}
	if waterText != nil {
		t.Errorf("linked 水 stores text %q, want NULL: the link covers the content", *waterText)
	}
	if err := pool.QueryRow(ctx, `SELECT text FROM marumori_known_items WHERE user_id = $1 AND kind = 'kanji' AND marumori_id = 'Kanji/2'`, m.uid).Scan(&fireText); err != nil {
		t.Fatalf("火 row: %v", err)
	}
	if fireText == nil || *fireText != "火" {
		t.Errorf("unlinked 火 stores text %v, want the MaruMori item text", fireText)
	}
	if err := pool.QueryRow(ctx, `SELECT jmdict_ent_seq FROM marumori_known_items WHERE user_id = $1 AND kind = 'vocabulary' AND marumori_id = 'VocabularyForms/1'`, m.uid).Scan(&entSeq); err != nil {
		t.Fatalf("日本 row: %v", err)
	}
	if entSeq == nil || *entSeq != 1234 {
		t.Errorf("日本 jmdict_ent_seq = %v, want 1234", entSeq)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM marumori_known_items WHERE user_id = $1 AND marumori_id = 'VocabularyForms/2'`, m.uid).Scan(&rows); err != nil {
		t.Fatalf("日本语 probe: %v", err)
	}
	if rows != 0 {
		t.Error("unlinked vocabulary was stored as Known")
	}

	// Totals and the last successful run come back out of Postgres.
	rec = alice.do("GET", "/marumori", nil)
	mustJSON(t, rec, &status)
	if status.Counts == nil || status.Counts.Kanji != 2 || status.Counts.Vocabulary != 1 || status.Counts.VocabularyLinkRate != 1 {
		t.Errorf("totals = %+v, want 2/1 with link rate 1", status.Counts)
	}
	if status.LastSync == nil || status.LastSync.Id != run.Id || status.Counts.LastSyncAt == nil {
		t.Errorf("lastSync = %+v counts.lastSyncAt = %v, want the finished run", status.LastSync, status.Counts.LastSyncAt)
	}

	if rec = alice.do("DELETE", "/marumori/key", nil); rec.Code != http.StatusNoContent {
		t.Fatalf("DELETE key = %d %s", rec.Code, rec.Body)
	}
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM marumori_settings WHERE user_id = $1`, m.uid).Scan(&rows); err != nil {
		t.Fatalf("settings count: %v", err)
	}
	if rows != 0 {
		t.Error("the key row survived DELETE /marumori/key")
	}
	rec = alice.do("GET", "/marumori", nil)
	mustJSON(t, rec, &status)
	if status.Connected {
		t.Error("still connected after deleting the key")
	}
	if status.Counts == nil || status.Counts.Kanji != 2 {
		t.Errorf("totals after disconnect = %+v, want the synced kanji kept", status.Counts)
	}

	alice.checkNoKeyLeak()
}
