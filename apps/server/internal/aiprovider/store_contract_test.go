package aiprovider_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider/aiprovidertest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// The same behavioural contract runs against the in-memory fake and the Postgres store.
func TestMemStoreContract(t *testing.T) {
	storeContract(t, func(*testing.T) (aiprovider.Store, func(string) uuid.UUID) {
		m := aiprovidertest.NewMemStore()
		return m, func(string) uuid.UUID { return uuid.New() }
	})
}

func TestPostgresStoreContract(t *testing.T) {
	storeContract(t, func(t *testing.T) (aiprovider.Store, func(string) uuid.UUID) {
		pool := dbtest.New(t)
		return aiprovider.NewPostgresStore(pool), func(name string) uuid.UUID { return insertUser(t, pool, name) }
	})
}

func insertUser(t *testing.T, pool *pgxpool.Pool, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func rec(name string) aiprovider.Record {
	enc := "v1:cipher-" + name
	return aiprovider.Record{Name: name, BaseURL: "https://api.example.com/v1", Model: "m", APIKeyEncrypted: &enc}
}

func storeContract(t *testing.T, newStore func(*testing.T) (aiprovider.Store, func(string) uuid.UUID)) {
	ctx := context.Background()

	t.Run("create, get, list and update round-trip", func(t *testing.T) {
		s, mkUser := newStore(t)
		u := mkUser("alice")
		a, err := s.Create(ctx, u, rec("OpenAI"))
		if err != nil || a.ID == uuid.Nil || a.CreatedAt.IsZero() || a.APIKeyEncrypted == nil || *a.APIKeyEncrypted != "v1:cipher-OpenAI" {
			t.Fatalf("Create = %+v, %v", a, err)
		}
		b, _ := s.Create(ctx, u, aiprovider.Record{Name: "Ollama", BaseURL: "http://localhost:11434/v1", Model: "llama3"})
		if b.APIKeyEncrypted != nil {
			t.Fatalf("keyless provider stored a key: %+v", b)
		}
		got, err := s.Get(ctx, u, a.ID)
		if err != nil || got.ID != a.ID || got.Name != "OpenAI" {
			t.Fatalf("Get = %+v, %v", got, err)
		}
		list, _ := s.List(ctx, u)
		if len(list) != 2 || list[0].ID != a.ID || list[1].ID != b.ID {
			t.Fatalf("List = %+v, want oldest first", list)
		}

		a.Name, a.Model, a.APIKeyEncrypted = "OpenAI main", "gpt-x", nil
		up, err := s.Update(ctx, u, a)
		if err != nil || up.Name != "OpenAI main" || up.Model != "gpt-x" || up.APIKeyEncrypted != nil || up.UpdatedAt.Before(up.CreatedAt) {
			t.Fatalf("Update = %+v, %v", up, err)
		}
		if _, err := s.Update(ctx, u, aiprovider.Record{ID: uuid.New(), Name: "x", BaseURL: "http://x/v1", Model: "m"}); !errors.Is(err, aiprovider.ErrNotFound) {
			t.Fatalf("Update unknown err = %v", err)
		}
	})

	t.Run("names are unique per user, case-insensitively", func(t *testing.T) {
		s, mkUser := newStore(t)
		alice, bob := mkUser("alice"), mkUser("bob")
		a, _ := s.Create(ctx, alice, rec("Main"))
		if _, err := s.Create(ctx, alice, rec("main")); !errors.Is(err, aiprovider.ErrNameTaken) {
			t.Fatalf("duplicate err = %v, want ErrNameTaken", err)
		}
		if _, err := s.Create(ctx, bob, rec("Main")); err != nil {
			t.Fatalf("another user may reuse a name: %v", err)
		}
		other, _ := s.Create(ctx, alice, rec("Other"))
		other.Name = "MAIN"
		if _, err := s.Update(ctx, alice, other); !errors.Is(err, aiprovider.ErrNameTaken) {
			t.Fatalf("rename onto existing err = %v", err)
		}
		a.Name = "MAIN" // renaming to a different case of itself is fine
		if _, err := s.Update(ctx, alice, a); err != nil {
			t.Fatalf("self rename: %v", err)
		}
	})

	t.Run("users cannot see, change, delete or assign each other's providers", func(t *testing.T) {
		s, mkUser := newStore(t)
		alice, bob := mkUser("alice"), mkUser("bob")
		a, _ := s.Create(ctx, alice, rec("A"))

		if _, err := s.Get(ctx, bob, a.ID); !errors.Is(err, aiprovider.ErrNotFound) {
			t.Errorf("bob Get err = %v", err)
		}
		if list, _ := s.List(ctx, bob); len(list) != 0 {
			t.Errorf("bob List = %+v", list)
		}
		hijack := a
		hijack.Name = "hijacked"
		if _, err := s.Update(ctx, bob, hijack); !errors.Is(err, aiprovider.ErrNotFound) {
			t.Errorf("bob Update err = %v", err)
		}
		if err := s.Delete(ctx, bob, a.ID); !errors.Is(err, aiprovider.ErrNotFound) {
			t.Errorf("bob Delete err = %v", err)
		}
		if err := s.Assign(ctx, bob, aiprovider.TaskStory, &a.ID); !errors.Is(err, aiprovider.ErrNotFound) {
			t.Errorf("bob Assign alice's provider err = %v", err)
		}
		if m, _ := s.Assignments(ctx, bob); len(m) != 0 {
			t.Errorf("bob assignments = %v", m)
		}
		still, err := s.Get(ctx, alice, a.ID)
		if err != nil || still.Name != "A" {
			t.Errorf("alice's provider was touched: %+v, %v", still, err)
		}
	})

	t.Run("assignments: set, replace, clear, and block deleting an assigned provider", func(t *testing.T) {
		s, mkUser := newStore(t)
		u := mkUser("alice")
		a, _ := s.Create(ctx, u, rec("A"))
		b, _ := s.Create(ctx, u, rec("B"))

		if err := s.Assign(ctx, u, aiprovider.TaskStory, &a.ID); err != nil {
			t.Fatal(err)
		}
		if err := s.Assign(ctx, u, aiprovider.TaskStory, &b.ID); err != nil { // replace
			t.Fatal(err)
		}
		if err := s.Assign(ctx, u, aiprovider.TaskGrammarContent, &a.ID); err != nil {
			t.Fatal(err)
		}
		m, _ := s.Assignments(ctx, u)
		if len(m) != 2 || m[aiprovider.TaskStory] != b.ID || m[aiprovider.TaskGrammarContent] != a.ID {
			t.Fatalf("assignments = %v", m)
		}
		if err := s.Assign(ctx, u, aiprovider.TaskStory, ptr(uuid.New())); !errors.Is(err, aiprovider.ErrNotFound) {
			t.Fatalf("assign unknown provider err = %v", err)
		}

		if err := s.Delete(ctx, u, b.ID); !errors.Is(err, aiprovider.ErrInUse) {
			t.Fatalf("delete assigned err = %v, want ErrInUse", err)
		}
		if _, err := s.Get(ctx, u, b.ID); err != nil {
			t.Fatalf("provider vanished despite ErrInUse: %v", err)
		}
		if err := s.Assign(ctx, u, aiprovider.TaskStory, nil); err != nil { // clear
			t.Fatal(err)
		}
		if err := s.Delete(ctx, u, b.ID); err != nil {
			t.Fatalf("delete after unassign: %v", err)
		}
		if err := s.Delete(ctx, u, b.ID); !errors.Is(err, aiprovider.ErrNotFound) {
			t.Fatalf("second delete err = %v", err)
		}
	})

	t.Run("CreateDefaultIfNone seeds once and assigns every task", func(t *testing.T) {
		s, mkUser := newStore(t)
		u := mkUser("alice")
		created, err := s.CreateDefaultIfNone(ctx, u, rec("Default"), aiprovider.Tasks)
		if err != nil || !created {
			t.Fatalf("first = %v, %v", created, err)
		}
		created, err = s.CreateDefaultIfNone(ctx, u, rec("Default"), aiprovider.Tasks)
		if err != nil || created {
			t.Fatalf("second = %v, %v; want false, nil", created, err)
		}
		list, _ := s.List(ctx, u)
		m, _ := s.Assignments(ctx, u)
		if len(list) != 1 || len(m) != len(aiprovider.Tasks) {
			t.Fatalf("providers=%d assignments=%v", len(list), m)
		}
		// A user who already has a provider is left alone.
		v := mkUser("bob")
		_, _ = s.Create(ctx, v, rec("Mine"))
		if created, _ := s.CreateDefaultIfNone(ctx, v, rec("Default"), aiprovider.Tasks); created {
			t.Fatal("seeded a user who already had a provider")
		}
	})
}

func ptr[T any](v T) *T { return &v }
