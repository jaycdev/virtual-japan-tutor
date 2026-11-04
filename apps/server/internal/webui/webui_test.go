package webui_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/webui"
)

// api stands in for the real handler: it answers 418 so a test can tell
// "the request fell through to the API" from "a file was served".
var api = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-From", "api")
	w.WriteHeader(http.StatusTeapot)
})

func site(t *testing.T) http.Handler {
	t.Helper()
	dir := t.TempDir()
	write := func(name, body string) {
		p := filepath.Join(dir, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	write("index.html", "<!doctype html><title>app</title>")
	write("assets/index-abc123.js", "console.log(1)")
	write("assets/style-def456.css", "body{}")
	write("favicon.svg", "<svg/>")
	h, err := webui.Handler(dir, api)
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func do(h http.Handler, method, target string) *httptest.ResponseRecorder {
	return doAccept(h, method, target, "")
}

// browserAccept is what a navigation request carries; fetch/openapi-fetch and
// curl/wget send `*/*` or nothing, modelled by the empty string.
const browserAccept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"

func doAccept(h http.Handler, method, target, accept string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, target, nil)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRootServesIndexUncached(t *testing.T) {
	rec := do(site(t), http.MethodGet, "/")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), "<title>app</title>") {
		t.Fatalf("GET / = %d %q, want the index page", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("index Cache-Control = %q, want no-cache (so a new release is picked up)", got)
	}
	if got := rec.Header().Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Fatalf("index Content-Type = %q", got)
	}
	if rec.Header().Get("X-Content-Type-Options") != "nosniff" || rec.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatalf("missing security headers: %v", rec.Header())
	}
}

func TestHashedAssetsAreImmutableWithTheRightType(t *testing.T) {
	h := site(t)
	js := do(h, http.MethodGet, "/assets/index-abc123.js")
	if js.Code != http.StatusOK || js.Body.String() != "console.log(1)" {
		t.Fatalf("asset = %d %q", js.Code, js.Body.String())
	}
	if got := js.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("asset Cache-Control = %q", got)
	}
	if got := js.Header().Get("Content-Type"); !strings.Contains(got, "javascript") {
		t.Fatalf("js Content-Type = %q, want a javascript type", got)
	}
	if got := do(h, http.MethodGet, "/assets/style-def456.css").Header().Get("Content-Type"); !strings.HasPrefix(got, "text/css") {
		t.Fatalf("css Content-Type = %q", got)
	}
	// Non-asset files are revalidated, not cached forever.
	if got := do(h, http.MethodGet, "/favicon.svg").Header().Get("Cache-Control"); got != "no-cache" {
		t.Fatalf("favicon Cache-Control = %q, want no-cache", got)
	}
}

func TestHeadIsServedToo(t *testing.T) {
	rec := do(site(t), http.MethodHead, "/")
	if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Fatalf("HEAD / = %d with %d body bytes", rec.Code, rec.Body.Len())
	}
}

func TestAnythingElseGoesToTheAPI(t *testing.T) {
	h := site(t)
	for _, tc := range []struct{ method, target string }{
		{http.MethodGet, "/health"},      // an API route
		{http.MethodGet, "/auth/login"},  // wrong method for the API is still the API's call
		{http.MethodPost, "/auth/login"}, // writes never touch files
		{http.MethodPost, "/"},           // even where a file exists
		{http.MethodPut, "/assets/index-abc123.js"},
		{http.MethodDelete, "/index.html"},
		{http.MethodGet, "/no-such-file.js"}, // unknown path: the API's 404, not a blank page
		{http.MethodGet, "/assets/"},         // a directory is never listed
		{http.MethodGet, "/assets"},
		{http.MethodGet, "//etc/passwd"},
		{http.MethodGet, "/../index.html"},
		{http.MethodGet, "/assets/../index.html"},
		{http.MethodGet, "/assets/./index-abc123.js"},
		{http.MethodGet, "/assets//index-abc123.js"},
	} {
		rec := do(h, tc.method, tc.target)
		if rec.Header().Get("X-From") != "api" || rec.Code != http.StatusTeapot {
			t.Errorf("%s %s = %d (X-From %q), want it handed to the API", tc.method, tc.target, rec.Code, rec.Header().Get("X-From"))
		}
	}
}

