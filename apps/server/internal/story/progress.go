package story

// On-demand generation progress (issue #33): a Learner pressing Generate
// watches a server-tracked bar, not a client-side guess. The Service holds
// one run per user — the same slot the Automatic flow uses — and reports its
// stage, attempt count, and a percentage the SERVER computes, so a client
// reload mid-run finds the same picture from GET alone.

import (
	"time"

	"github.com/google/uuid"
)

// GenerationStatus is where the Learner's generation slot stands: no run
// tracked (idle), one in flight (running), or the terminal state of the last
// run — kept until the next start so a late or reloading poller still learns
// how the run ended.
type GenerationStatus string

const (
	GenerationIdle    GenerationStatus = "idle"
	GenerationRunning GenerationStatus = "running"
	GenerationReady   GenerationStatus = "ready"
	GenerationFailed  GenerationStatus = "failed"
)

// GenerationStage is what the running generation is doing right now, named
// in the Learner's words: preparing (reading the Focus Set and Known Items),
// writing (a model attempt), checking (that attempt against the validation
// gate), and saving.
type GenerationStage string

const (
	StagePreparing GenerationStage = "preparing"
	StageWriting   GenerationStage = "writing"
	StageChecking  GenerationStage = "checking"
	StageSaving    GenerationStage = "saving"
)

// FitFailureMessage is the ticket's failure line: shown under a stopped bar
// with the chance to try again. Issue #33 reserves it for a run whose
// attempts were all rejected by the validation gate (or a provider that
// never produced a candidate at all); the ways a run can fail before any
// attempt — no AI Provider set up, nothing in the Focus Set to build from —
// have their own honest lines below.
const FitFailureMessage = "Couldn't write a Story that fits your vocabulary. Try again?"

// NoProviderFailureMessage is the failure line when the Learner's Stories
// task has no AI Provider assigned: the run could not even ask a model to
// write, and the Learner can fix that in Settings.
const NoProviderFailureMessage = "Stories aren't set up yet: no AI provider is chosen for Stories. Pick one in Settings, then try again."

// EmptyFocusFailureMessage is the failure line when there is nothing in the
// Focus Set to build a Story from: the Learner has too few Known Items so
// far, not a Story the model failed to fit.
const EmptyFocusFailureMessage = "There aren't enough Known Items to write a Story from yet. Keep learning and try again."

// Progress is one snapshot of a user's generation run, as the client polls
// it. Stage, Attempt and MaxAttempts carry the "Writing… attempt 2 of 3"
// label; Percent is server-computed (see genRun.percentNow); Message is the
// failure line when Status is failed; StoryID is the ready Story's id.
type Progress struct {
	Status      GenerationStatus
	Stage       GenerationStage
	Attempt     int
	MaxAttempts int
	Percent     int
	StartedAt   time.Time
	Message     string
	StoryID     uuid.UUID
}

// OnDemandOptions carries what the Learner typed into the Generate box.
// Blank Genre/Theme mean "follow the Automatic rules" (the preference roll,
// PreferredShare); Surprise means the model chooses both, ignoring the
// Learner's preferences but still avoiding disliked and recent genres.
type OnDemandOptions struct {
	Genre    string
	Theme    string
	Surprise bool
}

// genRun is the in-memory state behind Progress. It lives in the Service,
// guarded by genMu alongside genInFlight: one run per user, terminal state
// kept until the next start. Progress Percent for a finished run is frozen
// at its terminal value (100 for ready).
type genRun struct {
	status      GenerationStatus
	stage       GenerationStage
	attempt     int
	maxAttempts int
	startedAt   time.Time
	// stageAt is when the current attempt's writing window opened; the
	// expected window comes from the Learner's recent generation durations.
	stageAt  time.Time
	expected time.Duration
	percent  int // frozen floor; recomputed while writing or checking
	message  string
	storyID  uuid.UUID
}

// defaultGenerationTotal is the whole-run budget assumed when the Learner
// has no recorded durations yet — a first-run bar that fills on a guess is
// still smoother than one stuck at the stage floor.
const defaultGenerationTotal = 60 * time.Second

// durationSampleLimit is how many recent runs feed the average.
const durationSampleLimit = 10

// percentNow answers the bar's percentage at time now. The preparing stage
// sits at 5 and saving at 90 (set when the stage opens); the attempt
// windows tile [10, 90): attempt k of M owns [10+80(k-1)/M, 10+80k/M), and
// the writing stage fills its window by elapsed/expected, capped just short
// of the top so a slower-than-usual run creeps instead of lying. Checking
// sits near the top of the same window; retrying means the next attempt's
// window opens.
func (r *genRun) percentNow(now time.Time) int {
	if r.status != GenerationRunning {
		return r.percent
	}
	m := r.maxAttempts
	if m < 1 {
		m = 1
	}
	lo := 10 + 80*float64(r.attempt-1)/float64(m)
	hi := 10 + 80*float64(r.attempt)/float64(m)
	switch r.stage {
	case StageWriting:
		frac := 0.95
		if r.expected > 0 {
			if f := now.Sub(r.stageAt).Seconds() / r.expected.Seconds(); f < frac {
				frac = f
			}
			if frac < 0 {
				frac = 0
			}
		}
		return int(lo + (hi-lo)*frac + 0.5)
	case StageChecking:
		return int(lo + (hi-lo)*0.95 + 0.5)
	}
	return r.percent
}
