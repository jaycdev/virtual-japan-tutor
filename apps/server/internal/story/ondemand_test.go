package story

// On-demand Stories (issue #33): the Learner presses Generate (with optional
// genre/theme) or Surprise me, watches server-tracked stage progress, and
// opens the Story when it says Ready. These tests cover the service half of
// that: the shared one-per-user generation slot, the rules On-demand starts
// follow and ignore, the stage reporting, the failure message, and the
// duration samples the progress bar fills from.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
)

// startOnDemand starts an On-demand run the way the HTTP start does: it
// answers while the run is still going, carrying the initial snapshot.
func startOnDemand(t *testing.T, svc *Service, userID uuid.UUID, opts OnDemandOptions) (Progress, error) {
	t.Helper()
	return svc.GenerateOnDemand(context.Background(), userID, opts)
}

// awaitRun watches the server-tracked progress until the run terminates —
// the client's shape of the flow — and returns that terminal snapshot.
func awaitRun(t *testing.T, svc *Service, userID uuid.UUID) Progress {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for {
		p := svc.GenerationProgress(context.Background(), userID)
		if p.Status == GenerationReady || p.Status == GenerationFailed {
			return p
		}
		if time.Now().After(deadline) {
			t.Fatalf("generation stuck at %+v, want it to reach a terminal state", p)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// startAfterRun starts a run after a previous one went terminal; the slot
// frees a moment after the terminal snapshot lands, so retry until it does.
func startAfterRun(t *testing.T, svc *Service, userID uuid.UUID, opts OnDemandOptions) (Progress, error) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		p, err := svc.GenerateOnDemand(context.Background(), userID, opts)
		if err == nil {
			return p, nil
		}
		if time.Now().After(deadline) {
			t.Fatalf("the slot never freed after a terminal run: %v", err)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestGenerateOnDemandAnswersWhileTheRunIsStillGoing(t *testing.T) {
	// The progress bar's whole point (#33): the start answers mid-flight,
	// the tracked progress moves, and the run terminates — saving its
	// Story — with nobody waiting on the request.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	provider.block = make(chan struct{}) // hold every model call open
	svc, store, _, _ := newTestService(t, provider)

	start, err := startOnDemand(t, svc, user, OnDemandOptions{})
	if err != nil {
		t.Fatalf("GenerateOnDemand: %v", err)
	}
	if start.Status != GenerationRunning || start.Stage != StagePreparing || start.Percent < 5 {
		t.Fatalf("start snapshot = %+v, want a running preparing bar", start)
	}
	// The slot is taken before the start answers, even mid-flight:
	// a second start is refused while the run has nobody watching.
	if _, err := svc.GenerateOnDemand(ctx, user, OnDemandOptions{}); err == nil {
		t.Fatal("second start while one runs must not start")
	}

	<-provider.block // the model call is open, held by the handshake
	mid := svc.GenerationProgress(ctx, user)
	if mid.Status != GenerationRunning || mid.Stage != StageWriting || mid.Attempt != 1 {
		t.Fatalf("mid-run progress = %+v, want writing attempt 1", mid)
	}
	if mid.Percent <= start.Percent {
		t.Fatalf("percent went from %d to %d, want the bar to move while the run works", start.Percent, mid.Percent)
	}

	provider.block <- struct{}{} // let the model answer
	p := awaitRun(t, svc, user)
	if p.Status != GenerationReady || p.StoryID == uuid.Nil {
		t.Fatalf("terminal progress = %+v, want ready with a story id", p)
	}
	if _, err := store.Get(ctx, p.StoryID, user); err != nil {
		t.Fatalf("the unwatched run must still save its Story: %v", err)
	}
	provider.block = nil
}

func TestGenerateOnDemandWritesAnOnDemandStoryAndGoesReady(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)

	if err := store.SetStoryPrefs(ctx, user, "travel", "", ""); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}
	if start, err := startOnDemand(t, svc, user, OnDemandOptions{Genre: "travel", Theme: "a robot running a ramen shop"}); err != nil {
		t.Fatalf("GenerateOnDemand: %v", err)
	} else if start.Status != GenerationRunning {
		t.Fatalf("start snapshot = %+v, want a running run", start)
	}
	res := awaitRun(t, svc, user)
	if res.Status != GenerationReady || res.StoryID == uuid.Nil {
		t.Fatalf("progress = %+v, want ready with a story id", res)
	}
	// The terminal state stays readable, so a client that polls instead of
	// using the POST response sees the same thing (and survives a reload).
	p := svc.GenerationProgress(ctx, user)
	if p.Status != GenerationReady || p.StoryID != res.StoryID || p.Percent != 100 {
		t.Fatalf("GenerationProgress after ready = %+v", p)
	}

	// The Story is stored as On-demand, validated, and its genre and theme
	// are what the Learner asked for.
	st, err := store.Get(ctx, res.StoryID, user)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if st.Origin != OriginOnDemand {
		t.Errorf("Origin = %q, want on_demand", st.Origin)
	}
	if !st.Validated {
		t.Error("want a validated story on the happy path")
	}
	if st.Genre != "travel" {
		t.Errorf("Genre = %q, want travel", st.Genre)
	}
	if !strings.Contains(st.Prompt, "a robot running a ramen shop") {
		t.Error("prompt missing the requested theme")
	}
	// An On-demand Story never becomes Today's Story (GLOSSARY.md).
	if _, ok, _ := store.LatestAutomaticStory(ctx, user); ok {
		t.Error("an On-demand Story must not qualify as Today's Story")
	}

	// The run's duration is recorded, so the next bar can fill from it.
	ds, err := store.RecentGenerationDurations(ctx, user, 10)
	if err != nil || len(ds) != 1 {
		t.Fatalf("RecentGenerationDurations = %v, %v; want one sample", ds, err)
	}
}

func TestGenerateOnDemandBusyRejectsWhileAGenerationRuns(t *testing.T) {
	// One in-flight generation per Learner, shared with the Automatic flow:
	// the slot taken by either path answers a second start with a conflict.
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	provider.block = make(chan struct{})
	svc, _, _, _ := newTestService(t, provider)
	ctx := context.Background()

	start, err := startOnDemand(t, svc, user, OnDemandOptions{})
	if err != nil {
		t.Fatalf("first start: %v", err)
	}
	if start.Status != GenerationRunning {
		t.Fatalf("first start snapshot = %+v, want running", start)
	}
	<-provider.block // the run is now mid-completion

	if _, err := svc.GenerateOnDemand(ctx, user, OnDemandOptions{Genre: "history"}); err == nil {
		t.Fatal("second start while one runs must not start")
	} else {
		var se *Error
		if !errors.As(err, &se) || se.Status != 409 || se.Code != "generation_running" {
			t.Fatalf("second start = %+v, want 409 generation_running", err)
		}
	}

	// The Automatic path shares the slot: its pass skips while the
	// learner-initiated run is in flight.
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory during an on-demand run: %v", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d mid-run, want still 1", provider.callCount())
	}

	provider.block <- struct{}{} // let the run finish
	if r := awaitRun(t, svc, user); r.Status != GenerationReady {
		t.Fatalf("first run ended at %+v, want ready", r)
	}
	provider.block = nil // the slot test is over; later calls answer freely
	// The slot is free again after the run.
	p2, err := startAfterRun(t, svc, user, OnDemandOptions{})
	if err != nil || p2.Status != GenerationRunning {
		t.Fatalf("start after the run finished = %+v, %v; want a fresh run to start", p2, err)
	}
	if r := awaitRun(t, svc, user); err == nil && r.Status != GenerationReady {
		t.Fatalf("second run ended at %+v, want ready", r)
	}
}

