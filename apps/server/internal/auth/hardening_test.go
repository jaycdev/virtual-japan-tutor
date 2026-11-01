package auth_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
)

func fixtureWith(t *testing.T, opts auth.Options) (*auth.Service, *authtest.FakeClock) {
	t.Helper()
	clock := authtest.NewFakeClock()
	opts.TTL, opts.Now = sessionTTL, clock.Now
	svc := auth.NewService(authtest.NewMemStore(), opts)
	if _, err := svc.CreateUser(context.Background(), "Alice", goodPassword); err != nil {
		t.Fatal(err)
	}
	return svc, clock
}

// Over-length passwords must not distinguish a real account from a missing one: both get
// the same error, decided before the user is looked up, so no path does extra/less work.
func TestOverLengthPasswordIsRejectedIdenticallyForKnownAndUnknownUsers(t *testing.T) {
	svc, _ := fixtureWith(t, auth.Options{})
	long := strings.Repeat("p", 1025)
	_, errKnown := svc.Login(context.Background(), "alice", long)
	_, errUnknown := svc.Login(context.Background(), "ghost", long)
	if !errors.Is(errKnown, auth.ErrInvalidCredentials) || !errors.Is(errUnknown, auth.ErrInvalidCredentials) {
		t.Fatalf("errors = %v / %v, want ErrInvalidCredentials for both", errKnown, errUnknown)
	}
	if errKnown.Error() != errUnknown.Error() {
		t.Fatalf("error text differs: %q vs %q", errKnown, errUnknown)
	}
}

func TestOverLengthPasswordsCountTowardsLockoutForKnownAndUnknownAlike(t *testing.T) {
	svc, _ := fixtureWith(t, auth.Options{})
	long := strings.Repeat("p", 1025)
	for _, user := range []string{"alice", "ghost"} {
		var locked *auth.LockedError
		for i := 0; i < auth.DefaultMaxFailures+1; i++ {
			_, err := svc.Login(context.Background(), user, long)
			if errors.As(err, &locked) {
				break
			}
		}
		if locked == nil {
			t.Errorf("%s: never locked out by over-length attempts", user)
		}
	}
}

func TestUsernameIsNormalisedOnceForLookupAndLockout(t *testing.T) {
	svc, _ := fixtureWith(t, auth.Options{})
	ctx := context.Background()

	if _, err := svc.Login(ctx, "  ALICE\t", goodPassword); err != nil {
		t.Fatalf("padded, upper-case username did not log in: %v", err)
	}

	// Failures under different spellings of one name share a single lockout counter.
	spellings := []string{" alice", "ALICE ", "Alice", " aLiCe ", "alice"}
	for _, name := range spellings {
		if _, err := svc.Login(ctx, name, "wrong password!!"); !errors.Is(err, auth.ErrInvalidCredentials) {
			t.Fatalf("%q: %v", name, err)
		}
	}
	var locked *auth.LockedError
	if _, err := svc.Login(ctx, "alice", goodPassword); !errors.As(err, &locked) {
		t.Fatalf("spellings did not share a counter; err = %v", err)
	}
}

func TestTrackedFailuresAreCappedAndEvictOldestFirst(t *testing.T) {
	svc, clock := fixtureWith(t, auth.Options{MaxFailures: 2, MaxTracked: 3})
	ctx := context.Background()
	fail := func(name string) error {
		clock.Advance(time.Second) // distinct timestamps: eviction order is by age
		_, err := svc.Login(ctx, name, "wrong password!!")
		return err
	}
	isLocked := func(err error) bool { var l *auth.LockedError; return errors.As(err, &l) }

	for _, n := range []string{"n1", "n2", "n3"} {
		_ = fail(n)
	}
	_ = fail("n4") // table is full: evicts the oldest entry, n1
	if got := svc.TrackedNames(); got != 3 {
		t.Fatalf("TrackedNames = %d, want 3", got)
	}

	// n2 survived with its count: a second failure locks it, so the next attempt is refused.
	_ = fail("n2")
	if !isLocked(fail("n2")) {
		t.Fatal("n2 should still be tracked and locked after its second failure")
	}

	// n1 was evicted and forgotten: it needs two fresh failures before it is locked, so
	// its second failure here is still a plain bad-credentials answer, not a lockout.
	_ = fail("n1")
	if isLocked(fail("n1")) {
		t.Fatal("n1 kept its pre-eviction count; the oldest entry should have been forgotten")
	}
}
func TestAFloodOfFreshUsernamesDoesNotGrowMemoryOrFreeARealLockout(t *testing.T) {
	svc, clock := fixtureWith(t, auth.Options{MaxTracked: 5})
	ctx := context.Background()

	for i := 0; i < auth.DefaultMaxFailures; i++ { // lock the real user
		clock.Advance(time.Second)
		_, _ = svc.Login(ctx, "alice", "wrong password!!")
	}
	clock.Advance(time.Second)
	for i := 0; i < 30; i++ { // flood of fresh names, all newer than alice's entry (lock still active)
		_, _ = svc.Login(ctx, "flood-"+string(rune('a'+i%26))+string(rune('a'+i/26)), "wrong password!!")
	}
	if got := svc.TrackedNames(); got > 5 {
		t.Fatalf("TrackedNames = %d, want <= 5", got)
	}
	var locked *auth.LockedError
	if _, err := svc.Login(ctx, "alice", goodPassword); !errors.As(err, &locked) {
		t.Fatalf("the flood evicted the real user's lockout: %v", err)
	}
}

// Neither path may spend a password hash on an over-length password: the unknown-user
// path used to run the dummy hash while the known-user path returned early.
func TestOverLengthPasswordCostsNeitherPathAHash(t *testing.T) {
	svc, clock := fixtureWith(t, auth.Options{})
	ctx := context.Background()
	timeLogin := func(user, pass string) time.Duration {
		clock.Advance(time.Hour) // forget earlier failures
		start := time.Now()
		_, _ = svc.Login(ctx, user, pass)
		return time.Since(start)
	}
	baseline := timeLogin("alice", "wrong password!!") // one real hash
	long := strings.Repeat("p", 1025)
	for _, user := range []string{"alice", "ghost"} {
		if d := timeLogin(user, long); d > baseline/2 {
			t.Errorf("%s: over-length login took %v vs %v for a real hash check; it should be rejected before hashing", user, d, baseline)
		}
	}
}
