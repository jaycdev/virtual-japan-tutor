package marumorisync_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
)

// recObserver records what one Sync handed to Observed Grammar matching (issue #6).
type recObserver struct {
	calls   int
	userIDs []uuid.UUID
	obs     []marumori.GrammarObservation
	err     error
}

func (o *recObserver) SyncObserved(_ context.Context, userID uuid.UUID, observations []marumori.GrammarObservation) (knowngrammar.SyncResult, error) {
	o.calls++
	o.userIDs = append(o.userIDs, userID)
	o.obs = append(o.obs, observations...)
	if o.err != nil {
		return knowngrammar.SyncResult{}, o.err
	}
	return knowngrammar.SyncResult{Observed: len(observations)}, nil
}

func (o *recObserver) ids() []string {
	var out []string
	for _, obs := range o.obs {
		out = append(out, obs.MaruMoriID)
	}
	return out
}

// Issue #6: "a grammar point counts as known once it appears in MaruMori grammar
// reviews (or has SRS Level >= 1). Pending lessons are ignored."
func TestSyncPassesOnlyConfirmedGrammarObservationsToTheObserver(t *testing.T) {
	obs := &recObserver{}
	e := newEnv(t, testRefs(), marumorisync.WithGrammarObserver(obs))
	e.connect(t)

	e.up.Lessons = []marumori.GrammarObservation{
		{MaruMoriID: "Grammar/101", Pattern: "pending point"},                // lesson-only, no progress: ignored
		{MaruMoriID: "Grammar/104", Pattern: "suspended point", Level: i(4)}, // lesson-listed but SRS Level >= 1: confirmed
	}
	e.up.Reviews = []marumori.GrammarObservation{
		{MaruMoriID: "Grammar/202", Pattern: "〜てしまう", JLPTLevel: "N4", Level: i(3)},
	}

	run, err := e.svc.Sync(e.ctx)
	if err != nil || run.Status != marumorisync.RunOK {
		t.Fatalf("Sync = %+v, %v", run, err)
	}
	if obs.calls != 1 || len(obs.userIDs) != 1 || obs.userIDs[0] != e.uid {
		t.Fatalf("observer calls = %d for %v, want once for the learner", obs.calls, obs.userIDs)
	}
	want := []string{"Grammar/202", "Grammar/104"} // reviews first, then levelled lessons
	got := obs.ids()
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("confirmed observations = %v, want %v (pending lesson ignored)", got, want)
	}
	// The pattern and MaruMori level ride along: matching runs on them.
	if obs.obs[0].Pattern != "〜てしまう" || obs.obs[0].JLPTLevel != "N4" {
		t.Errorf("observation = %+v, want the pattern and JLPT Level decoded for matching", obs.obs[0])
	}
}

// A matching failure is a store-side failure: the run is recorded failed with a
// clear message, like every other ApplySync-stage error.
func TestObserverFailureRecordsAFailedRun(t *testing.T) {
	obs := &recObserver{err: errors.New("catalogue exploded")}
	e := newEnv(t, testRefs(), marumorisync.WithGrammarObserver(obs))
	e.connect(t)
	happyData(e.up)

	run, err := e.svc.Sync(e.ctx)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if run.Status != marumorisync.RunFailed {
		t.Fatalf("run = %+v, want failed", run)
	}
	if run.Error == nil || !strings.Contains(*run.Error, "apply observed grammar") {
		t.Errorf("run error = %v, want it to name observed grammar", run.Error)
	}
}

// Without the option Sync behaves exactly as before (the observer is opt-in).
func TestSyncWithoutAnObserverStillStoresGrammarRows(t *testing.T) {
	e := newEnv(t, testRefs())
	e.connect(t)
	happyData(e.up)
	if run, err := e.svc.Sync(e.ctx); err != nil || run.Status != marumorisync.RunOK {
		t.Fatalf("Sync = %+v, %v", run, err)
	}
	if len(e.store.GrammarRows()) != 3 {
		t.Errorf("grammar rows = %d, want 3", len(e.store.GrammarRows()))
	}
}
