package db_test

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/db"
)

// These tests need a real Postgres; set TEST_DATABASE_URL to run them (CI does).
func testURL(t *testing.T) string {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	return url
}

func TestOpenPingsAndMigrates(t *testing.T) {
	url := testURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	pool, err := db.Open(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()

	if err := pool.Ping(ctx); err != nil {
		t.Fatalf("ping: %v", err)
	}
	// Migrating twice must be a no-op the second time.
	if err := db.Migrate(ctx, url); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	if err := db.Migrate(ctx, url); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
}

// Open is lazy so the server can start (and /health can report "unreachable")
// while Postgres is down; Ping is what surfaces the failure.
func TestPingFailsWhenUnreachable(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := db.Open(ctx, "postgres://u:p@127.0.0.1:1/none?connect_timeout=1")
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err == nil {
		t.Fatal("expected ping error for unreachable database")
	}
}
