package main

import (
	"context"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/config"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

// The env-seeded default provider, against real Postgres (skipped without TEST_DATABASE_URL):
// only for a sole user, only while they have no providers, idempotent across restarts, and
// the key lands in the database as v1 ciphertext.
func TestSeedAIDefaultOnlyForTheSoleUserAndOnlyOnce(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	box, err := secrets.NewFromKey(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	ai := aiprovider.NewService(aiprovider.NewPostgresStore(pool), box)
	cfg := config.Config{AIDefaultBaseURL: "http://litellm:4000/v1", AIDefaultModel: "gpt-x", AIDefaultAPIKey: "sk-seeded-SECRET"}

	// No users yet: nothing to seed for.
	if seeded, err := seedAIDefault(ctx, pool, ai, cfg); err != nil || seeded {
		t.Fatalf("no users: seeded=%v err=%v", seeded, err)
	}

	svc := auth.NewService(auth.NewPostgresStore(pool), auth.Options{TTL: time.Hour})
	alice, err := svc.CreateUser(ctx, "alice", "correct horse battery")
	if err != nil {
		t.Fatal(err)
	}
	if seeded, err := seedAIDefault(ctx, pool, ai, cfg); err != nil || !seeded {
		t.Fatalf("sole user: seeded=%v err=%v", seeded, err)
	}
	if seeded, err := seedAIDefault(ctx, pool, ai, cfg); err != nil || seeded {
		t.Fatalf("second boot: seeded=%v err=%v; must be idempotent", seeded, err)
	}

	for _, task := range aiprovider.Tasks {
		r, err := ai.ResolveProvider(ctx, alice.ID, task)
		if err != nil || r.Config.APIKey != "sk-seeded-SECRET" || r.Provider.Name != "Default" {
			t.Errorf("task %s: %+v, %v", task, r, err)
		}
	}
	var stored string
	if err := pool.QueryRow(ctx, `SELECT api_key_encrypted FROM ai_providers WHERE user_id = $1`, alice.ID).Scan(&stored); err != nil {
		t.Fatal(err)
	}
	if len(stored) < 4 || stored[:3] != "v1:" || contains(stored, "SECRET") {
		t.Errorf("database holds %q, want v1 ciphertext", stored)
	}

	// With a second user the "only user" rule no longer holds: nothing is seeded for either.
	if _, err := svc.CreateUser(ctx, "bob", "correct horse battery"); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `DELETE FROM ai_task_assignments; DELETE FROM ai_providers`); err != nil {
		t.Fatal(err)
	}
	if seeded, err := seedAIDefault(ctx, pool, ai, cfg); err != nil || seeded {
		t.Fatalf("two users: seeded=%v err=%v", seeded, err)
	}
}

func TestSeedAIDefaultIsANoOpWhenNotConfigured(t *testing.T) {
	// No database needed: nothing is configured, so nothing is touched.
	if seeded, err := seedAIDefault(context.Background(), nil, nil, config.Config{}); err != nil || seeded {
		t.Fatalf("seeded=%v err=%v", seeded, err)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