func TestGenerateOnDemandIgnoresTheFailureCooldownAndDailyRules(t *testing.T) {
	// Automatic passes back off after a gate failure and hold the daily and
	// unread rules; a learner pressing Generate is gated by neither.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.settings.RetryCooldown = time.Hour
	if err := store.Save(ctx, &Story{UserID: user, Genre: "travel", Validated: false}); err != nil {
		t.Fatalf("Save failed story: %v", err)
	}
	// ...and an unread Automatic Story already waiting.
	if err := store.Save(ctx, &Story{UserID: user, Genre: "food", Validated: true, Origin: OriginAutomatic}); err != nil {
		t.Fatalf("Save automatic story: %v", err)
	}

	if _, err := startOnDemand(t, svc, user, OnDemandOptions{}); err != nil {
		t.Fatalf("GenerateOnDemand: %v", err)
	}
	if res := awaitRun(t, svc, user); res.Status != GenerationReady {
		t.Fatalf("GenerateOnDemand = %+v; cooldown and unread must not gate it", res)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}
	// The same conditions still hold the Automatic pass back.
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	if provider.callCount() != 1 {
		t.Fatal("the cooldown must still gate the Automatic pass")
	}
}

func TestGenerateOnDemandBlankInputsFollowTheAutomaticRules(t *testing.T) {
	// A blank Generate box means "whatever Automatic would do": the
	// preference-steered roll, same as the Automatic Story.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.roll = func() float64 { return 0 } // the preference branch of both rolls
	if err := store.SetStoryPrefs(ctx, user, "travel", "a robot running a ramen shop", ""); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}

	if _, err := startOnDemand(t, svc, user, OnDemandOptions{}); err != nil {
		t.Fatalf("GenerateOnDemand: %v", err)
	}
	if res := awaitRun(t, svc, user); res.Status != GenerationReady {
		t.Fatalf("run ended at %+v, want ready", res)
	}
	prompt := provider.lastUserPrompt()
	if !strings.Contains(prompt, "Genre/theme: travel") {
		t.Errorf("blank genre did not follow the Preferred Genre branch:\n%s", prompt)
	}
	if !strings.Contains(prompt, "Theme: a robot running a ramen shop") {
		t.Errorf("blank theme did not follow the Preferred Theme branch:\n%s", prompt)
	}
}

