package grammar_test

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar/grammartest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
)

func newGenerator(store grammar.Store, dict grammar.Dictionary, resolve grammar.ProviderResolver) *grammar.Generator {
	return grammar.NewGenerator(store, dict, resolve)
}

func TestGenerateExamplesStoresValidAndReportsRejections(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	provider := newFakeProvider(t, scriptedCall{content: examplesReply(
		append([]genExample{
			genExample{Sentence: "ねこだけぷりづんをたべた。", Translation: "The cat only ate gibberish.", Start: 2, Length: 2},
			genExample{Sentence: "**これだけください。**", Translation: "Only this, please.", Start: 4, Length: 2},
			genExample{Sentence: "ねこだけください。", Translation: "Only the cat, please.", Start: 0, Length: 2},
			genExample{Sentence: "たべて", Translation: "I ate.", Start: 0, Length: 3},
		}, validExamples(0, 2)...)...,
	)})
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	out, err := gen.GenerateExamples(ctx, dake.ID, testUser, 2)
	if err != nil {
		t.Fatalf("GenerateExamples: %v", err)
	}
	if out.Generated != 2 || out.Stored != 2 {
		t.Fatalf("Generated/Stored = %d/%d, want 2/2 (rejections: %v)", out.Generated, out.Stored, out.Rejections)
	}
	if out.Rejected != 4 || len(out.Rejections) != 4 {
		t.Fatalf("Rejected = %d (%v), want 4", out.Rejected, out.Rejections)
	}
	for reason, want := range map[grammar.Reason]int{
		grammar.ReasonUnknownWord:      1,
		grammar.ReasonDisallowedChars:  1,
		grammar.ReasonSpanNotInPattern: 1,
		grammar.ReasonTooShort:         1,
	} {
		if out.Counts[string(reason)] != want {
			t.Fatalf("Counts[%s] = %d, want %d (counts %v)", reason, out.Counts[string(reason)], want, out.Counts)
		}
	}
	for _, r := range out.Rejections {
		if r.Sentence == "" || len(r.Reasons) == 0 {
			t.Fatalf("rejection without sentence or reason: %+v", r)
		}
	}

	stored, err := store.Examples(ctx, dake.ID)
	if err != nil {
		t.Fatalf("Examples: %v", err)
	}
	if len(stored) != 2 {
		t.Fatalf("stored %d examples, want 2", len(stored))
	}
	for _, e := range stored {
		runes := []rune(e.SentenceJA)
		if string(runes[e.SpanStart:e.SpanEnd]) != e.SpanText || e.SpanText != "だけ" {
			t.Fatalf("stored span wrong: %+v", e)
		}
		if e.Source != "ai" || e.LanguageCheck != "jmdict_tokenised" || e.TranslationEN == "" {
			t.Fatalf("stored example fields wrong: %+v", e)
		}
	}

	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}
	call := provider.call(0)
	if call.Mode != "json_schema" {
		t.Fatalf("first request mode = %q, want json_schema", call.Mode)
	}
	if call.Auth != "Bearer fake-key" {
		t.Fatalf("auth header = %q", call.Auth)
	}
	prompt := provider.lastPrompt()
	for _, want := range []string{"2 new example sentences", "〜だけ", "N5"} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("prompt missing %q:\n%s", want, prompt)
		}
	}
}

