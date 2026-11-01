package httpapi_test

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
)

// newChunked builds a request whose length is unknown (as with chunked uploads).
func newChunked(body string) *http.Request {
	req := httptest.NewRequest("POST", "/auth/login", io.NopCloser(strings.NewReader(body)))
	req.ContentLength = -1
	req.Header.Set("Content-Type", "application/json")
	return req
}

func serve(h http.Handler, req *http.Request) *httptest.ResponseRecorder {
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}
