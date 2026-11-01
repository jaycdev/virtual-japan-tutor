package auth_test

import (
	"context"
	"errors"
	"slices"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// noteRepo is the reference pattern for every user-scoped repository (README: "Data
// conventions"): the user id comes from the request context via auth.UserID, never from
// a parameter, and every statement filters on it. The table below exists only in this test.
type noteRepo struct{ pool *pgxpool.Pool }

func (r noteRepo) Add(ctx context.Context, body string) error {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return err
	}
	_, err = r.pool.Exec(ctx, `INSERT INTO scoping_notes (user_id, body) VALUES ($1, $2)`, uid, body)
	return err
}

func (r noteRepo) List(ctx context.Context) ([]string, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	rows, err := r.pool.Query(ctx, `SELECT body FROM scoping_notes WHERE user_id = $1 ORDER BY id`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func TestOneUserCannotReadAnothersRowsThroughTheScopedRepository(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	if _, err := pool.Exec(ctx, `CREATE TABLE scoping_notes (
		id      bigserial PRIMARY KEY,
		user_id uuid NOT NULL REFERENCES users(id),
		body    text NOT NULL)`); err != nil {
		t.Fatal(err)
	}

	store := auth.NewPostgresStore(pool)
	svc := auth.NewService(store, auth.Options{TTL: sessionTTL})
	login := func(name string) context.Context {
		t.Helper()
		if _, err := svc.CreateUser(ctx, name, goodPassword); err != nil {
			t.Fatal(err)
		}
		sess, err := svc.Login(ctx, name, goodPassword)
		if err != nil {
			t.Fatal(err)
		}
		id, err := svc.Authenticate(ctx, sess.Token)
		if err != nil {
			t.Fatal(err)
		}
		return auth.WithIdentity(ctx, id)
	}
	alice, bob := login("alice"), login("bob")
	repo := noteRepo{pool}

	for _, n := range []string{"alice-1", "alice-2"} {
		if err := repo.Add(alice, n); err != nil {
			t.Fatal(err)
		}
	}
	if err := repo.Add(bob, "bob-1"); err != nil {
		t.Fatal(err)
	}

	if got, _ := repo.List(alice); !slices.Equal(got, []string{"alice-1", "alice-2"}) {
		t.Fatalf("alice sees %v", got)
	}
	if got, _ := repo.List(bob); !slices.Equal(got, []string{"bob-1"}) {
		t.Fatalf("bob sees %v", got)
	}

	// Without an authenticated identity there is no scope, so there is no query at all.
	if _, err := repo.List(ctx); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("unauthenticated List err = %v, want ErrUnauthenticated", err)
	}
	if err := repo.Add(ctx, "orphan"); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("unauthenticated Add err = %v, want ErrUnauthenticated", err)
	}
	var orphans int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM scoping_notes WHERE body = 'orphan'`).Scan(&orphans)
	if orphans != 0 {
		t.Fatal("an unauthenticated Add wrote a row")
	}
}