// TestDeepLinkServesTheAppShell is the fallback #51 added (flipping the #42
// scratch test): reloading a client-side route like /stories/123 is a browser
// navigation — GET with Accept: text/html and a path naming no file type —
// so it gets index.html (the app shell, Cache-Control: no-cache like "/"),
// and Expo Router restores the route from the URL.
func TestDeepLinkServesTheAppShell(t *testing.T) {
	h := site(t)
	for _, tc := range []struct{ method, target string }{
		{http.MethodGet, "/stories/123"},
		{http.MethodGet, "/settings/appearance"},
		{http.MethodGet, "/practice/session-7"},
		{http.MethodHead, "/stories/123"},
	} {
		rec := doAccept(h, tc.method, tc.target, browserAccept)
		if rec.Header().Get("X-From") != "" || rec.Code != http.StatusOK {
			t.Errorf("%s %s = %d (X-From %q), want the app shell not the API",
				tc.method, tc.target, rec.Code, rec.Header().Get("X-From"))
			continue
		}
		if tc.method == http.MethodHead {
			continue
		}
		if !strings.Contains(rec.Body.String(), "<title>app</title>") {
			t.Errorf("%s %s body = %q, want index.html", tc.method, tc.target, rec.Body.String())
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-cache" {
			t.Errorf("%s %s Cache-Control = %q, want no-cache like the index at /", tc.method, tc.target, got)
		}
	}
}

// TestAppShapedAPICallsReachTheAPI: the app itself fetches JSON on paths that
// look like its own routes (GET /stories/123). Those must stay API calls —
// only text/html Accept turns a file miss into the app shell.
func TestAppShapedAPICallsReachTheAPI(t *testing.T) {
	h := site(t)
	for _, tc := range []struct{ target, accept string }{
		{"/stories/123", ""},    // fetch default: no/`*/*` Accept
		{"/stories/123", "*/*"}, // curl/wget default
		{"/stories/123", "application/json"},
		{"/health", "*/*"}, // health checks: compose uses wget, same rule
		{"/dictionary/entries/404-miss", "*/*"},
	} {
		rec := doAccept(h, http.MethodGet, tc.target, tc.accept)
		if rec.Header().Get("X-From") != "api" || rec.Code != http.StatusTeapot {
			t.Errorf("GET %s (Accept %q) = %d (X-From %q), want the API's answer",
				tc.target, tc.accept, rec.Code, rec.Header().Get("X-From"))
		}
	}
}

// TestAssetMissesAreNotTheAppShell: a path naming a file type — e.g. a hashed
// bundle URL cached from a superseded release — 404s (here: the API's 404)
// even for a browser, instead of getting HTML where JS/CSS is expected.
func TestAssetMissesAreNotTheAppShell(t *testing.T) {
	h := site(t)
	for _, target := range []string{
		"/assets/index-deadbeef.js",
		"/_expo/static/js/web/index-deadbeef.js",
		"/fonts/NotoSansJP400-missing.woff2",
		"/no-such-page.json",
	} {
		rec := doAccept(h, http.MethodGet, target, browserAccept)
		if rec.Header().Get("X-From") != "api" || rec.Code != http.StatusTeapot {
			t.Errorf("GET %s = %d (X-From %q), want the API's 404, not index.html",
				target, rec.Code, rec.Header().Get("X-From"))
		}
	}
}

func TestRangeRequests(t *testing.T) {
	h := site(t)
	req := httptest.NewRequest(http.MethodGet, "/assets/index-abc123.js", nil)
	req.Header.Set("Range", "bytes=0-6")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusPartialContent || rec.Body.String() != "console" {
		t.Fatalf("range = %d %q, want 206 \"console\"", rec.Code, rec.Body.String())
	}
}

func TestHandlerRequiresAnIndexPage(t *testing.T) {
	if _, err := webui.Handler(t.TempDir(), api); err == nil || !strings.Contains(err.Error(), "index.html") {
		t.Fatalf("empty dir: err = %v, want an error naming index.html", err)
	}
	if _, err := webui.Handler(filepath.Join(t.TempDir(), "missing"), api); err == nil {
		t.Fatal("missing dir: want an error")
	}
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "index.html"), 0o755); err != nil {
		t.Fatal(err)
	}
	if _, err := webui.Handler(dir, api); err == nil {
		t.Fatal("index.html as a directory: want an error")
	}
}
