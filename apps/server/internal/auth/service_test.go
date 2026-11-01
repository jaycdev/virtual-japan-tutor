package auth_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
)

const (
	goodPassword = "correct horse battery"
	sessionTTL   = 24 * time.Hour
)

type fixture struct {
	svc   *auth.Service
	store *memStore
	clock *fakeClock
}

func newFixture(t *testing.T) fixture {
	t.Helper()
	store, clock := newMemStore(), newFakeClock()
	svc := auth.NewService(store, auth.Options{TTL: sessionTTL, Now: clock.Now})
	if _, err := svc.CreateUser(context.Background(), "Alice", goodPassword); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}
	return fixture{svc, store, clock}
}

func TestLoginIssuesATokenThatAuthenticatesTheUser(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	sess, err := f.svc.Login(ctx, "alice", goodPassword) // usernames are case-insensitive
	if err != nil {
		t.Fatalf("Login: %v", err)
	}
	if sess.User.Username != "Alice" {
		t.Fatalf("session user = %q, want Alice", sess.User.Username)
	}
	if want := f.clock.Now().Add(sessionTTL); !sess.ExpiresAt.Equal(want) {
		t.Fatalf("ExpiresAt = %v, want %v", sess.ExpiresAt, want)
	}

	id, err := f.svc.Authenticate(ctx, sess.Token)
	if err != nil {
		t.Fatalf("Authenticate: %v", err)
	}
	if id.ID != sess.User.ID || id.Username != "Alice" {
		t.Fatalf("identity = %+v, want user %+v", id.User, sess.User)
	}
}

func TestTokensAreRandomAndAtLeast256Bits(t *testing.T) {
	f := newFixture(t)
	a, _ := f.svc.Login(context.Background(), "alice", goodPassword)
	b, _ := f.svc.Login(context.Background(), "alice", goodPassword)
	if a.Token == b.Token {
		t.Fatal("two logins returned the same token")
	}
	raw, err := base64.RawURLEncoding.DecodeString(a.Token)
	if err != nil {
		t.Fatalf("token is not base64url: %v", err)
	}
	if len(raw) < 32 {
		t.Fatalf("token has %d bytes of entropy, want >= 32", len(raw))
	}
}

func TestOnlyAHashOfTheTokenIsStored(t *testing.T) {
	f := newFixture(t)
	sess, _ := f.svc.Login(context.Background(), "alice", goodPassword)

	keys := f.store.sessionKeys()
	if len(keys) != 1 {
		t.Fatalf("store holds %d sessions, want 1", len(keys))
	}
	sum := sha256.Sum256([]byte(sess.Token))
	if !bytes.Equal(keys[0], sum[:]) {
		t.Fatal("stored session key is not the SHA-256 of the token")
	}
	if strings.Contains(string(keys[0]), sess.Token) {
		t.Fatal("raw token stored")
	}
}

func TestSessionExpires(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	sess, _ := f.svc.Login(ctx, "alice", goodPassword)

	f.clock.Advance(sessionTTL - time.Second)
	if _, err := f.svc.Authenticate(ctx, sess.Token); err != nil {
		t.Fatalf("just before expiry: %v", err)
	}
	f.clock.Advance(time.Second)
	if _, err := f.svc.Authenticate(ctx, sess.Token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("at expiry: err = %v, want ErrUnauthenticated", err)
	}
}

func TestAuthenticateRejectsUnknownAndEmptyTokens(t *testing.T) {
	f := newFixture(t)
	for _, tok := range []string{"", "nope", strings.Repeat("A", 43)} {
		if _, err := f.svc.Authenticate(context.Background(), tok); !errors.Is(err, auth.ErrUnauthenticated) {
			t.Errorf("Authenticate(%q) = %v, want ErrUnauthenticated", tok, err)
		}
	}
}

func TestLogoutInvalidatesOnlyThatSession(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	a, _ := f.svc.Login(ctx, "alice", goodPassword)
	b, _ := f.svc.Login(ctx, "alice", goodPassword)

	id, err := f.svc.Authenticate(ctx, a.Token)
	if err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Logout(auth.WithIdentity(ctx, id)); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	if _, err := f.svc.Authenticate(ctx, a.Token); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("logged-out token still works: %v", err)
	}
	if _, err := f.svc.Authenticate(ctx, b.Token); err != nil {
		t.Fatalf("other session was invalidated: %v", err)
	}
}

func TestLogoutWithoutIdentityFails(t *testing.T) {
	f := newFixture(t)
	if err := f.svc.Logout(context.Background()); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("err = %v, want ErrUnauthenticated", err)
	}
}

func TestUnknownUserAndWrongPasswordAreIndistinguishable(t *testing.T) {
	f := newFixture(t)
	_, errBad := f.svc.Login(context.Background(), "alice", "wrong password!!")
	_, errUnknown := f.svc.Login(context.Background(), "mallory", "wrong password!!")
	if !errors.Is(errBad, auth.ErrInvalidCredentials) || !errors.Is(errUnknown, auth.ErrInvalidCredentials) {
		t.Fatalf("errors = %v / %v, want ErrInvalidCredentials for both", errBad, errUnknown)
	}
	if errBad.Error() != errUnknown.Error() {
		t.Fatalf("error text differs: %q vs %q", errBad, errUnknown)
	}
}