func TestGenerateOnDemandSurpriseIgnoresPreferencesButKeepsTheAvoidRules(t *testing.T) {
	// "Surprise me": the model chooses genre and theme even against set
	// preferences; disliked genres and the recently-read genres stay out.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "space opera", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.roll = func() float64 { return 0 } // the preference branch would fire without Surprise
	if err := store.SetStoryPrefs(ctx, user, "travel", "a robot running a ramen shop", ""); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}
	up, down := RatingUp, RatingDown
	if err := store.Save(ctx, &Story{UserID: user, Genre: "romance", Validated: true, Rating: &down}); err != nil {
		t.Fatalf("Save down-rated story: %v", err)
	}
	if err := store.Save(ctx, &Story{UserID: user, Genre: "food", Validated: true, Origin: OriginOnDemand, Rating: &up}); err != nil {
		t.Fatalf("Save recent story: %v", err)
	}

	if _, err := startOnDemand(t, svc, user, OnDemandOptions{Surprise: true}); err != nil {
		t.Fatalf("GenerateOnDemand: %v", err)
	}
	if res := awaitRun(t, svc, user); res.Status != GenerationReady {
		t.Fatalf("run ended at %+v, want ready", res)
	}
	prompt := provider.lastUserPrompt()
	if strings.Contains(prompt, "Genre/theme: travel") {
		t.Errorf("Surprise must ignore the Preferred Genre:\n%s", prompt)
	}
	if strings.Contains(prompt, "Theme: a robot running a ramen shop") {
		t.Errorf("Surprise must ignore the Preferred Theme:\n%s", prompt)
	}
	if !strings.Contains(prompt, "surprise") {
		t.Errorf("Surprise prompt must let the model choose:\n%s", prompt)
	}
	if !strings.Contains(prompt, "romance") {
		t.Errorf("Surprise must still name the disliked genres:\n%s", prompt)
	}
	if !strings.Contains(prompt, "food") {
		t.Errorf("Surprise must name the recent genres to avoid:\n%s", prompt)
	}
}

