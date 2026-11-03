package webui_test

import (
	"net/http"
	"testing"
)

// TestDeepLinkFallbackScratch is the #42 spike's probe for #51: it records
// what today's handler does with a client-side deep link like /stories/123.
// Such a path is not a file, so webui falls through to the API, which answers
// 404 - there is NO index.html fallback. Any client routing (Expo Router on
// mobile-web included) therefore breaks deep links on the Go server, and #51
// owns the decision to add the fallback (GET-only, non-API, file-miss) or to
// keep the web app at "/". This test asserts today's behaviour so it fails
// loudly if the fallback lands, at which point the expectation flips.
func TestDeepLinkFallbackScratch(t *testing.T) {
	rec := do(site(t), http.MethodGet, "/stories/123")
	if rec.Code != http.StatusTeapot || rec.Header().Get("X-From") != "api" {
		t.Fatalf("GET /stories/123 = %d (X-From %q): want today's fall-through to the API; "+
			"if this now serves index.html, update this scratch test - #51 added the fallback",
			rec.Code, rec.Header().Get("X-From"))
	}
}
