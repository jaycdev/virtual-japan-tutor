package grammar

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/singleflight"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// ProviderResolver reports which Provider serves a generation task for one
// Learner. aiprovider.Service implements it exactly; tests replace it with a
// fake. aiprovider.ErrNotAssigned passes through untouched so the HTTP layer
// can answer 409.
type ProviderResolver interface {
	ResolveProvider(ctx context.Context, userID uuid.UUID, task aiprovider.Task) (aiprovider.Resolved, error)
}

// TaskGrammarContent is the single AI task both generation flows resolve:
// explanations and example sentences come from the provider the Learner
// assigned to it in their AI settings.
const TaskGrammarContent = aiprovider.TaskGrammarContent

// Generation bounds. One provider call asks for exampleBatch candidates; a
// single GenerateExamples request makes at most maxProviderCalls calls.
const (
	exampleBatch          = 10
	maxProviderCalls      = 3
	MaxExamplesPerRequest = exampleBatch * maxProviderCalls
	// MaxExamplesPerPoint caps how many example sentences one Grammar Point holds.
	MaxExamplesPerPoint = 30
)

// Generator produces Grammar Point content through the Learner's assigned AI
// Provider and stores it through a Store. No candidate sentence is trusted:
// every one goes through Validator before it can reach the Store, and rejected
// ones are reported instead of stored. Generations are deduplicated per
// Learner, Grammar Point and task, so concurrent requests for the same thing
// share one run instead of double-spending the provider.
type Generator struct {
	store   Store
	dict    Dictionary
	resolve ProviderResolver

	group singleflight.Group
}

func NewGenerator(store Store, dict Dictionary, resolve ProviderResolver) *Generator {
	return &Generator{store: store, dict: dict, resolve: resolve}
}

// ErrNotAssigned means no Provider is assigned to the generation task.
var ErrNotAssigned = aiprovider.ErrNotAssigned

// CandidateRejection records why one candidate sentence was discarded.
type CandidateRejection struct {
	Sentence string
	Reasons  []string // "unknown_word: \"...\" is not in JMdict" …
}

// Generation is the outcome of one GenerateExamples call: how many sentences
// were stored, and every discarded candidate with its reasons.
type Generation struct {
	Generated  int
	Stored     int // rows actually inserted (duplicates count as Generated but not new rows)
	Rejected   int
	Counts     map[string]int // rejections per reason code
	Rejections []CandidateRejection
	Note       string
}

// flightResult carries a generation through the singleflight group, errors included.
type flightResult struct {
	text       string
	generation Generation
	err        error
}

// flightTimeout bounds one shared generation flight: a flight may make up to
// maxProviderCalls provider calls, and every caller waiting behind it waits on it.
const flightTimeout = 3 * time.Minute

// explanationKey and examplesKey scope a flight to one Learner, and a generation
// to the count it was asked for. Content is shared between Learners, but the
// Provider (its key, its cost, and whether there is one at all) is not, and a
// request for 30 sentences must not be answered with another request's 2.
func explanationKey(userID uuid.UUID, pointID int64) string {
	return fmt.Sprintf("explanation:%s:%d", userID, pointID)
}

func examplesKey(userID uuid.UUID, pointID int64, n int) string {
	return fmt.Sprintf("examples:%s:%d:%d", userID, pointID, n)
}

// do runs run once per key, sharing one result with concurrent callers. The
// flight runs on a context detached from the caller that started it: one request
// going away (a closed browser tab, a deadline) must not cancel the generation
// the others are waiting for.
func (gen *Generator) do(ctx context.Context, key string, run func(context.Context) flightResult) flightResult {
	res, errAny, _ := gen.group.Do(key, func() (any, error) {
		flightCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), flightTimeout)
		defer cancel()
		return run(flightCtx), nil
	})
	if errAny != nil {
		return flightResult{err: fmt.Errorf("grammar: generation failed: %v", errAny)}
	}
	out, ok := res.(flightResult)
	if !ok {
		return flightResult{err: fmt.Errorf("grammar: unexpected generation result")}
	}
	return out
}

// EnsureExplanation returns a point's explanation, generating and storing one
// only when the point has none. An existing explanation is never touched here:
// replacing it is RegenerateExplanation's job.
func (gen *Generator) EnsureExplanation(ctx context.Context, pointID int64, userID uuid.UUID) (string, error) {
	content, err := gen.store.Content(ctx, pointID)
	if err != nil {
		return "", err
	}
	if content.Explanation != nil && *content.Explanation != "" {
		return *content.Explanation, nil
	}
	res := gen.do(ctx, explanationKey(userID, pointID), func(flightCtx context.Context) flightResult {
		// Another concurrent request may have stored one while this flight queued.
		content, err := gen.store.Content(flightCtx, pointID)
		if err != nil {
			return flightResult{err: err}
		}
		if content.Explanation != nil && *content.Explanation != "" {
			return flightResult{text: *content.Explanation}
		}
		text, err := gen.explain(flightCtx, pointID, userID, false)
		return flightResult{text: text, err: err}
	})
	return res.text, res.err
}

