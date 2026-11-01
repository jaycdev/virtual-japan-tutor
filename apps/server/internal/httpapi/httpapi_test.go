package httpapi_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider/aiprovidertest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

const password = "correct horse battery"

type fakeDB struct{ err error }

func (f fakeDB) Ping(context.Context) error { return f.err }

type env struct {
	h     http.Handler
	svc   *auth.Service
	clock *authtest.FakeClock
	ai    *aiprovider.Service
}

// newAI builds the AI Provider service over an in-memory store and a real secrets box.
// Retry waits are skipped so failure paths stay fast.
func newAI(t *testing.T) *aiprovider.Service {
	t.Helper()
	box, err := secrets.NewFromKey(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	return aiprovider.NewService(aiprovidertest.NewMemStore(), box, aiprovider.WithClientOptions(
		llm.WithSleep(func(context.Context, time.Duration) error { return nil }), llm.WithRand(func() float64 { return 0 })))
}

// newEnv serves the real handler over the real auth.Service backed by an in-memory store,
// with users alice and bob.
func newEnv(t *testing.T, db httpapi.Pinger) env {
	t.Helper()
	clock := authtest.NewFakeClock()
	svc := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour, Now: clock.Now})
	for _, name := range []string{"alice", "bob"} {
		if _, err := svc.CreateUser(context.Background(), name, password); err != nil {
			t.Fatal(err)
		}
	}
	ai := newAI(t)
	return env{h: httpapi.New(db, svc, httpapi.WithAIProviders(ai)), svc: svc, clock: clock, ai: ai}
}

func (e env) do(t *testing.T, method, path, authHeader string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var rd *bytes.Reader
	switch b := body.(type) {
	case nil:
		rd = bytes.NewReader(nil)
	case string:
		rd = bytes.NewReader([]byte(b))
	default:
		raw, _ := json.Marshal(b)
		rd = bytes.NewReader(raw)
	}
	req := httptest.NewRequest(method, path, rd)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if authHeader != "" {
		req.Header.Set("Authorization", authHeader)
	}
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func (e env) login(t *testing.T, user string) string {
	t.Helper()
	rec := e.do(t, "POST", "/auth/login", "", map[string]string{"username": user, "password": password})
	if rec.Code != http.StatusOK {
		t.Fatalf("login(%s) = %d %s", user, rec.Code, rec.Body)
	}
	var out struct{ Token string }
	mustJSON(t, rec, &out)
	return out.Token
}

func mustJSON(t *testing.T, rec *httptest.ResponseRecorder, into any) {
	t.Helper()
	if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
		t.Fatalf("response is not JSON: %v (%q)", err, rec.Body.String())
	}
}

// wantError asserts the consistent error body: {"code": ..., "message": ...}.
func wantError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d (body %s)", rec.Code, status, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json", ct)
	}
	var body struct{ Code, Message string }
	mustJSON(t, rec, &body)
	if body.Code != code || body.Message == "" {
		t.Fatalf("error body = %+v, want code %q and a message", body, code)
	}
}

// --- /health stays public ---

func getHealth(t *testing.T, db httpapi.Pinger, authHeader string) (int, map[string]string) {
	t.Helper()
	rec := newEnv(t, db).do(t, "GET", "/health", authHeader, nil)
	var body map[string]string
	mustJSON(t, rec, &body)
	return rec.Code, body
}

func TestHealthReportsDatabaseConnected(t *testing.T) {
	code, body := getHealth(t, fakeDB{}, "")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if body["status"] != "ok" || body["database"] != "connected" {
		t.Fatalf("body = %v, want status=ok database=connected", body)
	}
}

func TestHealthReportsDatabaseUnreachable(t *testing.T) {
	code, body := getHealth(t, fakeDB{err: errors.New("connection refused")}, "")
	if code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", code)
	}
	if body["status"] != "degraded" || body["database"] != "unreachable" {
		t.Fatalf("body = %v, want status=degraded database=unreachable", body)
	}
}