func TestGenerateOnDemandGateFailureReportsTheFitFailureMessage(t *testing.T) {
	// Every attempt rejected: the Story is stored but stays hidden, and the
	// progress the Learner sees is the ticket's retry message — not a silent
	// reset to idle.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", dirtyClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider) // MaxAttempts: 1

	if _, err := startOnDemand(t, svc, user, OnDemandOptions{}); err != nil {
		t.Fatal("GenerateOnDemand must report failure as data, got error:", err)
	}
	res := awaitRun(t, svc, user)
	if res.Status != GenerationFailed || res.Message != FitFailureMessage {
		t.Fatalf("progress = %+v, want failed with %q", res, FitFailureMessage)
	}
	if svc.GenerationProgress(ctx, user).Status != GenerationFailed {
		t.Fatal("the failed state must stay readable after the run")
	}
	// Stored for analysis but never offered: the library does not show it.
	stories, total, err := store.List(ctx, user, 10, 0)
	if err != nil || total != 0 || len(stories) != 0 {
		t.Fatalf("List = %d stories (total %d), %v; a failed Story stays hidden", len(stories), total, err)
	}
}

func TestGenerateOnDemandEmptyFocusSetFailsWithItsOwnMessage(t *testing.T) {
	// Nothing to build from: no provider call, and an honest line about
	// the Learner's vocabulary — #33 reserves the fit message for runs
	// whose attempts all failed the checks.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, focus, _ := newTestService(t, provider)
	focus.set = FocusSet{}

	if _, err := startOnDemand(t, svc, user, OnDemandOptions{}); err != nil {
		t.Fatalf("GenerateOnDemand: %v", err)
	}
	res := awaitRun(t, svc, user)
	if res.Status != GenerationFailed || res.Message != EmptyFocusFailureMessage {
		t.Fatalf("progress = %+v, want failed with %q", res, EmptyFocusFailureMessage)
	}
	if provider.callCount() != 0 {
		t.Fatalf("provider calls = %d with an empty Focus Set, want 0", provider.callCount())
	}
	if _, total, _ := store.List(ctx, user, 10, 0); total != 0 {
		t.Fatalf("library holds %d stories, want none", total)
	}
}

// nilClientResolver is the shape the real resolver cannot quite take but
// the pipeline guards for: an answer with no Client in it.
type nilClientResolver struct{}

func (nilClientResolver) ResolveProvider(_ context.Context, _ uuid.UUID, _ aiprovider.Task) (aiprovider.Resolved, error) {
	return aiprovider.Resolved{}, nil
}

func TestGenerateOnDemandNoProviderFailsWithItsOwnMessage(t *testing.T) {
	// "No AI provider for Stories" is Learner-fixable, not a fit failure:
	// the stopped bar names the Settings fix — both for an answer with no
	// Client and for an unassigned resolve error (ErrNotAssigned).
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, _, _, _ := newTestService(t, provider)

	user := uuid.New()
	svc.resolve = nilClientResolver{}
	if _, err := startOnDemand(t, svc, user, OnDemandOptions{}); err != nil {
		t.Fatalf("GenerateOnDemand: %v", err)
	}
	res := awaitRun(t, svc, user)
	if res.Status != GenerationFailed || res.Message != NoProviderFailureMessage {
		t.Fatalf("progress = %+v, want failed with %q", res, NoProviderFailureMessage)
	}

	user2 := uuid.New()
	svc.resolve = fakeResolver{} // answers aiprovider.ErrNotAssigned
	if _, err := startOnDemand(t, svc, user2, OnDemandOptions{}); err != nil {
		t.Fatalf("GenerateOnDemand (unassigned): %v", err)
	}
	res2 := awaitRun(t, svc, user2)
	if res2.Status != GenerationFailed || res2.Message != NoProviderFailureMessage {
		t.Fatalf("progress = %+v, want failed with %q", res2, NoProviderFailureMessage)
	}
	if provider.callCount() != 0 {
		t.Fatalf("provider calls = %d without a client, want 0", provider.callCount())
	}
}

