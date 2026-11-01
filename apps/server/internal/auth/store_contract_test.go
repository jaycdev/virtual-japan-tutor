package auth_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// The same behavioural contract runs against the in-memory fake and the Postgres store.
func TestMemStoreContract(t *testing.T) {
	storeContract(t, func(*testing.T) auth.Store { return newMemStore() })
}

func TestPostgresStoreContract(t *testing.T) {
	storeContract(t, func(t *testing.T) auth.Store { return auth.NewPostgresStore(dbtest.New(t)) })
}

func storeContract(t *testing.T, newStore func(*testing.T) auth.Store) {
	ctx := context.Background()
	now := time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

	t.Run("users are unique case-insensitively and found case-insensitively", func(t *testing.T) {
		s := newStore(t)
		u, err := s.CreateUser(ctx, "Alice", "hash-1")
		if err != nil {
			t.Fatal(err)
		}
		if u.ID == uuid.Nil || u.Username != "Alice" {
			t.Fatalf("user = %+v", u)
		}
		if _, err := s.CreateUser(ctx, "aLICE", "hash-2"); !errors.Is(err, auth.ErrUsernameTaken) {
			t.Fatalf("duplicate err = %v, want ErrUsernameTaken", err)
		}
		got, hash, err := s.UserByUsername(ctx, "ALICE")
		if err != nil || got != u || hash != "hash-1" {
			t.Fatalf("UserByUsername = %+v, %q, %v", got, hash, err)
		}
		if _, _, err := s.UserByUsername(ctx, "bob"); !errors.Is(err, auth.ErrNotFound) {
			t.Fatalf("unknown err = %v, want ErrNotFound", err)
		}
	})

	t.Run("CreateFirstUser only creates when the table is empty", func(t *testing.T) {
		s := newStore(t)
		u, created, err := s.CreateFirstUser(ctx, "owner", "h")
		if err != nil || !created || u.Username != "owner" {
			t.Fatalf("first = %+v, %v, %v", u, created, err)
		}
		if _, created, err := s.CreateFirstUser(ctx, "other", "h"); err != nil || created {
			t.Fatalf("second created = %v, err = %v; want false, nil", created, err)
		}
		if _, _, err := s.UserByUsername(ctx, "other"); !errors.Is(err, auth.ErrNotFound) {
			t.Fatalf("second user exists: %v", err)
		}
	})

	t.Run("sessions resolve to their owner until expiry or deletion", func(t *testing.T) {
		s := newStore(t)
		alice, _ := s.CreateUser(ctx, "alice", "h")
		bob, _ := s.CreateUser(ctx, "bob", "h")
		ta, tb := []byte("token-hash-alice-32-bytes-long!!"), []byte("token-hash-bob---32-bytes-long!!")
		for tok, owner := range map[*[]byte]uuid.UUID{&ta: alice.ID, &tb: bob.ID} {
			if err := s.CreateSession(ctx, *tok, owner, now, now.Add(time.Hour)); err != nil {
				t.Fatal(err)
			}
		}

		if u, err := s.SessionUser(ctx, ta, now.Add(time.Minute)); err != nil || u != alice {
			t.Fatalf("alice's session -> %+v, %v", u, err)
		}
		if u, err := s.SessionUser(ctx, tb, now.Add(time.Minute)); err != nil || u != bob {
			t.Fatalf("bob's session -> %+v, %v", u, err)
		}
		if _, err := s.SessionUser(ctx, []byte("unknown"), now); !errors.Is(err, auth.ErrNotFound) {
			t.Fatalf("unknown session err = %v", err)
		}
		if _, err := s.SessionUser(ctx, ta, now.Add(time.Hour)); !errors.Is(err, auth.ErrNotFound) {
			t.Fatalf("expired session err = %v, want ErrNotFound", err)
		}

		if err := s.DeleteSession(ctx, ta); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SessionUser(ctx, ta, now); !errors.Is(err, auth.ErrNotFound) {
			t.Fatalf("deleted session err = %v", err)
		}
		if _, err := s.SessionUser(ctx, tb, now); err != nil {
			t.Fatalf("deleting alice's session removed bob's: %v", err)
		}
		if err := s.DeleteSession(ctx, []byte("never-existed")); err != nil {
			t.Fatalf("deleting a missing session must not error: %v", err)
		}
	})
}
