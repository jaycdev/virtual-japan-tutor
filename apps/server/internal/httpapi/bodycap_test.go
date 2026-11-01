package httpapi_test

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
)

func bodyCapEnv(t *testing.T, opts ...httpapi.Option) env {
	t.Helper()
	svc := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour})
	if _, err := svc.CreateUser(context.Background(), "alice", password); err != nil {
		t.Fatal(err)
	}
	return env{h: httpapi.New(fakeDB{}, svc, opts...), svc: svc}
}

func TestOversizedBodyOnTheDefaultCapIs413OnPublicLogin(t *testing.T) {
	e := bodyCapEnv(t)
	big := `{"username":"alice","password":"` + strings.Repeat("x", 2<<20) + `"}`
	wantError(t, e.do(t, "POST", "/auth/login", "", big), http.StatusRequestEntityTooLarge, "payload_too_large")
}

func TestBodyCapIsConfigurableAndBoundaryIsInclusive(t *testing.T) {
	e := bodyCapEnv(t, httpapi.WithMaxBodyBytes(80))
	ok := `{"username":"alice","password":"` + password + `"}` // well under 80 bytes
	if rec := e.do(t, "POST", "/auth/login", "", ok); rec.Code != http.StatusOK {
		t.Fatalf("small body = %d: %s", rec.Code, rec.Body)
	}
	big := `{"username":"alice","password":"` + strings.Repeat("x", 100) + `"}`
	wantError(t, e.do(t, "POST", "/auth/login", "", big), http.StatusRequestEntityTooLarge, "payload_too_large")
}

func TestBodyCapAppliesWithoutAContentLength(t *testing.T) {
	e := bodyCapEnv(t, httpapi.WithMaxBodyBytes(64))
	req := newChunked(`{"username":"alice","password":"` + strings.Repeat("x", 500) + `"}`)
	rec := serve(e.h, req)
	wantError(t, rec, http.StatusRequestEntityTooLarge, "payload_too_large")
}

func TestOverLengthPasswordGivesKnownAndUnknownUsersTheSameResponse(t *testing.T) {
	e := bodyCapEnv(t)
	long := strings.Repeat("p", 2000)
	known := e.do(t, "POST", "/auth/login", "", map[string]string{"username": "alice", "password": long})
	unknown := e.do(t, "POST", "/auth/login", "", map[string]string{"username": "ghost", "password": long})
	wantError(t, known, http.StatusUnauthorized, "invalid_credentials")
	wantError(t, unknown, http.StatusUnauthorized, "invalid_credentials")
	if known.Body.String() != unknown.Body.String() {
		t.Fatalf("bodies differ: %q vs %q", known.Body, unknown.Body)
	}
}