func TestEnsureExplanationGeneratesOnlyWhenMissing(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	text := "**〜だけ** means “only, just”. Attach it to a noun or the て-form of a verb."
	provider := newFakeProvider(t, scriptedCall{content: explanationReply(text)})
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	got, err := gen.EnsureExplanation(ctx, dake.ID, testUser)
	if err != nil {
		t.Fatalf("EnsureExplanation: %v", err)
	}
	if got != text {
		t.Fatalf("explanation = %q, want the generated text", got)
	}
	content, err := store.Content(ctx, dake.ID)
	if err != nil {
		t.Fatalf("Content: %v", err)
	}
	if content.Explanation == nil || *content.Explanation != text {
		t.Fatalf("explanation not stored: %+v", content)
	}
	if content.ExplanationEdited || content.ExplanationUpdatedAt == nil {
		t.Fatalf("generated explanation should be unedited and stamped: %+v", content)
	}

	// The second read finds stored content and spends nothing.
	got2, err := gen.EnsureExplanation(ctx, dake.ID, testUser)
	if err != nil {
		t.Fatalf("second EnsureExplanation: %v", err)
	}
	if got2 != text {
		t.Fatalf("second explanation = %q", got2)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want exactly 1", provider.callCount())
	}
	if resolve.taskCalls(aiprovider.TaskGrammarContent) != 1 {
		t.Fatalf("resolver calls = %d, want exactly 1", resolve.taskCalls(aiprovider.TaskGrammarContent))
	}
	if !resolve.sawUser(testUser) {
		t.Fatalf("resolver must receive the caller's user id, got %v", resolve.users)
	}
	if call := provider.call(0); call.Mode != "json_schema" {
		t.Fatalf("mode = %q, want json_schema", call.Mode)
	}
	prompt := provider.lastPrompt()
	if !strings.Contains(prompt, "〜だけ") || !strings.Contains(prompt, "N5") {
		t.Fatalf("prompt lacks pattern/level:\n%s", prompt)
	}

	if _, err := gen.EnsureExplanation(ctx, 999, testUser); !errors.Is(err, grammar.ErrPointNotFound) {
		t.Fatalf("unknown point err = %v, want ErrPointNotFound", err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("unknown point must not reach the provider (calls %d)", provider.callCount())
	}
}

func TestRegenerateExplanationReplacesStoredContent(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	if err := store.SetExplanation(ctx, dake.ID, "the old hand-written explanation", true); err != nil {
		t.Fatalf("SetExplanation: %v", err)
	}
	provider := newFakeProvider(t, scriptedCall{content: explanationReply("a brand new explanation")})
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	got, err := gen.RegenerateExplanation(ctx, dake.ID, testUser)
	if err != nil {
		t.Fatalf("RegenerateExplanation: %v", err)
	}
	if got != "a brand new explanation" {
		t.Fatalf("explanation = %q", got)
	}
	content, err := store.Content(ctx, dake.ID)
	if err != nil {
		t.Fatalf("Content: %v", err)
	}
	if content.Explanation == nil || *content.Explanation != "a brand new explanation" {
		t.Fatalf("regenerated explanation not stored: %+v", content)
	}
	if content.ExplanationEdited {
		t.Fatalf("regenerated explanation must not be marked edited")
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}

	// EnsureExplanation then keeps the regenerated text.
	if again, err := gen.EnsureExplanation(ctx, dake.ID, testUser); err != nil || again != got {
		t.Fatalf("EnsureExplanation after regenerate = %q, %v", again, err)
	}
	if provider.callCount() != 1 {
		t.Fatalf("EnsureExplanation must reuse stored content (calls %d)", provider.callCount())
	}
}

func TestGenerationWithoutAssignedProvider(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	resolve := newFakeResolver(nil) // nothing assigned
	gen := newGenerator(store, dakeDict(), resolve)

	if _, err := gen.EnsureExplanation(ctx, dake.ID, testUser); !errors.Is(err, grammar.ErrNotAssigned) {
		t.Fatalf("EnsureExplanation err = %v, want ErrNotAssigned", err)
	}
	if _, err := gen.GenerateExamples(ctx, dake.ID, testUser, 5); !errors.Is(err, grammar.ErrNotAssigned) {
		t.Fatalf("GenerateExamples err = %v, want ErrNotAssigned", err)
	}
	content, err := store.Content(ctx, dake.ID)
	if err != nil {
		t.Fatalf("Content: %v", err)
	}
	if content.Explanation != nil {
		t.Fatalf("failed generation must not store anything: %+v", content)
	}
}

func TestGenerateExamplesBatchesWithinACallBudget(t *testing.T) {
	ctx := context.Background()
	cases := []struct {
		n     int
		calls int
		sent  int
	}{
		{n: 12, calls: 2, sent: 12},
		{n: 25, calls: 3, sent: 25},
		{n: 30, calls: 3, sent: 30},
	}
	for _, tc := range cases {
		store := grammartest.NewMemStore(dake)
		var script []scriptedCall
		for batch := 0; batch < 3; batch++ {
			script = append(script, scriptedCall{content: examplesReply(validExamples(batch*10, 10)...)})
		}
		provider := newFakeProvider(t, script...)
		resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
		gen := newGenerator(store, dakeDict(), resolve)

		out, err := gen.GenerateExamples(ctx, dake.ID, testUser, tc.n)
		if err != nil {
			t.Fatalf("n=%d: %v", tc.n, err)
		}
		if out.Generated != tc.sent || out.Rejected != 0 {
			t.Fatalf("n=%d: Generated/Rejected = %d/%d, want %d/0; rejections: %+v (counts %v)", tc.n, out.Generated, out.Rejected, tc.sent, out.Rejections, out.Counts)
		}
		if provider.callCount() != tc.calls {
			t.Fatalf("n=%d: provider calls = %d, want %d", tc.n, provider.callCount(), tc.calls)
		}
		stored, err := store.Examples(ctx, dake.ID)
		if err != nil || len(stored) != tc.sent {
			t.Fatalf("n=%d: stored %d examples (%v), want %d", tc.n, len(stored), err, tc.sent)
		}
	}

	// The last batch only asks for what is still missing.
	store := grammartest.NewMemStore(dake)
	provider := newFakeProvider(t,
		scriptedCall{content: examplesReply(validExamples(0, 10)...)},
		scriptedCall{content: examplesReply(validExamples(10, 10)...)},
	)
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)
	if _, err := gen.GenerateExamples(ctx, dake.ID, testUser, 12); err != nil {
		t.Fatalf("GenerateExamples: %v", err)
	}
	if !strings.Contains(provider.lastPrompt(), "2 new example sentences") {
		t.Fatalf("second batch should ask for 2 sentences:\n%s", provider.lastPrompt())
	}

	// Out-of-range counts never reach the provider.
	store = grammartest.NewMemStore(dake)
	provider = newFakeProvider(t)
	resolve = newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen = newGenerator(store, dakeDict(), resolve)
	for _, n := range []int{0, -1, grammar.MaxExamplesPerRequest + 1} {
		if _, err := gen.GenerateExamples(ctx, dake.ID, testUser, n); err == nil {
			t.Fatalf("n=%d accepted, want error", n)
		}
	}
	if provider.callCount() != 0 {
		t.Fatalf("invalid counts must not call the provider (%d calls)", provider.callCount())
	}
}

