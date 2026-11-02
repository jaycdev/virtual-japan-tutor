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
)

type onDemandResult struct {
	p Progress
	e error
}

// startOnDemand runs GenerateOnDemand in the background so a test can watch
// (or hold) the run through the provider's block handshake; it returns the
// done channel carrying the terminal Progress and error.
func startOnDemand(svc *Service, userID uuid.UUID, opts OnDemandOptions) <-chan onDemandResult {
	done := make(chan onDemandResult, 1)
	go func() {
		p, err := svc.GenerateOnDemand(context.Background(), userID, opts)
		done <- onDemandResult{p, err}
	}()
	return done
}

func TestGenerateOnDemandWritesAnOnDemandStoryAndGoesReady(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)

	if err := store.SetStoryPrefs(ctx, user, "travel", "", ""); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}
	res := <-startOnDemand(svc, user, OnDemandOptions{Genre: "travel", Theme: "a robot running a ramen shop"})
	if res.e != nil {
		t.Fatalf("GenerateOnDemand: %v", res.e)
	}
	if res.p.Status != GenerationReady || res.p.StoryID == uuid.Nil {
		t.Fatalf("progress = %+v, want ready with a story id", res.p)
	}
	// The terminal state stays readable, so a client that polls instead of
	// using the POST response sees the same thing (and survives a reload).
	p := svc.GenerationProgress(ctx, user)
	if p.Status != GenerationReady || p.StoryID != res.p.StoryID || p.Percent != 100 {
		t.Fatalf("GenerationProgress after ready = %+v", p)
	}

	// The Story is stored as On-demand, validated, and its genre and theme
	// are what the Learner asked for.
	st, err := store.Get(ctx, res.p.StoryID, user)
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

	done := startOnDemand(svc, user, OnDemandOptions{})
	<-provider.block // the run is now mid-completion

	_, err := svc.GenerateOnDemand(ctx, user, OnDemandOptions{Genre: "history"})
	if err == nil {
		t.Fatal("second start while one runs must not start")
	}
	var se *Error
	if !errors.As(err, &se) || se.Status != 409 || se.Code != "generation_running" {
		t.Fatalf("second start = %+v, want 409 generation_running", err)
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
	r := <-done
	if r.e != nil || r.p.Status != GenerationReady {
		t.Fatalf("first run ended %+v, %v", r.p, r.e)
	}
	provider.block = nil // the slot test is over; later calls answer freely
	// The slot is free again after the run.
	p2, err := svc.GenerateOnDemand(ctx, user, OnDemandOptions{})
	if err != nil || p2.Status != GenerationReady {
		t.Fatalf("start after the run finished = %+v, %v; want a fresh run to start", p2, err)
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

	res := <-startOnDemand(svc, user, OnDemandOptions{})
	if res.e != nil || res.p.Status != GenerationReady {
		t.Fatalf("GenerateOnDemand = %+v, %v; cooldown and unread must not gate it", res.p, res.e)
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
	// preference-steered roll, same as the daily story.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.roll = func() float64 { return 0 } // the preference branch of both rolls
	if err := store.SetStoryPrefs(ctx, user, "travel", "a robot running a ramen shop", ""); err != nil {
		t.Fatalf("SetStoryPrefs: %v", err)
	}

	res := <-startOnDemand(svc, user, OnDemandOptions{})
	if res.e != nil {
		t.Fatalf("GenerateOnDemand: %v", res.e)
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

	res := <-startOnDemand(svc, user, OnDemandOptions{Surprise: true})
	if res.e != nil {
		t.Fatalf("GenerateOnDemand: %v", res.e)
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

	res := <-startOnDemand(svc, user, OnDemandOptions{})
	if res.e != nil {
		t.Fatalf("GenerateOnDemand must report failure as data, got error: %v", res.e)
	}
	if res.p.Status != GenerationFailed || res.p.Message != FitFailureMessage {
		t.Fatalf("progress = %+v, want failed with %q", res.p, FitFailureMessage)
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

func TestGenerateOnDemandEmptyFocusSetFailsWithTheFitFailureMessage(t *testing.T) {
	// Nothing to build from: no provider call, the same retry message.
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "travel", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, focus, _ := newTestService(t, provider)
	focus.set = FocusSet{}

	res := <-startOnDemand(svc, user, OnDemandOptions{})
	if res.e != nil {
		t.Fatalf("GenerateOnDemand: %v", res.e)
	}
	if res.p.Status != GenerationFailed || res.p.Message != FitFailureMessage {
		t.Fatalf("progress = %+v, want failed with %q", res.p, FitFailureMessage)
	}
	if provider.callCount() != 0 {
		t.Fatalf("provider calls = %d with an empty Focus Set, want 0", provider.callCount())
	}
	if _, total, _ := store.List(ctx, user, 10, 0); total != 0 {
		t.Fatalf("library holds %d stories, want none", total)
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

	done := startOnDemand(svc, user, OnDemandOptions{})
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

	r := <-done
	if r.e != nil || r.p.Status != GenerationReady {
		t.Fatalf("run ended %+v, %v; want ready", r.p, r.e)
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