func TestHealthIgnoresAnyAuthorizationHeader(t *testing.T) {
	if code, _ := getHealth(t, fakeDB{}, "Bearer garbage"); code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
}

// --- authentication ---

func TestUnauthenticatedRequestsGet401WithAConsistentBody(t *testing.T) {
	e := newEnv(t, fakeDB{})
	valid := e.login(t, "alice")
	for name, header := range map[string]string{
		"no header":            "",
		"wrong scheme":         "Basic YWxpY2U6cGFzcw==",
		"empty bearer":         "Bearer ",
		"bearer no token":      "Bearer",
		"unknown token":        "Bearer " + strings.Repeat("A", 43),
		"token without scheme": valid,
	} {
		rec := e.do(t, "GET", "/me", header, nil)
		wantError(t, rec, http.StatusUnauthorized, "unauthorized")
		if got := rec.Header().Get("WWW-Authenticate"); !strings.HasPrefix(got, "Bearer") {
			t.Errorf("%s: WWW-Authenticate = %q, want a Bearer challenge", name, got)
		}
	}
}

func TestBearerSchemeIsCaseInsensitive(t *testing.T) {
	e := newEnv(t, fakeDB{})
	tok := e.login(t, "alice")
	if rec := e.do(t, "GET", "/me", "bearer "+tok, nil); rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
}

func TestExpiredTokenGets401(t *testing.T) {
	e := newEnv(t, fakeDB{})
	tok := e.login(t, "alice")
	e.clock.Advance(time.Hour)
	wantError(t, e.do(t, "GET", "/me", "Bearer "+tok, nil), http.StatusUnauthorized, "unauthorized")
}

// Every operation in the OpenAPI spec is authenticated unless it opts out with
// `security: []`. This walks the spec, so a new route that forgets protection (or a new
// public route that the middleware does not know about) fails here.
func TestEveryOperationInTheSpecIsProtectedUnlessItOptsOut(t *testing.T) {
	spec, err := api.GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	e := newEnv(t, fakeDB{})
	param := regexp.MustCompile(`\{[^}]+\}`)

	var secured, public int
	for path, item := range spec.Paths.Map() {
		for method, op := range item.Operations() {
			isPublic := op.Security != nil && len(*op.Security) == 0
			url := param.ReplaceAllString(path, "x")
			rec := e.do(t, method, url, "", nil)
			if isPublic {
				public++
				if rec.Code == http.StatusUnauthorized {
					t.Errorf("%s %s opts out of security but got 401", method, path)
				}
				continue
			}
			secured++
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("%s %s requires auth but answered %d without a token", method, path, rec.Code)
			}
		}
	}
	if secured < 2 || public < 2 {
		t.Fatalf("walked %d secured and %d public operations; the spec walk is not exercising anything", secured, public)
	}
}

// --- login ---

func TestLoginReturnsATokenThatOpensTheApi(t *testing.T) {
	e := newEnv(t, fakeDB{})
	rec := e.do(t, "POST", "/auth/login", "", map[string]string{"username": "Alice", "password": password})
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body)
	}
	var out struct {
		Token     string    `json:"token"`
		ExpiresAt time.Time `json:"expires_at"`
		User      struct{ ID, Username string }
	}
	mustJSON(t, rec, &out)
	if len(out.Token) < 43 || out.User.Username != "alice" && out.User.Username != "Alice" || out.User.ID == "" {
		t.Fatalf("login body = %+v", out)
	}
	if want := e.clock.Now().Add(time.Hour); !out.ExpiresAt.Equal(want) {
		t.Fatalf("expires_at = %v, want %v", out.ExpiresAt, want)
	}

	me := e.do(t, "GET", "/me", "Bearer "+out.Token, nil)
	if me.Code != http.StatusOK {
		t.Fatalf("/me = %d: %s", me.Code, me.Body)
	}
	var user struct{ ID, Username string }
	mustJSON(t, me, &user)
	if user.ID != out.User.ID || user.Username != "alice" {
		t.Fatalf("/me = %+v, login said %+v", user, out.User)
	}
}