// An unknown username must cost about as much as a wrong password (a dummy hash is
// verified), otherwise response time reveals which usernames exist.
func TestUnknownUserTakesComparableTimeToWrongPassword(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	timeIt := func(user string) time.Duration {
		// Fresh usernames each time so lockout bookkeeping can never short-circuit.
		best := time.Hour
		for i := 0; i < 3; i++ {
			start := time.Now()
			_, _ = f.svc.Login(ctx, user, "wrong password!!")
			best = min(best, time.Since(start))
			f.clock.Advance(time.Hour)
		}
		return best
	}
	known, unknown := timeIt("alice"), timeIt("ghost")
	if unknown < known/2 {
		t.Fatalf("unknown user answered in %v vs %v for a wrong password: timing leaks existence", unknown, known)
	}
}

func TestRepeatedFailuresLockTheUsernameOutThenItRecovers(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	for i := 0; i < auth.DefaultMaxFailures; i++ {
		if _, err := f.svc.Login(ctx, "alice", "wrong password!!"); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("attempt %d: %v", i+1, err)
		}
	}

	// Locked: even the right password is refused, with a retry hint.
	_, err := f.svc.Login(ctx, "alice", goodPassword)
	var locked *auth.LockedError
	if !errors.As(err, &locked) {
		t.Fatalf("err = %v, want *LockedError", err)
	}
	if locked.RetryAfter <= 0 {
		t.Fatalf("RetryAfter = %v, want > 0", locked.RetryAfter)
	}

	f.clock.Advance(locked.RetryAfter + time.Second)
	if _, err := f.svc.Login(ctx, "alice", goodPassword); err != nil {
		t.Fatalf("after the lockout: %v", err)
	}
}

func TestLockoutDoesNotRevealWhetherTheUserExists(t *testing.T) {
	f := newFixture(t)
	for i := 0; i < auth.DefaultMaxFailures; i++ {
		_, _ = f.svc.Login(context.Background(), "ghost", "wrong password!!")
	}
	var locked *auth.LockedError
	if _, err := f.svc.Login(context.Background(), "ghost", "wrong password!!"); !errors.As(err, &locked) {
		t.Fatalf("unknown user not locked out: %v", err)
	}
}

func TestSuccessfulLoginResetsTheFailureCount(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	for round := 0; round < 3; round++ { // 3 x (max-1) failures would lock if never reset
		for i := 0; i < auth.DefaultMaxFailures-1; i++ {
			_, _ = f.svc.Login(ctx, "alice", "wrong password!!")
		}
		if _, err := f.svc.Login(ctx, "alice", goodPassword); err != nil {
			t.Fatalf("round %d: %v", round, err)
		}
	}
}

func TestRepeatedLockoutsBackOffLonger(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	lock := func() time.Duration {
		var locked *auth.LockedError
		for i := 0; i < 20; i++ {
			if _, err := f.svc.Login(ctx, "alice", "wrong password!!"); errors.As(err, &locked) {
				return locked.RetryAfter
			}
		}
		t.Fatal("never locked")
		return 0
	}
	first := lock()
	f.clock.Advance(first + time.Second)
	second := lock()
	if second <= first {
		t.Fatalf("second lockout %v is not longer than the first %v", second, first)
	}
}

func TestCreateUserValidatesAndRejectsDuplicates(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	for name, tc := range map[string]struct{ user, pass string }{
		"empty username":    {"", goodPassword},
		"blank username":    {"   ", goodPassword},
		"spaces inside":     {"a b", goodPassword},
		"control char":      {"al\x00ice", goodPassword},
		"too long username": {strings.Repeat("a", 65), goodPassword},
		"short password":    {"bob", "short"},
		"huge password":     {"bob", strings.Repeat("p", 1025)},
	} {
		if _, err := f.svc.CreateUser(ctx, tc.user, tc.pass); !errors.Is(err, auth.ErrInvalidInput) {
			t.Errorf("%s: err = %v, want ErrInvalidInput", name, err)
		}
	}
	if _, err := f.svc.CreateUser(ctx, "ALICE", goodPassword); !errors.Is(err, auth.ErrUsernameTaken) {
		t.Fatalf("duplicate (different case): err = %v, want ErrUsernameTaken", err)
	}
}

func TestBootstrapCreatesTheFirstUserOnlyWhenThereAreNone(t *testing.T) {
	store, clock := newMemStore(), newFakeClock()
	svc := auth.NewService(store, auth.Options{TTL: sessionTTL, Now: clock.Now})
	ctx := context.Background()

	created, err := svc.Bootstrap(ctx, "owner", goodPassword)
	if err != nil || !created {
		t.Fatalf("first Bootstrap = %v, %v; want true, nil", created, err)
	}
	if _, err := svc.Login(ctx, "owner", goodPassword); err != nil {
		t.Fatalf("bootstrapped user cannot log in: %v", err)
	}

	created, err = svc.Bootstrap(ctx, "someone-else", goodPassword)
	if err != nil || created {
		t.Fatalf("second Bootstrap = %v, %v; want false, nil", created, err)
	}
	if _, err := svc.Login(ctx, "someone-else", goodPassword); !errors.Is(err, auth.ErrInvalidCredentials) {
		t.Fatalf("second bootstrap created a user anyway: %v", err)
	}
}

func TestUserIDFromContext(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	if _, err := auth.UserID(ctx); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Fatalf("empty context: err = %v, want ErrUnauthenticated", err)
	}
	sess, _ := f.svc.Login(ctx, "alice", goodPassword)
	id, _ := f.svc.Authenticate(ctx, sess.Token)
	got, err := auth.UserID(auth.WithIdentity(ctx, id))
	if err != nil || got != sess.User.ID {
		t.Fatalf("UserID = %v, %v; want %v", got, err, sess.User.ID)
	}
}
