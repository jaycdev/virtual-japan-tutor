package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
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