func TestBadCredentialsAreIndistinguishable(t *testing.T) {
	e := newEnv(t, fakeDB{})
	wrong := e.do(t, "POST", "/auth/login", "", map[string]string{"username": "alice", "password": "nope-nope-nope"})
	unknown := e.do(t, "POST", "/auth/login", "", map[string]string{"username": "mallory", "password": "nope-nope-nope"})
	wantError(t, wrong, http.StatusUnauthorized, "invalid_credentials")
	wantError(t, unknown, http.StatusUnauthorized, "invalid_credentials")
	if wrong.Body.String() != unknown.Body.String() {
		t.Fatalf("bodies differ: %q vs %q", wrong.Body, unknown.Body)
	}
}

func TestRepeatedBadLoginsAreRateLimitedWithRetryAfter(t *testing.T) {
	e := newEnv(t, fakeDB{})
	bad := map[string]string{"username": "alice", "password": "nope-nope-nope"}
	for i := 0; i < auth.DefaultMaxFailures; i++ {
		wantError(t, e.do(t, "POST", "/auth/login", "", bad), http.StatusUnauthorized, "invalid_credentials")
	}
	rec := e.do(t, "POST", "/auth/login", "", map[string]string{"username": "alice", "password": password})
	wantError(t, rec, http.StatusTooManyRequests, "too_many_attempts")
	if secs, err := strconv.Atoi(rec.Header().Get("Retry-After")); err != nil || secs <= 0 {
		t.Fatalf("Retry-After = %q, want a positive number of seconds", rec.Header().Get("Retry-After"))
	}
}

func TestMalformedLoginBodyIs400WithTheErrorBody(t *testing.T) {
	e := newEnv(t, fakeDB{})
	wantError(t, e.do(t, "POST", "/auth/login", "", "{not json"), http.StatusBadRequest, "bad_request")
	wantError(t, e.do(t, "POST", "/auth/login", "", `{"username":"alice"}`), http.StatusBadRequest, "bad_request")
}

// --- logout ---

func TestLogoutInvalidatesTheToken(t *testing.T) {
	e := newEnv(t, fakeDB{})
	tok := e.login(t, "alice")
	other := e.login(t, "alice")

	if rec := e.do(t, "POST", "/auth/logout", "Bearer "+tok, nil); rec.Code != http.StatusNoContent {
		t.Fatalf("logout = %d: %s", rec.Code, rec.Body)
	}
	wantError(t, e.do(t, "GET", "/me", "Bearer "+tok, nil), http.StatusUnauthorized, "unauthorized")
	wantError(t, e.do(t, "POST", "/auth/logout", "Bearer "+tok, nil), http.StatusUnauthorized, "unauthorized")
	if rec := e.do(t, "GET", "/me", "Bearer "+other, nil); rec.Code != http.StatusOK {
		t.Fatalf("logging out one session ended another: %d", rec.Code)
	}
}

// --- user scoping ---

func TestAuthenticatedCallsAreScopedToTheTokensUser(t *testing.T) {
	e := newEnv(t, fakeDB{})
	alice, bob := e.login(t, "alice"), e.login(t, "bob")

	who := func(tok string) string {
		rec := e.do(t, "GET", "/me", "Bearer "+tok, nil)
		var u struct{ Username string }
		mustJSON(t, rec, &u)
		return u.Username
	}
	if got := who(alice); got != "alice" {
		t.Fatalf("alice's token resolves to %q", got)
	}
	if got := who(bob); got != "bob" {
		t.Fatalf("bob's token resolves to %q", got)
	}
	// A user id supplied by the client is never trusted: there is no way to ask for another's /me.
	if rec := e.do(t, "GET", "/me?user_id=00000000-0000-0000-0000-000000000000", "Bearer "+alice, nil); rec.Code != http.StatusOK || who(alice) != "alice" {
		t.Fatalf("query parameters must not change the principal (status %d)", rec.Code)
	}
}
