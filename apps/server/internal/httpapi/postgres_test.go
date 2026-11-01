package httpapi_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
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