func TestGenerateExamplesRespectsPerPointCap(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	for _, ex := range validExamples(0, 28) {
		if _, err := store.AddExample(ctx, dake.ID, candidate(ex.Sentence, ex.Translation, ex.Start, ex.Start+ex.Length, "だけ")); err != nil {
			t.Fatalf("seed AddExample: %v", err)
		}
	}
	provider := newFakeProvider(t, scriptedCall{content: examplesReply(validExamples(28, 10)...)})
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	out, err := gen.GenerateExamples(ctx, dake.ID, testUser, 10)
	if err != nil {
		t.Fatalf("GenerateExamples: %v", err)
	}
	if out.Generated != 2 || out.Stored != 2 {
		t.Fatalf("Generated/Stored = %d/%d, want 2/2 (only room for 2)", out.Generated, out.Stored)
	}
	if out.Note == "" {
		t.Fatalf("expected a note about the cap")
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1", provider.callCount())
	}
	if total, _ := store.CountExamples(ctx, dake.ID); total != grammar.MaxExamplesPerPoint {
		t.Fatalf("total examples = %d, want %d", total, grammar.MaxExamplesPerPoint)
	}

	// A full point never spends provider quota.
	provider2 := newFakeProvider(t)
	resolve2 := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider2.client(t)})
	gen2 := newGenerator(store, dakeDict(), resolve2)
	out, err = gen2.GenerateExamples(ctx, dake.ID, testUser, 5)
	if err != nil {
		t.Fatalf("GenerateExamples at cap: %v", err)
	}
	if out.Generated != 0 || out.Note == "" {
		t.Fatalf("at cap: %+v", out)
	}
	if provider2.callCount() != 0 {
		t.Fatalf("full point must not call the provider (%d calls)", provider2.callCount())
	}
}

