package grammar_test

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
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar/grammartest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
)

// The generation tests never call a real AI provider. Every provider is an
// httptest server speaking the OpenAI-compatible /chat/completions protocol,
// answering scripted completions and recording the requests it received.

// --- fake provider ---

type scriptedCall struct {
	// allowModes, when non-nil, rejects requests whose response_format type is
	// not listed (status rejectStatus, default 400) — like endpoints that do
	// not support structured outputs.
	allowModes   []string
	rejectStatus int
	status       int    // response status; default 200
	content      string // assistant message content; default {}
	latency      time.Duration
}

type recordedCall struct {
	Mode     string // response_format type seen on the request
	Auth     string
	Messages []llm.Message
}

type fakeProvider struct {
	server *httptest.Server

	mu     sync.Mutex
	script []scriptedCall
	calls  []recordedCall
}

func newFakeProvider(t *testing.T, script ...scriptedCall) *fakeProvider {
	t.Helper()
	f := &fakeProvider{script: script}
	f.server = httptest.NewServer(http.HandlerFunc(f.handle))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeProvider) client(t *testing.T) *llm.Client {
	t.Helper()
	client, err := llm.New(
		llm.Config{BaseURL: f.server.URL, Model: "test-model", APIKey: "fake-key"},
		llm.WithMaxAttempts(1),
		llm.WithTimeout(15*time.Second),
	)
	if err != nil {
		t.Fatalf("llm.New: %v", err)
	}
	return client
}

func (f *fakeProvider) handle(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Model          string          `json:"model"`
		Messages       []llm.Message   `json:"messages"`
		ResponseFormat json.RawMessage `json:"response_format"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":{"message":"fake provider got invalid JSON"}}`, http.StatusBadRequest)
		return
	}
	mode := ""
	if len(body.ResponseFormat) > 0 {
		var rf struct {
			Type string `json:"type"`
		}
		if err := json.Unmarshal(body.ResponseFormat, &rf); err == nil {
			mode = rf.Type
		}
	}

	f.mu.Lock()
	idx := len(f.calls)
	f.calls = append(f.calls, recordedCall{Mode: mode, Auth: r.Header.Get("Authorization"), Messages: body.Messages})
	exhausted := idx >= len(f.script)
	call := scriptedCall{}
	if !exhausted {
		call = f.script[idx]
	}
	f.mu.Unlock()

	if call.latency > 0 {
		time.Sleep(call.latency)
	}
	w.Header().Set("Content-Type", "application/json")
	switch {
	case exhausted:
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":{"message":"fake provider script exhausted"}}`))
	case call.allowModes != nil && !slicesContain(call.allowModes, mode):
		status := call.rejectStatus
		if status == 0 {
			status = http.StatusBadRequest
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(`{"error":{"message":"ResponseFormat is not supported by this model."}}`))
	case call.status != 0 && call.status != http.StatusOK:
		w.WriteHeader(call.status)
		_, _ = w.Write([]byte(`{"error":{"message":"fake provider failure"}}`))
	default:
		content := call.content
		if content == "" {
			content = `{}`
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"model": body.Model,
			"choices": []any{map[string]any{
				"index":         0,
				"message":       map[string]any{"role": "assistant", "content": content},
				"finish_reason": "stop",
			}},
			"usage": map[string]any{"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
		})
	}
}

func (f *fakeProvider) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.calls)
}

func (f *fakeProvider) call(i int) recordedCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[i]
}

func (f *fakeProvider) lastPrompt() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	last := f.calls[len(f.calls)-1]
	var parts []string
	for _, m := range last.Messages {
		if m.Role == llm.RoleUser {
			parts = append(parts, m.Content)
		}
	}
	return strings.Join(parts, "\n")
}

func slicesContain(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}

// --- fake resolver ---

type fakeResolver struct {
	mu      sync.Mutex
	clients map[string]*llm.Client
	calls   map[string]int
}

func newFakeResolver(clients map[string]*llm.Client) *fakeResolver {
	if clients == nil {
		clients = map[string]*llm.Client{}
	}
	return &fakeResolver{clients: clients, calls: map[string]int{}}
}

func (r *fakeResolver) ResolveProvider(_ context.Context, userID int64, task string) (aiprovider.Resolved, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls[task]++
	client, ok := r.clients[task]
	if !ok {
		return aiprovider.Resolved{}, aiprovider.ErrNotAssigned
	}
	return aiprovider.Resolved{Client: client}, nil
}

func (r *fakeResolver) taskCalls(task string) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.calls[task]
}

// --- scripted example payloads ---

type genExample struct {
	Sentence    string
	Translation string
	Start       int
	Length      int
}

func (g genExample) marshal() map[string]any {
	return map[string]any{
		"sentence_ja":    g.Sentence,
		"translation_en": g.Translation,
		"span_start":     g.Start,
		"span_length":    g.Length,
	}
}

func examplesReply(items ...genExample) string {
	raw := make([]map[string]any, 0, len(items))
	for _, g := range items {
		raw = append(raw, g.marshal())
	}
	out, err := json.Marshal(map[string]any{"examples": raw})
	if err != nil {
		panic(err)
	}
	return string(out)
}

func explanationReply(text string) string {
	out, err := json.Marshal(map[string]any{"explanation": text})
	if err != nil {
		panic(err)
	}
	return string(out)
}

// validExamples makes n unique sentences that pass validation for the dake
// point, starting at offset in a fixed schedule of 30 (noun × tail).
var dakeNouns = []string{"これ", "ねこ", "さかな", "ほん", "みず", "いぬ", "とり", "まど", "かべ", "ゆか", "とけい", "ふく", "みち", "いす", "こども"}

func dakeDict() *grammartest.MemDictionary {
	return memDict(append(append([]string{}, dakeNouns...), "だけ", "ください", "みる", "たべる", "かわいい")...)
}

func validExamples(offset, n int) []genExample {
	out := make([]genExample, 0, n)
	for i := offset; i < offset+n; i++ {
		noun := dakeNouns[i%len(dakeNouns)]
		var sentence, translation string
		if i%2 == 0 {
			sentence = noun + "だけください。"
			translation = fmt.Sprintf("Just the %s, please.", noun)
		} else {
			sentence = noun + "だけをみました。"
			translation = fmt.Sprintf("I only saw the %s.", noun)
		}
		idx := strings.Index(sentence, "だけ")
		start := len([]rune(sentence[:idx]))
		out = append(out, genExample{Sentence: sentence, Translation: translation, Start: start, Length: len([]rune("だけ"))})
	}
	return out
}