// RegenerateExplanation generates a new explanation and replaces the stored one.
func (gen *Generator) RegenerateExplanation(ctx context.Context, pointID int64, userID uuid.UUID) (string, error) {
	res := gen.do(ctx, explanationKey(userID, pointID), func(flightCtx context.Context) flightResult {
		text, err := gen.explain(flightCtx, pointID, userID, true)
		return flightResult{text: text, err: err}
	})
	return res.text, res.err
}

func (gen *Generator) explain(ctx context.Context, pointID int64, userID uuid.UUID, fresh bool) (string, error) {
	resolved, err := gen.resolve.ResolveProvider(ctx, userID, TaskGrammarContent)
	if err != nil {
		return "", err
	}
	if resolved.Client == nil {
		return "", ErrNotAssigned
	}
	point, err := gen.store.Point(ctx, pointID)
	if err != nil {
		return "", err
	}
	start := "Write the explanation"
	if fresh {
		start = "Write a fresh explanation replacing the current one"
	}
	prompt := fmt.Sprintf(`You teach Japanese grammar to English-speaking JLPT learners.
%s for the Grammar Point "%s" (JLPT level %s).
%s
Reply in English using short markdown: paragraphs, **bold** for the pattern, bullet lists.
Cover: how the pattern is formed, what it means, when it is used. Keep it under 250 words.`,
		start, point.Pattern, point.Level, meaningLine(point))

	res, err := resolved.Client.ChatJSON(ctx,
		[]llm.Message{
			{Role: llm.RoleSystem, Content: "You are a careful Japanese grammar teacher."},
			{Role: llm.RoleUser, Content: prompt},
		},
		llm.Schema{
			Name:   "grammar_explanation",
			Schema: json.RawMessage(`{"type":"object","properties":{"explanation":{"type":"string"}},"required":["explanation"],"additionalProperties":false}`),
		},
		llm.Options{MaxTokens: 800},
	)
	if err != nil {
		return "", fmt.Errorf("grammar: generate explanation: %w", err)
	}
	var out struct {
		Explanation string `json:"explanation"`
	}
	if err := json.Unmarshal(res.JSON, &out); err != nil {
		return "", fmt.Errorf("grammar: parse explanation: %w", err)
	}
	if strings.TrimSpace(out.Explanation) == "" {
		return "", fmt.Errorf("grammar: the provider returned an empty explanation")
	}
	if err := gen.store.SetExplanation(ctx, pointID, out.Explanation, false); err != nil {
		return "", err
	}
	return out.Explanation, nil
}

// GenerateExamples asks the provider for up to n new example sentences in
// batches of exampleBatch, with at most maxProviderCalls provider calls.
// Validated candidates are stored; rejected ones are discarded and reported.
// Existing examples are kept: generation only appends.
func (gen *Generator) GenerateExamples(ctx context.Context, pointID int64, userID uuid.UUID, n int) (Generation, error) {
	if n <= 0 || n > MaxExamplesPerRequest {
		return Generation{}, fmt.Errorf("grammar: count must be between 1 and %d", MaxExamplesPerRequest)
	}
	res := gen.do(ctx, examplesKey(userID, pointID, n), func(flightCtx context.Context) flightResult {
		g, err := gen.generateExamples(flightCtx, pointID, userID, n)
		return flightResult{generation: g, err: err}
	})
	return res.generation, res.err
}

// EnsureExamples returns how many examples a point holds, generating new ones
// only when it holds fewer than atLeast. Generation only ever appends, and the
// point's cap still applies, so this is the reading-side top-up: it never
// replaces what is already there.
func (gen *Generator) EnsureExamples(ctx context.Context, pointID int64, userID uuid.UUID, atLeast int) (int, error) {
	existing, err := gen.store.CountExamples(ctx, pointID)
	if err != nil {
		return 0, err
	}
	if existing >= atLeast {
		return existing, nil
	}
	want := atLeast - existing
	res := gen.do(ctx, examplesKey(userID, pointID, want), func(flightCtx context.Context) flightResult {
		// Another concurrent request may have filled the point while this flight queued.
		now, err := gen.store.CountExamples(flightCtx, pointID)
		if err != nil {
			return flightResult{err: err}
		}
		if now >= atLeast {
			return flightResult{generation: Generation{Note: "another generation already filled this point"}}
		}
		g, err := gen.generateExamples(flightCtx, pointID, userID, atLeast-now)
		return flightResult{generation: g, err: err}
	})
	return existing + res.generation.Stored, res.err
}

