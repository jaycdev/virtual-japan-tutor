package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
)

type fakeDB struct{ err error }

func (f fakeDB) Ping(context.Context) error { return f.err }

func getHealth(t *testing.T, db httpapi.Pinger) (int, map[string]string) {
	t.Helper()
	rec := httptest.NewRecorder()
	httpapi.New(db).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
	var body map[string]string
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v (%q)", err, rec.Body.String())
	}
	return rec.Code, body
}

func TestHealthReportsDatabaseConnected(t *testing.T) {
	code, body := getHealth(t, fakeDB{})
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200", code)
	}
	if body["status"] != "ok" || body["database"] != "connected" {
		t.Fatalf("body = %v, want status=ok database=connected", body)
	}
}

func TestHealthReportsDatabaseUnreachable(t *testing.T) {
	code, body := getHealth(t, fakeDB{err: errors.New("connection refused")})
	if code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", code)
	}
	if body["status"] != "degraded" || body["database"] != "unreachable" {
		t.Fatalf("body = %v, want status=degraded database=unreachable", body)
	}
}
