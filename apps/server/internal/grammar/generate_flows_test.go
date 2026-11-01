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
	resolve := newFakeResolver(map[string]*llm.Client{grammar.TaskExamples: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	out, err := gen.GenerateExamples(ctx, dake.ID, 7, 2)
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
	resolve := newFakeResolver(map[string]*llm.Client{grammar.TaskExplanation: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	got, err := gen.EnsureExplanation(ctx, dake.ID, 7)
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
	got2, err := gen.EnsureExplanation(ctx, dake.ID, 7)
	if err != nil {
		t.Fatalf("second EnsureExplanation: %v", err)
	}
	if got2 != text {
		t.Fatalf("second explanation = %q", got2)
	}
	if provider.callCount() != 1 {
		t.Fatalf("provider calls = %d, want exactly 1", provider.callCount())
	}
	if resolve.taskCalls(grammar.TaskExplanation) != 1 {
		t.Fatalf("resolver calls = %d, want exactly 1", resolve.taskCalls(grammar.TaskExplanation))
	}
	if call := provider.call(0); call.Mode != "json_schema" {
		t.Fatalf("mode = %q, want json_schema", call.Mode)
	}
	prompt := provider.lastPrompt()
	if !strings.Contains(prompt, "〜だけ") || !strings.Contains(prompt, "N5") {
		t.Fatalf("prompt lacks pattern/level:\n%s", prompt)
	}

	if _, err := gen.EnsureExplanation(ctx, 999, 7); !errors.Is(err, grammar.ErrPointNotFound) {
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
	resolve := newFakeResolver(map[string]*llm.Client{grammar.TaskExplanation: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	got, err := gen.RegenerateExplanation(ctx, dake.ID, 7)
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
	if again, err := gen.EnsureExplanation(ctx, dake.ID, 7); err != nil || again != got {
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

	if _, err := gen.EnsureExplanation(ctx, dake.ID, 7); !errors.Is(err, grammar.ErrNotAssigned) {
		t.Fatalf("EnsureExplanation err = %v, want ErrNotAssigned", err)
	}
	if _, err := gen.GenerateExamples(ctx, dake.ID, 7, 5); !errors.Is(err, grammar.ErrNotAssigned) {
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
		resolve := newFakeResolver(map[string]*llm.Client{grammar.TaskExamples: provider.client(t)})
		gen := newGenerator(store, dakeDict(), resolve)

		out, err := gen.GenerateExamples(ctx, dake.ID, 7, tc.n)
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
	resolve := newFakeResolver(map[string]*llm.Client{grammar.TaskExamples: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)
	if _, err := gen.GenerateExamples(ctx, dake.ID, 7, 12); err != nil {
		t.Fatalf("GenerateExamples: %v", err)
	}
	if !strings.Contains(provider.lastPrompt(), "2 new example sentences") {
		t.Fatalf("second batch should ask for 2 sentences:\n%s", provider.lastPrompt())
	}

	// Out-of-range counts never reach the provider.
	store = grammartest.NewMemStore(dake)
	provider = newFakeProvider(t)
	resolve = newFakeResolver(map[string]*llm.Client{grammar.TaskExamples: provider.client(t)})
	gen = newGenerator(store, dakeDict(), resolve)
	for _, n := range []int{0, -1, grammar.MaxExamplesPerRequest + 1} {
		if _, err := gen.GenerateExamples(ctx, dake.ID, 7, n); err == nil {
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
	resolve := newFakeResolver(map[string]*llm.Client{grammar.TaskExamples: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	out, err := gen.GenerateExamples(ctx, dake.ID, 7, 10)
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
	resolve2 := newFakeResolver(map[string]*llm.Client{grammar.TaskExamples: provider2.client(t)})
	gen2 := newGenerator(store, dakeDict(), resolve2)
	out, err = gen2.GenerateExamples(ctx, dake.ID, 7, 5)
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
	resolve := newFakeResolver(map[string]*llm.Client{grammar.TaskExamples: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	out, err := gen.GenerateExamples(ctx, dake.ID, 7, 1)
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
	resolve := newFakeResolver(map[string]*llm.Client{grammar.TaskExamples: provider.client(t)})
	gen := newGenerator(store, dakeDict(), resolve)

	_, err := gen.GenerateExamples(ctx, dake.ID, 7, 5)
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
	resolve2 := newFakeResolver(map[string]*llm.Client{grammar.TaskExamples: provider2.client(t)})
	gen2 := newGenerator(store, dakeDict(), resolve2)
	if _, err := gen2.GenerateExamples(ctx, dake.ID, 7, 5); err == nil {
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
	expl := newFakeProvider(t, scriptedCall{latency: slow, content: explanationReply("shared explanation")})
	examplesReply3 := examplesReply(validExamples(0, 3)...)
	examples := newFakeProvider(t,
		scriptedCall{latency: slow, content: examplesReply3},
		scriptedCall{content: examplesReply3}, // the later second flight re-runs the same batch
	)
	resolve := newFakeResolver(map[string]*llm.Client{
		grammar.TaskExplanation: expl.client(t),
		grammar.TaskExamples:    examples.client(t),
	})
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
			text, err := gen.EnsureExplanation(ctx, dake.ID, 7)
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
			out, err := gen.GenerateExamples(ctx, dake.ID, 7, 3)
			if err != nil {
				t.Errorf("GenerateExamples: %v", err)
				return
			}
			record(fmt.Sprintf("generated=%d", out.Generated))
		}()
	}
	close(start)
	wg.Wait()

	if expl.callCount() != 1 {
		t.Fatalf("explanation provider calls = %d, want 1 (single-flight)", expl.callCount())
	}
	if examples.callCount() != 1 {
		t.Fatalf("examples provider calls = %d, want 1 (single-flight)", examples.callCount())
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
	out, err := gen.GenerateExamples(ctx, dake.ID, 7, 3)
	if err != nil {
		t.Fatalf("later GenerateExamples: %v", err)
	}
	if out.Generated != 3 || out.Stored != 0 {
		t.Fatalf("later generation should accept only duplicates: %+v", out)
	}
	if examples.callCount() != 2 {
		t.Fatalf("examples provider calls = %d, want 2 (new flight after the first completed)", examples.callCount())
	}
}