func TestProviderWithoutStructuredOutputSupportFallsBack(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	provider := newFakeProvider(t,
		scriptedCall{allowModes: []string{"json_object", ""}}, // rejects json_schema with 400
		scriptedCall{content: examplesReply(validExamples(0, 1)...)},
	)
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	out, err := gen.GenerateExamples(ctx, dake.ID, testUser, 1)
	if err != nil {
		t.Fatalf("GenerateExamples: %v", err)
	}
	if out.Generated != 1 {
		t.Fatalf("Generated = %d, want 1", out.Generated)
	}
	if provider.callCount() != 2 {
		t.Fatalf("provider calls = %d, want 2 (json_schema then fallback)", provider.callCount())
	}
	if provider.call(0).Mode != "json_schema" || provider.call(1).Mode != "json_object" {
		t.Fatalf("modes = %q, %q; want json_schema then json_object", provider.call(0).Mode, provider.call(1).Mode)
	}
}

func TestProviderFailurePropagatesAndStoresNothing(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	provider := newFakeProvider(t, scriptedCall{status: http.StatusTooManyRequests})
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	_, err := gen.GenerateExamples(ctx, dake.ID, testUser, 5)
	if !errors.Is(err, llm.ErrRateLimited) {
		t.Fatalf("err = %v, want llm.ErrRateLimited", err)
	}
	if total, _ := store.CountExamples(ctx, dake.ID); total != 0 {
		t.Fatalf("failed generation stored %d examples", total)
	}

	// A provider that answers with prose instead of JSON exhausts the
	// ChatJSON mode ladder and fails; nothing is stored.
	provider2 := newFakeProvider(t,
		scriptedCall{content: "I am unable to help with that."},
		scriptedCall{content: "I am unable to help with that."},
		scriptedCall{content: "I am unable to help with that."},
	)
	resolve2 := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider2.client(t)})
	gen2 := newGenerator(store, dakeDict(), resolve2)
	if _, err := gen2.GenerateExamples(ctx, dake.ID, testUser, 5); err == nil {
		t.Fatalf("prose-only provider must fail")
	}
	if provider2.callCount() != 3 {
		t.Fatalf("provider calls = %d, want 3 (json_schema, json_object, prompt_only)", provider2.callCount())
	}
	if total, _ := store.CountExamples(ctx, dake.ID); total != 0 {
		t.Fatalf("failed generation stored %d examples", total)
	}
}

