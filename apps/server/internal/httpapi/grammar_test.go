package httpapi_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider/aiprovidertest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar/grammartest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

// The grammar tests never call a real AI provider: assignments are made
// through the real /ai-providers API and completions land on an httptest
// server that speaks the OpenAI-compatible protocol.

// --- catalogue fixtures ---

var (
	gDake = refdata.GrammarPoint{
		ID: 1, Level: "N5", Number: 1, Ordinal: 1,
		Pattern: "〜だけ", Meaning: "only; just", Variants: []string{"〜だけ"},
		NormalisedPattern: "だけ", NormalisedVariants: []string{"だけ"},
	}
	gShimau = refdata.GrammarPoint{
		ID: 2, Level: "N4", Number: 1, Ordinal: 1,
		Pattern: "〜てしまう", Meaning: "end up doing (unintentionally)", Variants: []string{"〜てしまう"},
		NormalisedPattern: "てしまう", NormalisedVariants: []string{"てしまう"},
	}
	gAru = refdata.GrammarPoint{
		ID: 3, Level: "N5", Number: 2, Ordinal: 1,
		Pattern: "〜がある", Meaning: "there is; to have", Variants: []string{"〜がある"},
		NormalisedPattern: "がある", NormalisedVariants: []string{"がある"},
	}
	gHajimaru = refdata.GrammarPoint{
		ID: 4, Level: "N3", Number: 1, Ordinal: 1,
		Pattern: "〜始める", Romaji: "hajimeru", Meaning: "to start doing", Variants: []string{"〜始める"},
		NormalisedPattern: "はじめる", NormalisedVariants: []string{"はじめる"},
	}
)

// --- fake AI endpoint ---

// fakeAI answers scripted chat completions in order; a spent script answers 500.
type fakeAI struct {
	url string

	mu      sync.Mutex
	replies []string
	calls   int
	lastReq struct {
		Auth string
		Body map[string]any
	}
}

func newFakeAI(t *testing.T, replies ...string) *fakeAI {
	t.Helper()
	f := &fakeAI{replies: replies}
	srv := httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(srv.Close)
	f.url = srv.URL
	return f
}

