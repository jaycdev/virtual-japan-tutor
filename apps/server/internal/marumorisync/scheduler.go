package marumorisync

import (
	"context"
	"log/slog"
	mrand "math/rand"
	"time"
)

// Scheduler periodically Syncs every connected learner (issue #5: scheduled Sync).
// It delegates each sweep to Service.SyncScheduled, which is already per-user
// failure-tolerant; the Scheduler only decides when sweeps run.
type Scheduler struct {
	svc      *Service
	interval time.Duration
	jitter   time.Duration  // each delay is interval + rand()*jitter, so replicas don't sync in lockstep
	random   func() float64 // injectable for tests
	wait     func(ctx context.Context, d time.Duration) error
	log      *slog.Logger
}

// SchedulerOption configures a Scheduler.
type SchedulerOption func(*Scheduler)

// WithJitter bounds the random extra delay added to each interval.
func WithJitter(jitter time.Duration) SchedulerOption {
	return func(s *Scheduler) { s.jitter = jitter }
}

// WithRandom overrides the randomness source (tests use a deterministic one).
func WithRandom(random func() float64) SchedulerOption {
	return func(s *Scheduler) { s.random = random }
}

// WithSweepWait overrides the sleeping between sweeps (tests observe the chosen
// delays without actually waiting).
func WithSweepWait(wait func(ctx context.Context, d time.Duration) error) SchedulerOption {
	return func(s *Scheduler) { s.wait = wait }
}

// WithSchedulerLogger overrides the structured logger.
func WithSchedulerLogger(log *slog.Logger) SchedulerOption {
	return func(s *Scheduler) { s.log = log }
}

// NewScheduler returns a Scheduler sweeping every interval (+ jitter). interval
// must be positive; a non-positive interval disables Run (the wiring can pass
// "disabled" without special-casing the loop).
func NewScheduler(svc *Service, interval time.Duration, opts ...SchedulerOption) *Scheduler {
	s := &Scheduler{
		svc:      svc,
		interval: interval,
		jitter:   interval / 5,
		random:   mrand.Float64,
		log:      slog.Default(),
	}
	s.wait = func(ctx context.Context, d time.Duration) error {
		timer := time.NewTimer(d)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-timer.C:
			return nil
		}
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// Run sweeps until ctx is cancelled, then returns nil: stopping the scheduled
// Syncs on shutdown is normal, not a failure. A sweep that fails outright (a
// store outage) is logged; the loop keeps its cadence.
func (s *Scheduler) Run(ctx context.Context) error {
	if s.interval <= 0 {
		<-ctx.Done()
		return nil
	}
	for ctx.Err() == nil {
		if err := s.wait(ctx, s.nextDelay()); err != nil {
			return nil // wait only fails when ctx ended
		}
		if ctx.Err() != nil {
			return nil
		}
		if err := s.svc.SyncScheduled(ctx); err != nil {
			s.log.Error("marumori sync sweep failed", "error", err)
		}
	}
	return nil
}

func (s *Scheduler) nextDelay() time.Duration {
	if s.jitter <= 0 {
		return s.interval
	}
	return s.interval + time.Duration(float64(s.jitter)*s.random())
}
