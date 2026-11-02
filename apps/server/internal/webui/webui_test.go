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
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, target, nil))
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