func TestConcurrentRequestsForOnePointShareOneGeneration(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	slow := 60 * time.Millisecond
	examplesBatch := examplesReply(validExamples(0, 3)...)
	// One provider answers from the prompt itself: with single-flight the order
	// in which the explanation and examples flights reach it is not fixed.
	teach := func(messages []llm.Message) string {
		if strings.Contains(userPrompt(messages), "example sentences") {
			return examplesBatch
		}
		return explanationReply("shared explanation")
	}
	provider := newFakeProvider(t,
		scriptedCall{latency: slow, contentFor: teach},
		scriptedCall{latency: slow, contentFor: teach},
		scriptedCall{contentFor: teach}, // the later second examples flight re-runs the same batch
	)
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	start := make(chan struct{})
	var wg sync.WaitGroup
	var mu sync.Mutex
	results := map[string]int{}
	record := func(key string) {
		mu.Lock()
		results[key]++
		mu.Unlock()
	}
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			text, err := gen.EnsureExplanation(ctx, dake.ID, testUser)
			if err != nil {
				t.Errorf("EnsureExplanation: %v", err)
				return
			}
			record(text)
		}()
	}
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			out, err := gen.GenerateExamples(ctx, dake.ID, testUser, 3)
			if err != nil {
				t.Errorf("GenerateExamples: %v", err)
				return
			}
			record(fmt.Sprintf("generated=%d", out.Generated))
		}()
	}
	close(start)
	wg.Wait()

	if provider.countCallsWith("Write the explanation") != 1 {
		t.Fatalf("explanation provider calls = %d, want 1 (single-flight)", provider.countCallsWith("Write the explanation"))
	}
	if provider.countCallsWith("example sentences") != 1 {
		t.Fatalf("examples provider calls = %d, want 1 (single-flight)", provider.countCallsWith("example sentences"))
	}
	if results["shared explanation"] != 4 {
		t.Fatalf("all callers must share the explanation: %v", results)
	}
	if results["generated=3"] != 4 {
		t.Fatalf("all callers must share the generation: %v", results)
	}
	if total, _ := store.CountExamples(ctx, dake.ID); total != 3 {
		t.Fatalf("stored %d examples, want 3", total)
	}

	// After a flight finishes, a later request runs a new generation.
	out, err := gen.GenerateExamples(ctx, dake.ID, testUser, 3)
	if err != nil {
		t.Fatalf("later GenerateExamples: %v", err)
	}
	if out.Generated != 3 || out.Stored != 0 {
		t.Fatalf("later generation should accept only duplicates: %+v", out)
	}
	if provider.countCallsWith("example sentences") != 2 {
		t.Fatalf("examples provider calls = %d, want 2 (new flight after the first completed)", provider.countCallsWith("example sentences"))
	}
}

// askedCount reads the number of sentences the prompt asked for, so one fake
// provider can answer whichever flight reaches it first.
func askedCount(prompt string) int {
	i := strings.Index(prompt, "Write ")
	if i < 0 {
		return 0
	}
	n := 0
	for _, r := range prompt[i+len("Write "):] {
		if r < '0' || r > '9' {
			break
		}
		n = n*10 + int(r-'0')
	}
	return n
}

// Content is shared between Learners, but a generation is not: it runs on the
// Provider of the Learner who asked, and a Learner without a Provider must not
// decide the outcome of another Learner's request.
func TestGenerationsForDifferentLearnersDoNotShareAFlight(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	teach := func(messages []llm.Message) string {
		return explanationReply("the assigned Provider's explanation")
	}
	withProvider := newFakeProvider(t, scriptedCall{latency: 250 * time.Millisecond, contentFor: teach})
	resolve := newPerUserResolver(map[uuid.UUID]*llm.Client{
		testUser: withProvider.client(t),
		// testUserTwo has no entry: no Provider is assigned to them.
	})
	gen := newGenerator(store, dakeDict(), resolve)

	type outcome struct {
		text string
		err  error
	}
	var wg sync.WaitGroup
	var mu sync.Mutex
	results := map[uuid.UUID]outcome{}
	run := func(userID uuid.UUID) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			text, err := gen.EnsureExplanation(ctx, dake.ID, userID)
			mu.Lock()
			results[userID] = outcome{text, err}
			mu.Unlock()
		}()
	}
	run(testUser)
	time.Sleep(40 * time.Millisecond) // while that generation is still in flight
	run(testUserTwo)
	wg.Wait()

	assigned := results[testUser]
	if assigned.err != nil || assigned.text != "the assigned Provider's explanation" {
		t.Fatalf("the Learner with a Provider got %q, %v", assigned.text, assigned.err)
	}
	unassigned := results[testUserTwo]
	if !errors.Is(unassigned.err, grammar.ErrNotAssigned) {
		t.Fatalf("the Learner without a Provider got %q, %v; want ErrNotAssigned", unassigned.text, unassigned.err)
	}
	if withProvider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1 (only the Learner who has a Provider generates)", withProvider.callCount())
	}
}