func TestGenerationProgressTracksStagesAndFillsTheWritingWindow(t *testing.T) {
	// The bar is server-tracked: preparing → writing (filling from the
	// Learner's recent durations) → saving → ready, and a second attempt
	// shows "attempt 2 of 3".
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t,
		string(fixture(t, "travel", dirtyClause, cleanClause, cleanClause, cleanClause)),
		string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)),
	)
	provider.block = make(chan struct{})
	svc, store, _, _ := newTestService(t, provider)
	svc.settings.MaxAttempts = 3
	clock := time.Unix(1700000000, 0).UTC()
	svc.now = func() time.Time { return clock }
	if err := store.RecordGenerationDuration(ctx, user, clock, int64(90*time.Second/time.Millisecond)); err != nil {
		t.Fatalf("RecordGenerationDuration: %v", err)
	}

	if _, err := startOnDemand(t, svc, user, OnDemandOptions{}); err != nil {
		t.Fatalf("GenerateOnDemand: %v", err)
	}
	<-provider.block // attempt 1 is in flight

	p := svc.GenerationProgress(ctx, user)
	if p.Status != GenerationRunning || p.Stage != StageWriting || p.Attempt != 1 || p.MaxAttempts != 3 {
		t.Fatalf("mid-run progress = %+v, want writing attempt 1 of 3", p)
	}
	// Recent runs took 90s total: attempt 1's window is [10, 10+80/3), and
	// half of its slice has elapsed.
	clock = clock.Add(15 * time.Second)
	p = svc.GenerationProgress(ctx, user)
	if p.Percent < 22 || p.Percent > 24 {
		t.Fatalf("percent at half of attempt 1 = %d, want ≈23 (window [10,36.6])", p.Percent)
	}
	// Past the expected slice the bar creeps but stays short of the window's
	// top — the run is taking longer than usual.
	clock = clock.Add(30 * time.Second)
	p = svc.GenerationProgress(ctx, user)
	if p.Percent < 33 || p.Percent > 36 {
		t.Fatalf("percent past the expected slice = %d, want ≈35", p.Percent)
	}

	provider.block <- struct{}{} // attempt 1 answers (gate-rejected)
	<-provider.block             // attempt 2 in flight
	p = svc.GenerationProgress(ctx, user)
	if p.Stage != StageWriting || p.Attempt != 2 {
		t.Fatalf("after a gate rejection progress = %+v, want writing attempt 2 of 3", p)
	}
	if p.Percent < 36 {
		t.Fatalf("attempt 2 percent = %d, want it past attempt 1's window", p.Percent)
	}
	provider.block <- struct{}{} // attempt 2 answers clean

	if r := awaitRun(t, svc, user); r.Status != GenerationReady {
		t.Fatalf("run ended at %+v; want ready", r)
	}
}

func TestIdleProgressBeforeTheFirstGeneration(t *testing.T) {
	user := uuid.New()
	svc, _, _, _ := newTestService(t, nil)
	p := svc.GenerationProgress(context.Background(), user)
	if p.Status != GenerationIdle || p.Percent != 0 {
		t.Fatalf("progress before any run = %+v, want idle", p)
	}
}