func (f *fakeAI) handle(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":{"message":"fake AI got invalid JSON"}}`, http.StatusBadRequest)
		return
	}
	f.mu.Lock()
	f.calls++
	f.lastReq.Auth = r.Header.Get("Authorization")
	f.lastReq.Body = body
	exhausted := f.calls > len(f.replies)
	content := ""
	if !exhausted {
		content = f.replies[f.calls-1]
	}
	f.mu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	if exhausted {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"fake AI script exhausted"}}`))
		return
	}
	_ = json.NewEncoder(w).Encode(map[string]any{
		"model": "test-model",
		"choices": []any{map[string]any{
			"index":         0,
			"message":       map[string]any{"role": "assistant", "content": content},
			"finish_reason": "stop",
		}},
	})
}

func (f *fakeAI) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func (f *fakeAI) lastAuth() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.lastReq.Auth
}

// --- scripted replies ---

type gExample struct {
	Sentence    string
	Translation string
	Start       int
	Length      int
}

func examplesJSON(items ...gExample) string {
	raw := make([]map[string]any, 0, len(items))
	for _, g := range items {
		raw = append(raw, map[string]any{
			"sentence_ja":    g.Sentence,
			"translation_en": g.Translation,
			"span_start":     g.Start,
			"span_length":    g.Length,
		})
	}
	out, err := json.Marshal(map[string]any{"examples": raw})
	if err != nil {
		panic(err)
	}
	return string(out)
}

func explanationJSON(text string) string {
	out, err := json.Marshal(map[string]any{"explanation": text})
	if err != nil {
		panic(err)
	}
	return string(out)
}

// gDict knows the words the scripted sentences use (particles, auxiliaries and
// punctuation are exempt from the dictionary by design).
func gDict() *grammartest.MemDictionary {
	return grammartest.NewMemDictionary(
		"これ", "ねこ", "ほん", "みず", "いぬ", "とり", "まど", "かべ", "ゆか", "ふく", "いす", "こども",
		"だけ", "ください", "みる", "たべる", "かわいい",
	)
}

// gValid makes n unique sentences that pass validation for gDake, continuing a
// fixed schedule so repeated batches stay distinct.
var gNouns = []string{"これ", "ねこ", "ほん", "みず", "いぬ", "とり", "まど", "かべ", "ゆか", "ふく", "いす", "こども"}

func gValid(offset, n int) []gExample {
	out := make([]gExample, 0, n)
	for i := offset; i < offset+n; i++ {
		noun := gNouns[i%len(gNouns)]
		var sentence, translation string
		if i%2 == 0 {
			sentence = noun + "だけください。"
			translation = fmt.Sprintf("Just the %s, please.", noun)
		} else {
			sentence = noun + "だけをみました。"
			translation = fmt.Sprintf("I only saw the %s.", noun)
		}
		idx := strings.Index(sentence, "だけ")
		out = append(out, gExample{Sentence: sentence, Translation: translation,
			Start: len([]rune(sentence[:idx])), Length: len([]rune("だけ"))})
	}
	return out
}

// --- environment ---

type grammarEnv struct {
	env
	store *grammartest.MemStore
	fake  *fakeAI
}

// newGrammarEnv wires the grammar routes over the in-memory store and the real
// aiprovider.Service (in-memory store, real secrets box), whose assigned
// provider points at fakeAI. llm retries are disabled so failure paths stay
// deterministic.
func newGrammarEnv(t *testing.T, points ...refdata.GrammarPoint) grammarEnv {
	t.Helper()
	clock := authtest.NewFakeClock()
	svc := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour, Now: clock.Now})
	for _, name := range []string{"alice", "bob"} {
		if _, err := svc.CreateUser(context.Background(), name, password); err != nil {
			t.Fatal(err)
		}
	}
	box, err := secrets.NewFromKey(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	ai := aiprovider.NewService(aiprovidertest.NewMemStore(), box, aiprovider.WithClientOptions(
		llm.WithMaxAttempts(1),
		llm.WithSleep(func(context.Context, time.Duration) error { return nil }),
		llm.WithRand(func() float64 { return 0 }),
	))
	fake := newFakeAI(t)
	store := grammartest.NewMemStore(points...)
	gen := grammar.NewGenerator(store, gDict(), ai)
	h := httpapi.New(fakeDB{}, svc, httpapi.WithAIProviders(ai), httpapi.WithGrammar(store, gen))
	e := env{h: h, svc: svc, clock: clock, ai: ai}
	return grammarEnv{env: e, store: store, fake: fake}
}

// assignProvider connects fakeAI to the grammar_content task through the
// public API (the same path a Learner uses in the settings screen).
func (g grammarEnv) assignProvider(t *testing.T, token string) {
	t.Helper()
	rec := g.do(t, "POST", "/ai-providers", "Bearer "+token, map[string]any{
		"name": "fake", "baseUrl": g.fake.url, "model": "test-model", "apiKey": "fake-key",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("create provider = %d %s", rec.Code, rec.Body)
	}
	var p struct{ Id string }
	mustJSON(t, rec, &p)
	rec = g.do(t, "PUT", "/ai-tasks/grammar_content", "Bearer "+token, map[string]any{"providerId": p.Id})
	if rec.Code != http.StatusOK {
		t.Fatalf("assign task = %d %s", rec.Code, rec.Body)
	}
}

// --- response shapes ---

type detailBody struct {
	ID                int    `json:"id"`
	JlptLevel         string `json:"jlptLevel"`
	CatalogueNumber   int    `json:"catalogueNumber"`
	Pattern           string `json:"pattern"`
	Meaning           string `json:"meaning"`
	Explanation       string `json:"explanation"`
	ExplanationEdited bool   `json:"explanationEdited"`
	Examples          []struct {
		SentenceJa    string `json:"sentenceJa"`
		TranslationEn string `json:"translationEn"`
		SpanStart     int    `json:"spanStart"`
		SpanEnd       int    `json:"spanEnd"`
		SpanText      string `json:"spanText"`
		Source        string `json:"source"`
	} `json:"examples"`
}

type generationBody struct {
	Generated  int    `json:"generated"`
	Stored     int    `json:"stored"`
	Rejected   int    `json:"rejected"`
	Note       string `json:"note"`
	Rejections []struct {
		Code     string `json:"code"`
		Message  string `json:"message"`
		Sentence string `json:"sentence"`
	} `json:"rejections"`
	Examples []struct {
		SentenceJa string `json:"sentenceJa"`
		SpanText   string `json:"spanText"`
	} `json:"examples"`
}

// --- tests ---

func TestGrammarRoutesRequireAuth(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	wantError(t, e.do(t, "GET", "/grammar/points", "", nil), http.StatusUnauthorized, "unauthorized")
	wantError(t, e.do(t, "GET", "/grammar/points/1", "", nil), http.StatusUnauthorized, "unauthorized")
	wantError(t, e.do(t, "POST", "/grammar/points/1/examples", "", nil), http.StatusUnauthorized, "unauthorized")
}

func TestGrammarListFiltersPagesAndCounts(t *testing.T) {
	e := newGrammarEnv(t, gDake, gShimau, gAru, gHajimaru)
	tok := e.login(t, "alice")
	if _, err := e.store.AddExample(t.Context(), 1, grammar.Candidate{
		SentenceJA: "ねこだけください。", Translation: "Just the cat, please.", SpanStart: 2, SpanEnd: 4, SpanText: "だけ",
	}); err != nil {
		t.Fatal(err)
	}

	page := func(path string) (int, []map[string]any) {
		t.Helper()
		rec := e.do(t, "GET", path, "Bearer "+tok, nil)
		if rec.Code != http.StatusOK {
			t.Fatalf("GET %s = %d %s", path, rec.Code, rec.Body)
		}
		var out struct {
			Items  []map[string]any `json:"items"`
			Total  int              `json:"total"`
			Limit  int              `json:"limit"`
			Offset int              `json:"offset"`
		}
		mustJSON(t, rec, &out)
		return out.Total, out.Items
	}

	total, items := page("/grammar/points")
	if total != 4 || len(items) != 4 {
		t.Fatalf("total/items = %d/%d, want 4/4", total, len(items))
	}
	// Catalogue order: N5 by number, then N4, N3.
	for i, want := range []float64{1, 3, 2, 4} {
		if items[i]["id"] != want {
			t.Fatalf("items[%d].id = %v, want %v (order %v)", i, items[i]["id"], want, items)
		}
	}
	if items[0]["jlptLevel"] != "N5" || items[0]["pattern"] != "〜だけ" || items[0]["exampleCount"] != 1.0 {
		t.Fatalf("first row = %v", items[0])
	}
	if items[0]["hasExplanation"] != false {
		t.Fatalf("fresh point should report no explanation: %v", items[0])
	}

	if _, items := page("/grammar/points?level=N4"); len(items) != 1 || items[0]["id"] != 2.0 {
		t.Fatalf("level=N4 -> %v", items)
	}
	if total, items := page("/grammar/points?q=hajimeru"); total != 1 || items[0]["id"] != 4.0 {
		t.Fatalf("q=hajimeru -> total %d items %v", total, items)
	}
	total, items = page("/grammar/points?limit=1&offset=1")
	if total != 4 || len(items) != 1 || items[0]["id"] != 3.0 {
		t.Fatalf("limit=1&offset=1 -> total %d items %v", total, items)
	}

	for _, bad := range []string{"level=N7", "limit=0", "limit=500", "offset=-1"} {
		wantError(t, e.do(t, "GET", "/grammar/points?"+bad, "Bearer "+tok, nil), http.StatusBadRequest, "bad_request")
	}
}

// TestFirstReadGeneratesSecondIsFree is the issue's core promise: the first
// detail read asks the provider for the content it is missing (an explanation
// and a first batch of examples); every later read is served from storage.
func TestFirstReadGeneratesSecondIsFree(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	e.fake.replies = []string{
		explanationJSON("**〜だけ** means “only, just”. It attaches to a noun or a て-form verb."),
		examplesJSON(gValid(0, grammar.MinExamplesPerPoint)...),
	}
	e.assignProvider(t, tok)

	var first detailBody
	rec := e.do(t, "GET", "/grammar/points/1", "Bearer "+tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET detail = %d %s", rec.Code, rec.Body)
	}
	mustJSON(t, rec, &first)
	if first.Explanation == "" || first.ExplanationEdited {
		t.Fatalf("generated detail = %+v", first)
	}
	if first.ID != 1 || first.JlptLevel != "N5" || first.Pattern != "〜だけ" || first.CatalogueNumber != 1 {
		t.Fatalf("catalogue fields wrong: %+v", first)
	}
	if e.fake.callCount() != 2 {
		t.Fatalf("provider calls = %d, want 2 (one explanation, one batch of examples)", e.fake.callCount())
	}
	if e.fake.lastAuth() != "Bearer fake-key" {
		t.Fatalf("provider auth header = %q", e.fake.lastAuth())
	}

	rec2 := e.do(t, "GET", "/grammar/points/1", "Bearer "+tok, nil)
	var second detailBody
	mustJSON(t, rec2, &second)
	if second.Explanation != first.Explanation {
		t.Fatalf("second read = %q, want the stored explanation", second.Explanation)
	}
	if e.fake.callCount() != 2 {
		t.Fatalf("second read spent the provider again (calls %d)", e.fake.callCount())
	}
}

// Issue #8's promise is "a stored explanation and at least N checked example
// sentences, generating them if missing": a detail read tops the point up to
// grammar.MinExamplesPerPoint, and only the first read spends the provider.
func TestReadTopsUpExampleSentences(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	e.fake.replies = []string{
		explanationJSON("**〜だけ** means “only, just”."),
		examplesJSON(gValid(0, grammar.MinExamplesPerPoint)...),
	}
	e.assignProvider(t, tok)

	first := e.grammarDetail(t, tok, 1)
	if first.Explanation == "" {
		t.Fatalf("first read = %+v, want a generated explanation", first)
	}
	if len(first.Examples) < grammar.MinExamplesPerPoint {
		t.Fatalf("first read returned %d examples, want at least %d",
			len(first.Examples), grammar.MinExamplesPerPoint)
	}
	if e.fake.callCount() != 2 {
		t.Fatalf("provider calls = %d, want 2 (one explanation, one batch of examples)", e.fake.callCount())
	}

	second := e.grammarDetail(t, tok, 1)
	if len(second.Examples) != len(first.Examples) {
		t.Fatalf("second read returned %d examples, want the stored %d", len(second.Examples), len(first.Examples))
	}
	if e.fake.callCount() != 2 {
		t.Fatalf("second read spent the provider again (calls %d)", e.fake.callCount())
	}
}

func TestDetailReadWithoutProviderIsServed(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	rec := e.do(t, "GET", "/grammar/points/1", "Bearer "+tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET detail = %d %s", rec.Code, rec.Body)
	}
	var body detailBody
	mustJSON(t, rec, &body)
	if body.Explanation != "" || len(body.Examples) != 0 {
		t.Fatalf("unassigned point = %+v, want empty explanation and no examples", body)
	}
	if e.fake.callCount() != 0 {
		t.Fatalf("no provider is assigned, yet %d calls were made", e.fake.callCount())
	}
}

func TestUnknownOrMalformedPointIs404(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	for _, bad := range []string{"/grammar/points/999", "/grammar/points/abc", "/grammar/points/0", "/grammar/points/-3"} {
		wantError(t, e.do(t, "GET", bad, "Bearer "+tok, nil), http.StatusNotFound, "not_found")
	}
	e.assignProvider(t, tok)
	wantError(t, e.do(t, "POST", "/grammar/points/999/examples", "Bearer "+tok, nil), http.StatusNotFound, "not_found")
	wantError(t, e.do(t, "PATCH", "/grammar/points/999", "Bearer "+tok, map[string]any{"explanation": "x"}), http.StatusNotFound, "not_found")
}

func TestGenerationWithoutProviderIs409(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	for _, req := range []struct {
		method string
		path   string
		body   any
	}{
		{"POST", "/grammar/points/1/examples", nil},
		{"POST", "/grammar/points/1/explanation/regenerate", nil},
	} {
		rec := e.do(t, req.method, req.path, "Bearer "+tok, req.body)
		wantError(t, rec, http.StatusConflict, "no_ai_provider")
		if !strings.Contains(strings.ToLower(rec.Body.String()), "grammar") {
			t.Fatalf("409 body should name the grammar task: %s", rec.Body)
		}
	}
	if e.fake.callCount() != 0 {
		t.Fatalf("unassigned requests must not reach the provider (%d calls)", e.fake.callCount())
	}
}

// TestExamplesGenerationDiscardsInvalidCandidates covers the four rejection
// categories end to end: span mismatch, non-JMdict word, markdown wrapper and
// wrong length. Only the valid sentences reach storage.
func TestExamplesGenerationDiscardsInvalidCandidates(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	e.fake.replies = []string{examplesJSON(
		gExample{Sentence: "**これだけください。**", Translation: "Only this, please.", Start: 4, Length: 2},
		gExample{Sentence: "ねこだけぷりづんをたべた。", Translation: "The cat only ate gibberish.", Start: 2, Length: 2},
		gExample{Sentence: "ねこだけください。", Translation: "Wrong span here.", Start: 6, Length: 3},
		gExample{Sentence: "たべて", Translation: "I ate.", Start: 0, Length: 3},
		gValid(0, 1)[0],
		gValid(1, 1)[0],
	)}
	e.assignProvider(t, tok)

	rec := e.do(t, "POST", "/grammar/points/1/examples", "Bearer "+tok, map[string]any{"count": 2})
	if rec.Code != http.StatusOK {
		t.Fatalf("POST examples = %d %s", rec.Code, rec.Body)
	}
	var out generationBody
	mustJSON(t, rec, &out)
	if out.Generated != 2 || out.Stored != 2 || out.Rejected != 4 {
		t.Fatalf("generated/stored/rejected = %d/%d/%d, want 2/2/4 (%+v)", out.Generated, out.Stored, out.Rejected, out)
	}
	// The span the model claims (start 6, length 3) is re-derived server-side,
	// so a mis-placed span surfaces through the tokenisation rules, not as a
	// claim-vs-text mismatch.
	allowed := map[string]bool{"disallowed_characters": true, "unknown_word": true, "span_not_in_pattern": true, "span_not_in_tokenisation": true, "too_short": true}
	seen := map[string]bool{}
	for _, r := range out.Rejections {
		if !allowed[r.Code] {
			t.Fatalf("unexpected rejection code %q (%+v)", r.Code, r)
		}
		seen[r.Code] = true
		if r.Sentence == "" || r.Message == "" {
			t.Fatalf("rejection must name the sentence and reason: %+v", r)
		}
	}
	for _, code := range []string{"disallowed_characters", "unknown_word", "span_not_in_pattern", "too_short"} {
		if !seen[code] {
			t.Fatalf("rejection %s never reported: %+v", code, out.Rejections)
		}
	}
	if len(out.Examples) != 2 {
		t.Fatalf("result examples = %d, want 2", len(out.Examples))
	}
	if e.fake.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1 (batch covered the request)", e.fake.callCount())
	}

	// Storage holds only the valid sentences, spans intact.
	detail := e.grammarDetail(t, tok, 1)
	if len(detail.Examples) != 2 {
		t.Fatalf("stored examples = %d, want 2", len(detail.Examples))
	}
	for _, ex := range detail.Examples {
		runes := []rune(ex.SentenceJa)
		if string(runes[ex.SpanStart:ex.SpanEnd]) != ex.SpanText || ex.SpanText != "だけ" || ex.Source != "ai" {
			t.Fatalf("stored example wrong: %+v", ex)
		}
	}
}

func TestExampleCountValidation(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	e.assignProvider(t, tok)
	for _, body := range []any{
		map[string]any{"count": 0},
		map[string]any{"count": 31},
		map[string]any{"count": -5},
		"{nope",
	} {
		wantError(t, e.do(t, "POST", "/grammar/points/1/examples", "Bearer "+tok, body), http.StatusBadRequest, "bad_request")
	}
	if e.fake.callCount() != 0 {
		t.Fatalf("invalid counts reached the provider (%d calls)", e.fake.callCount())
	}
}

func TestExampleCapAnswersWithNoteInsteadOfProviderSpend(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	for i := 0; i < grammar.MaxExamplesPerPoint-2; i++ {
		sentence := fmt.Sprintf("これ%dだけください。", i)
		if _, err := e.store.AddExample(t.Context(), 1, grammar.Candidate{
			SentenceJA: sentence, Translation: "Just this.", SpanStart: 0, SpanEnd: 2, SpanText: "だけ",
		}); err != nil {
			t.Fatal(err)
		}
	}
	e.fake.replies = []string{examplesJSON(toGExamples(gValid(0, 10))...)}
	e.assignProvider(t, tok)

	rec := e.do(t, "POST", "/grammar/points/1/examples", "Bearer "+tok, map[string]any{"count": 10})
	var out generationBody
	mustJSON(t, rec, &out)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST examples = %d %s", rec.Code, rec.Body)
	}
	if out.Generated != 2 || out.Stored != 2 || out.Note == "" {
		t.Fatalf("at cap = %+v, want 2 stored and a note", out)
	}

	// A full point spends nothing.
	rec = e.do(t, "POST", "/grammar/points/1/examples", "Bearer "+tok, nil)
	mustJSON(t, rec, &out)
	if out.Generated != 0 || out.Stored != 0 || out.Rejected != 0 || out.Note == "" {
		t.Fatalf("full point = %+v", out)
	}
	if e.fake.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1 (the full point made none)", e.fake.callCount())
	}
}

func TestPatchPersistsAndSurvivesLaterReads(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	e.fake.replies = []string{examplesJSON(gValid(0, grammar.MinExamplesPerPoint)...)}
	e.assignProvider(t, tok)

	rec := e.do(t, "PATCH", "/grammar/points/1", "Bearer "+tok, map[string]any{"explanation": "My own note about **だけ**."})
	if rec.Code != http.StatusOK {
		t.Fatalf("PATCH = %d %s", rec.Code, rec.Body)
	}
	var body detailBody
	mustJSON(t, rec, &body)
	if body.Explanation != "My own note about **だけ**." || !body.ExplanationEdited {
		t.Fatalf("PATCH body = %+v", body)
	}
	if e.fake.callCount() != 0 {
		t.Fatalf("PATCH must not touch the provider (%d calls)", e.fake.callCount())
	}

	// Later reads serve the stored text and never regenerate it. The one provider
	// spend they may make is topping the point up to MinExamplesPerPoint examples.
	detail := e.grammarDetail(t, tok, 1)
	if detail.Explanation != "My own note about **だけ**." || !detail.ExplanationEdited {
		t.Fatalf("after PATCH: %+v", detail)
	}
	if e.fake.callCount() != 1 {
		t.Fatalf("provider calls = %d, want 1 (the example top-up, nothing else)", e.fake.callCount())
	}

	wantError(t, e.do(t, "PATCH", "/grammar/points/1", "Bearer "+tok, map[string]any{"explanation": "   "}), http.StatusBadRequest, "bad_request")
	wantError(t, e.do(t, "PATCH", "/grammar/points/1", "Bearer "+tok, "{}"), http.StatusBadRequest, "bad_request")
}

func TestRegenerateReplacesStoredExplanation(t *testing.T) {
	e := newGrammarEnv(t, gDake)
	tok := e.login(t, "alice")
	// In handler order: the first read's explanation, its example top-up, then the regenerate.
	e.fake.replies = []string{
		explanationJSON("the original explanation"),
		examplesJSON(gValid(0, grammar.MinExamplesPerPoint)...),
		explanationJSON("a brand new explanation"),
	}
	e.assignProvider(t, tok)

	if detail := e.grammarDetail(t, tok, 1); detail.Explanation != "the original explanation" {
		t.Fatalf("first read = %+v", detail)
	}
	rec := e.do(t, "POST", "/grammar/points/1/explanation/regenerate", "Bearer "+tok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("regenerate = %d %s", rec.Code, rec.Body)
	}
	var body detailBody
	mustJSON(t, rec, &body)
	if body.Explanation != "a brand new explanation" || body.ExplanationEdited {
		t.Fatalf("after regenerate = %+v", body)
	}
	if e.fake.callCount() != 3 {
		t.Fatalf("provider calls = %d, want 3 (explanation, example top-up, regenerate)", e.fake.callCount())
	}
	if e.store == nil {
		t.Fatal("store missing")
	}
	// A later read serves the new text without spending anything.
	detail := e.grammarDetail(t, tok, 1)
	if detail.Explanation != "a brand new explanation" {
		t.Fatalf("after regenerate read = %+v", detail)
	}
	if e.fake.callCount() != 3 {
		t.Fatalf("read after regenerate spent the provider (calls %d)", e.fake.callCount())
	}
}

// grammarDetail fetches a point over HTTP and decodes it.
func (g grammarEnv) grammarDetail(t *testing.T, token string, id int) detailBody {
	t.Helper()
	rec := g.do(t, "GET", fmt.Sprintf("/grammar/points/%d", id), "Bearer "+token, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET detail(%d) = %d %s", id, rec.Code, rec.Body)
	}
	var out detailBody
	mustJSON(t, rec, &out)
	return out
}

func toGExamples(items []gExample) []gExample { return items }