// Two requests for different counts must not share one flight, or a request for
// 30 sentences is answered with another request's 2.
func TestGenerateExamplesRequestsForDifferentCountsDoNotShareAFlight(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	teach := func(messages []llm.Message) string {
		return examplesReply(validExamples(0, askedCount(userPrompt(messages)))...)
	}
	provider := newFakeProvider(t,
		scriptedCall{latency: 120 * time.Millisecond, contentFor: teach},
		scriptedCall{latency: 120 * time.Millisecond, contentFor: teach},
		scriptedCall{latency: 120 * time.Millisecond, contentFor: teach},
	)
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	var wg sync.WaitGroup
	var mu sync.Mutex
	counts := []int{}
	run := func(want int) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			out, err := gen.GenerateExamples(ctx, dake.ID, testUser, want)
			if err != nil {
				t.Errorf("GenerateExamples(%d): %v", want, err)
				return
			}
			if out.Generated != want {
				t.Errorf("GenerateExamples(%d) generated %d, want %d", want, out.Generated, want)
			}
			mu.Lock()
			counts = append(counts, out.Generated)
			mu.Unlock()
		}()
	}
	run(2)
	time.Sleep(40 * time.Millisecond) // while that generation is still in flight
	run(11)                          // needs two provider calls of its own
	wg.Wait()

	if provider.countCallsWith("example sentences") != 3 {
		t.Fatalf("examples provider calls = %d, want 3 (one for the 2-count flight, two for the 11-count flight)",
			provider.countCallsWith("example sentences"))
	}
	if len(counts) != 2 {
		t.Fatalf("results = %v, want one per request", counts)
	}
}

// A generation in flight belongs to the point and the Learner, not to whichever
// request happened to start it: one request going away must not cancel the
// generation the others are waiting for.
func TestACanceledRequestDoesNotCancelAGenerationInProgress(t *testing.T) {
	ctx := context.Background()
	store := grammartest.NewMemStore(dake)
	teach := func(messages []llm.Message) string {
		return examplesReply(validExamples(0, askedCount(userPrompt(messages)))...)
	}
	provider := newFakeProvider(t, scriptedCall{latency: 250 * time.Millisecond, contentFor: teach})
	resolve := newFakeResolver(map[aiprovider.Task]*llm.Client{aiprovider.TaskGrammarContent: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	callerCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	var wg sync.WaitGroup
	var started, kept grammar.Generation
	var startedErr error
	wg.Add(1)
	go func() { // this request starts the flight, then goes away mid-flight
		defer wg.Done()
		go func() { time.Sleep(60 * time.Millisecond); cancel() }()
		started, startedErr = gen.GenerateExamples(callerCtx, dake.ID, testUser, 3)
	}()
	time.Sleep(30 * time.Millisecond) // the flight is running
	var waitingErr error
	wg.Add(1)
	go func() { // this one queues behind it
		defer wg.Done()
		kept, waitingErr = gen.GenerateExamples(ctx, dake.ID, testUser, 3)
	}()
	wg.Wait()
	_, _ = started, startedErr // the canceled request's own outcome is not what matters here

	_ = kept // the canceled request may or may not have seen the result
	if waitingErr != nil {
		t.Fatalf("the waiting caller got %v; want the shared generation to finish", waitingErr)
	}
	if kept.Generated != 3 {
		t.Fatalf("waiting caller generated %d examples, want 3", kept.Generated)
	}
}