func (gen *Generator) generateExamples(ctx context.Context, pointID int64, userID uuid.UUID, n int) (Generation, error) {
	resolved, err := gen.resolve.ResolveProvider(ctx, userID, TaskGrammarContent)
	if err != nil {
		return Generation{}, err
	}
	if resolved.Client == nil {
		return Generation{}, ErrNotAssigned
	}
	point, err := gen.store.Point(ctx, pointID)
	if err != nil {
		return Generation{}, err
	}
	existing, err := gen.store.CountExamples(ctx, pointID)
	if err != nil {
		return Generation{}, err
	}
	room := MaxExamplesPerPoint - existing
	if room <= 0 {
		return Generation{Note: fmt.Sprintf("this point already holds the maximum of %d examples", MaxExamplesPerPoint)}, nil
	}
	want := min(n, room)

	validator := NewValidator(gen.dict)
	generation := Generation{Counts: map[string]int{}}
	if want < n {
		generation.Note = fmt.Sprintf("only %d of the %d requested fit: this point holds at most %d", want, n, MaxExamplesPerPoint)
	}

	for calls := 0; generation.Generated < want && calls < maxProviderCalls; calls++ {
		count := min(want-generation.Generated, exampleBatch)
		res, err := resolved.Client.ChatJSON(ctx,
			[]llm.Message{
				{Role: llm.RoleSystem, Content: "You are a careful Japanese grammar teacher."},
				{Role: llm.RoleUser, Content: examplesPrompt(point, count)},
			},
			llm.Schema{Name: "grammar_examples", Schema: examplesSchema},
			llm.Options{MaxTokens: 1200},
		)
		if err != nil {
			return Generation{}, fmt.Errorf("grammar: generate examples: %w", err)
		}
		var batch struct {
			Examples []generatedExample `json:"examples"`
		}
		if err := json.Unmarshal(res.JSON, &batch); err != nil {
			return Generation{}, fmt.Errorf("grammar: parse examples: %w", err)
		}

		for _, gg := range batch.Examples {
			if generation.Generated >= want {
				break
			}
			c := gg.candidate()
			rejections, err := validator.Validate(ctx, point, c)
			if err != nil {
				return Generation{}, err
			}
			if len(rejections) > 0 {
				candidate := CandidateRejection{Sentence: c.SentenceJA}
				for _, r := range rejections {
					candidate.Reasons = append(candidate.Reasons, r.String())
					generation.Counts[string(r.Reason)]++
				}
				generation.Rejected++
				generation.Rejections = append(generation.Rejections, candidate)
				continue
			}
			added, err := gen.store.AddExample(ctx, pointID, c)
			if err != nil {
				return Generation{}, err
			}
			generation.Generated++
			if added {
				generation.Stored++
			}
		}
	}
	return generation, nil
}

// generatedExample is one entry of the provider's reply, in the JSON shape the
// schema asks for. The span arrives as start+length; the server re-derives the
// span text from the sentence and never trusts the model's own wording of it.
type generatedExample struct {
	SentenceJA  string `json:"sentence_ja"`
	Translation string `json:"translation_en"`
	SpanStart   int    `json:"span_start"`
	SpanLength  int    `json:"span_length"`
}

func (gg generatedExample) candidate() Candidate {
	c := Candidate{
		SentenceJA:  gg.SentenceJA,
		Translation: gg.Translation,
		SpanStart:   gg.SpanStart,
		SpanEnd:     gg.SpanStart + gg.SpanLength,
	}
	runes := []rune(c.SentenceJA)
	if c.SpanStart >= 0 && c.SpanEnd <= len(runes) && c.SpanStart < c.SpanEnd {
		c.SpanText = string(runes[c.SpanStart:c.SpanEnd])
	}
	return c
}

func examplesPrompt(point refdata.GrammarPoint, n int) string {
	var b strings.Builder
	fmt.Fprintf(&b, `You teach Japanese grammar to English-speaking JLPT learners.
Write %d new example sentences using the Grammar Point "%s" (JLPT level %s).
%s
Rules for every sentence:
- Natural Japanese a learner at this level can read, in kana and kanji.
- Between 6 and 30 characters long.
- Plain text only: no markdown, no quotes, no brackets or parentheses.
- Mark the span that realises the pattern: its start is the position of its first
  character (counting from 0) and its length is the number of characters. The span
  must cover whole words, and may use any correct conjugation of the pattern
  (for example てしまいました for てしまう).
- Add a short English translation.
Every word must be a real common Japanese word.`,
		n, point.Pattern, point.Level, meaningLine(point))
	if len(point.Variants) > 1 {
		fmt.Fprintf(&b, " The accepted variants are: %s.", strings.Join(point.Variants, ", "))
	}
	return b.String()
}

func meaningLine(point refdata.GrammarPoint) string {
	if point.Meaning == "" {
		return ""
	}
	return "Meaning: " + point.Meaning + "\n\n"
}

var examplesSchema = json.RawMessage(`{"type":"object","properties":{"examples":{"type":"array","items":{
	"type":"object",
	"properties":{
		"sentence_ja":{"type":"string"},
		"translation_en":{"type":"string"},
		"span_start":{"type":"integer"},
		"span_length":{"type":"integer"}
	},
	"required":["sentence_ja","translation_en","span_start","span_length"],
	"additionalProperties":false
}}},"required":["examples"],"additionalProperties":false}`)
