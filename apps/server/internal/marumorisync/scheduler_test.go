package marumorisync_test

import (
	"context"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
)

func TestSchedulerSweepsBetweenCancelsAndStopsCleanly(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var delays []time.Duration
	wait := func(ctx context.Context, d time.Duration) error {
		delays = append(delays, d)
		if len(delays) == 3 {
			cancel() // "time passes, then the server shuts down"
		}
		return ctx.Err()
	}
	sched := marumorisync.NewScheduler(e.svc, time.Hour,
		marumorisync.WithSweepWait(wait),
		marumorisync.WithRandom(func() float64 { return 0 }))

	if err := sched.Run(ctx); err != nil {
		t.Fatalf("Run = %v, want nil on clean shutdown", err)
	}
	// Three waits were taken, but the third ended in cancellation: only two sweeps ran.
	if len(delays) != 3 {
		t.Fatalf("waits = %d, want 3", len(delays))
	}
	if n := e.up.CallsOf("/known/kanji"); n != 2 {
		t.Errorf("sweeps = %d (/known/kanji calls), want 2", n)
	}
	if kl, _ := e.store.KnownLevels(context.Background(), e.uid); len(kl) != 4 {
		t.Errorf("knowledge after sweeps = %d items, want 4", len(kl))
	}
}

func TestSchedulerDelaysAreIntervalPlusJitter(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)

	var delays []time.Duration
	randoms := []float64{0, 1, 0.5}
	idx := 0
	wait := func(ctx context.Context, d time.Duration) error {
		delays = append(delays, d)
		if len(delays) >= len(randoms) {
			return context.Canceled // stop the loop without a goroutine race
		}
		return nil
	}
	sched := marumorisync.NewScheduler(e.svc, time.Hour,
		marumorisync.WithJitter(10*time.Minute),
		marumorisync.WithSweepWait(wait),
		marumorisync.WithRandom(func() float64 { r := randoms[idx]; idx++; return r }))

	if err := sched.Run(context.Background()); err != nil {
		t.Fatalf("Run = %v", err)
	}
	want := []time.Duration{time.Hour, time.Hour + 10*time.Minute, time.Hour + 5*time.Minute}
	if len(delays) != len(want) {
		t.Fatalf("delays = %v, want %v", delays, want)
	}
	for i, d := range delays {
		if d != want[i] {
			t.Errorf("delay %d = %v, want %v", i, d, want[i])
		}
	}
}

func TestSchedulerDisabledWithNonPositiveInterval(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)

	ctx, cancel := context.WithCancel(context.Background())
	sched := marumorisync.NewScheduler(e.svc, 0,
		marumorisync.WithSweepWait(func(context.Context, time.Duration) error {
			t.Error("sweep ran with a non-positive interval")
			return nil
		}))
	go func() { time.Sleep(10 * time.Millisecond); cancel() }()
	if err := sched.Run(ctx); err != nil {
		t.Fatalf("Run = %v, want nil", err)
	}
	if n := e.up.CallsOf("/known/kanji"); n != 0 {
		t.Errorf("upstream calls = %d, want 0", n)
	}
}