func TestGeneratorReportsWritingAndCheckingStagesPerAttempt(t *testing.T) {
	// The Generate loop owns the stage reports: writing before each model
	// call, checking once the answer is in hand and the gate is judging it.
	ctx := context.Background()
	var seq []string
	req := Request{
		UserID:   uuid.New(),
		Settings: Settings{MaxAttempts: 3},
		Focus:    FocusSet{Vocab: []VocabFocus{{EntSeq: 1, JA: "ねこ", EN: "cat", SRSLevel: 5}}},
		Known:    &fakeFocus{known: map[int64]KnownView{1: {IsKnown: true, SRSLevel: 5}, 2: {IsKnown: true, SRSLevel: 4}}},
		ReportStage: func(stage GenerationStage, attempt int) {
			seq = append(seq, fmt.Sprintf("%s %d", stage, attempt))
		},
	}
	gen := NewGenerator(cleanLookup())
	client := newFakeProvider(t,
		string(fixture(t, "travel", dirtyClause, cleanClause, cleanClause, cleanClause)),
		string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)),
	).client(t)
	st, err := gen.Generate(ctx, client, req)
	if err != nil || st == nil || !st.Validated {
		t.Fatalf("Generate = %+v, %v; want a validated story", st, err)
	}
	want := []string{"writing 1", "checking 1", "writing 2", "checking 2"}
	if strings.Join(seq, ", ") != strings.Join(want, ", ") {
		t.Fatalf("stage reports = %v, want %v", seq, want)
	}
}

func TestAutomaticStoryAlsoRecordsItsDuration(t *testing.T) {
	// The duration samples feed the On-demand bar, so the daily flow
	// records them too.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.now = store.storeNow
	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	ds, err := store.RecentGenerationDurations(ctx, user, 10)
	if err != nil || len(ds) != 1 {
		t.Fatalf("RecentGenerationDurations = %v, %v; want one sample", ds, err)
	}
}

func TestGenreThemeSuggestionsMergePresetsWithTheLearnersHistory(t *testing.T) {
	// The autocomplete box offers the preset genres plus the genres and
	// themes of the Learner's own past Stories — and nothing from other
	// Learners.
	ctx := context.Background()
	user := uuid.New()
	other := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)

	if err := store.Save(ctx, &Story{UserID: user, Genre: "cyberpunk", Theme: "a robot running a ramen shop", Validated: true, Origin: OriginOnDemand}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := store.Save(ctx, &Story{UserID: user, Genre: "travel", Theme: "a night train", Validated: true}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := store.Save(ctx, &Story{UserID: user, Genre: "secret", Theme: "private", Validated: false}); err != nil {
		t.Fatalf("Save failed story: %v", err)
	}
	if err := store.Save(ctx, &Story{UserID: other, Genre: "elsewhere", Theme: "not yours", Validated: true}); err != nil {
		t.Fatalf("Save other user's story: %v", err)
	}

	genres, themes, err := svc.GenreThemeSuggestions(ctx, user)
	if err != nil {
		t.Fatalf("GenreThemeSuggestions: %v", err)
	}
	if !containsStr(genres, "cyberpunk") || !containsStr(genres, "travel") {
		t.Errorf("genres = %v, want the Learner's past genres included", genres)
	}
	if !containsStr(genres, "mystery") {
		t.Errorf("genres = %v, want the preset genres included", genres)
	}
	if containsStr(genres, "secret") {
		t.Errorf("genres = %v, a gate-failed Story must not feed the suggestions", genres)
	}
	if containsStr(genres, "elsewhere") || containsStr(themes, "not yours") {
		t.Errorf("suggestions leaked another Learner's stories: %v / %v", genres, themes)
	}
	if !containsStr(themes, "a robot running a ramen shop") || !containsStr(themes, "a night train") {
		t.Errorf("themes = %v, want the Learner's past themes included", themes)
	}
	if containsStr(themes, "private") {
		t.Errorf("themes = %v, must not include failed-story themes", themes)
	}
}

func containsStr(xs []string, want string) bool {
	for _, x := range xs {
		if x == want {
			return true
		}
	}
	return false
}
