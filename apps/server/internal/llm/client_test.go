package llm_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
)

const testKey = "sk-test-SECRET-0123456789"

// fake is a scripted OpenAI-compatible server. Each request is answered by the next step
// (the last step repeats). It records what it received.
type fake struct {
	*httptest.Server
	mu    sync.Mutex
	reqs  []recorded
	steps []func(w http.ResponseWriter, r *http.Request, body map[string]any)
}

type recorded struct {
	Method, Path, Auth, ContentType string
	Body                            map[string]any
}

func newFake(t *testing.T, steps ...func(w http.ResponseWriter, r *http.Request, body map[string]any)) *fake {
	t.Helper()
	f := &fake{steps: steps}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		f.mu.Lock()
		n := len(f.reqs)
		f.reqs = append(f.reqs, recorded{r.Method, r.URL.Path, r.Header.Get("Authorization"), r.Header.Get("Content-Type"), body})
		step := f.steps[min(n, len(f.steps)-1)]
		f.mu.Unlock()
		step(w, r, body)
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *fake) requests() []recorded {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]recorded(nil), f.reqs...)
}

type step = func(w http.ResponseWriter, r *http.Request, body map[string]any)

func reply(content string) step {
	return func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id": "chatcmpl-1", "object": "chat.completion", "model": "m",
			"choices": []any{map[string]any{"index": 0, "finish_reason": "stop",
				"message": map[string]any{"role": "assistant", "content": content}}},
		})
	}
}

func fail(status int, body string, headers ...string) step {
	return func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
		for i := 0; i+1 < len(headers); i += 2 {
			w.Header().Set(headers[i], headers[i+1])
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = io.WriteString(w, body)
	}
}

// sleeps records requested backoff waits without actually waiting.
type sleeps struct {
	mu sync.Mutex
	ds []time.Duration
}

func (s *sleeps) fn(_ context.Context, d time.Duration) error {
	s.mu.Lock()
	s.ds = append(s.ds, d)
	s.mu.Unlock()
	return nil
}

func (s *sleeps) get() []time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]time.Duration(nil), s.ds...)
}

func newClient(t *testing.T, f *fake, s *sleeps, opts ...llm.Option) *llm.Client {
	t.Helper()
	all := []llm.Option{llm.WithSleep(s.fn), llm.WithRand(func() float64 { return 1 })}
	c, err := llm.New(llm.Config{BaseURL: f.URL, APIKey: testKey, Model: "gpt-test"}, append(all, opts...)...)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

var hello = []llm.Message{{Role: llm.RoleSystem, Content: "be brief"}, {Role: llm.RoleUser, Content: "hi"}}

func TestChatBuildsOpenAICompatibleRequest(t *testing.T) {
	f := newFake(t, reply("hello there"))
	temp := 0.3
	res, err := newClient(t, f, &sleeps{}).Chat(context.Background(), hello, llm.Options{Temperature: &temp, MaxTokens: 77})
	if err != nil {
		t.Fatal(err)
	}
	if res.Content != "hello there" {
		t.Errorf("content = %q", res.Content)
	}
	got := f.requests()
	if len(got) != 1 {
		t.Fatalf("requests = %d, want 1", len(got))
	}
	r := got[0]
	if r.Method != "POST" || r.Path != "/v1/chat/completions" {
		t.Errorf("request = %s %s, want POST /v1/chat/completions", r.Method, r.Path)
	}
	if r.Auth != "Bearer "+testKey {
		t.Errorf("Authorization = %q", r.Auth)
	}
	if !strings.HasPrefix(r.ContentType, "application/json") {
		t.Errorf("Content-Type = %q", r.ContentType)
	}
	if r.Body["model"] != "gpt-test" || r.Body["temperature"] != 0.3 || r.Body["max_tokens"] != float64(77) {
		t.Errorf("body = %v", r.Body)
	}
	msgs, _ := r.Body["messages"].([]any)
	if len(msgs) != 2 || msgs[1].(map[string]any)["role"] != "user" || msgs[1].(map[string]any)["content"] != "hi" {
		t.Errorf("messages = %v", r.Body["messages"])
	}
	if _, has := r.Body["stream"]; has && r.Body["stream"] != false {
		t.Errorf("stream must not be enabled: %v", r.Body["stream"])
	}
}

func TestChatOmitsUnsetOptionsAndSendsNoAuthForKeylessEndpoints(t *testing.T) {
	f := newFake(t, reply("ok"))
	c, err := llm.New(llm.Config{BaseURL: f.URL, Model: "llama3"}) // Ollama-style: no key
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.Chat(context.Background(), hello, llm.Options{}); err != nil {
		t.Fatal(err)
	}
	r := f.requests()[0]
	if r.Auth != "" {
		t.Errorf("Authorization = %q, want none", r.Auth)
	}
	for _, k := range []string{"temperature", "max_tokens", "response_format"} {
		if _, has := r.Body[k]; has {
			t.Errorf("body unexpectedly has %q: %v", k, r.Body)
		}
	}
}

func TestNewRejectsBadConfig(t *testing.T) {
	for _, cfg := range []llm.Config{
		{BaseURL: "ftp://x", Model: "m"},
		{BaseURL: "http://x", Model: ""},
	} {
		if _, err := llm.New(cfg); err == nil {
			t.Errorf("New(%+v) succeeded, want error", cfg)
		}
	}
}

func TestChatMapsFailuresToTypedErrors(t *testing.T) {
	cases := []struct {
		name   string
		step   step
		want   error
		status int
		hit    int // requests expected: non-retryable errors must not be retried
	}{
		{"401", fail(401, `{"error":{"message":"Incorrect API key provided: sk-test-SECRET-0123456789","type":"invalid_request_error","code":"invalid_api_key"}}`), llm.ErrAuth, 401, 1},
		{"403", fail(403, `{"error":{"message":"forbidden"}}`), llm.ErrAuth, 403, 1},
		{"404 model (OpenAI)", fail(404, `{"error":{"message":"The model `+"`gpt-test`"+` does not exist","type":"invalid_request_error","code":"model_not_found"}}`), llm.ErrModelNotFound, 404, 1},
		{"404 model (Ollama)", fail(404, `{"error":{"message":"model \"gpt-test\" not found, try pulling it first"}}`), llm.ErrModelNotFound, 404, 1},
		{"404 path", fail(404, `404 page not found`), llm.ErrEndpointNotFound, 404, 1},
		{"400", fail(400, `{"error":{"message":"messages: must not be empty"}}`), llm.ErrBadRequest, 400, 1},
		{"string error body", fail(400, `{"error":"nope"}`), llm.ErrBadRequest, 400, 1},
		{"200 not JSON", func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
			_, _ = io.WriteString(w, "<html>proxy login</html>")
		}, llm.ErrBadResponse, 200, 1},
		{"200 no choices", func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
			_, _ = io.WriteString(w, `{"choices":[]}`)
		}, llm.ErrBadResponse, 200, 1},
		{"200 null content", func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
			_, _ = io.WriteString(w, `{"choices":[{"message":{"role":"assistant","content":null}}]}`)
		}, llm.ErrBadResponse, 200, 1},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newFake(t, tc.step)
			s := &sleeps{}
			_, err := newClient(t, f, s).Chat(context.Background(), hello, llm.Options{})
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			var le *llm.Error
			if !errors.As(err, &le) || le.Status != tc.status {
				t.Errorf("status = %+v, want %d", le, tc.status)
			}
			if n := len(f.requests()); n != tc.hit {
				t.Errorf("requests = %d, want %d (no retry on this error)", n, tc.hit)
			}
			if strings.Contains(err.Error(), testKey) {
				t.Errorf("error leaks the API key: %v", err)
			}
		})
	}
}

func TestChatRetriesRateLimitHonouringRetryAfter(t *testing.T) {
	f := newFake(t, fail(429, `{"error":{"message":"slow down"}}`, "Retry-After", "2"), reply("ok"))
	s := &sleeps{}
	res, err := newClient(t, f, s).Chat(context.Background(), hello, llm.Options{})
	if err != nil || res.Content != "ok" {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	if got := s.get(); len(got) != 1 || got[0] != 2*time.Second {
		t.Errorf("sleeps = %v, want [2s]", got)
	}
	if n := len(f.requests()); n != 2 {
		t.Errorf("requests = %d, want 2", n)
	}
}

func TestChatRetriesServerErrorsWithExponentialBackoff(t *testing.T) {
	f := newFake(t, fail(503, `unavailable`), fail(500, `oops`), fail(502, `bad gateway`), reply("ok"))
	s := &sleeps{}
	// rand=1 makes the jitter maximal, so the waits are exactly base * 2^n.
	res, err := newClient(t, f, s, llm.WithMaxAttempts(4), llm.WithBackoff(100*time.Millisecond, time.Second)).Chat(context.Background(), hello, llm.Options{})
	if err != nil || res.Content != "ok" {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	want := []time.Duration{100 * time.Millisecond, 200 * time.Millisecond, 400 * time.Millisecond}
	got := s.get()
	if len(got) != len(want) {
		t.Fatalf("sleeps = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("sleep[%d] = %v, want %v", i, got[i], want[i])
		}
	}
}

func TestBackoffIsJitteredAndCapped(t *testing.T) {
	f := newFake(t, fail(500, `x`))
	s := &sleeps{}
	c, _ := llm.New(llm.Config{BaseURL: f.URL, Model: "m"}, llm.WithSleep(s.fn), llm.WithMaxAttempts(6),
		llm.WithBackoff(100*time.Millisecond, 300*time.Millisecond), llm.WithRand(func() float64 { return 0.5 }))
	_, err := c.Chat(context.Background(), hello, llm.Options{})
	if !errors.Is(err, llm.ErrServer) {
		t.Fatalf("err = %v, want ErrServer", err)
	}
	// half of min(base*2^n, cap): 50, 100, 150, 150, 150
	want := []time.Duration{50, 100, 150, 150, 150}
	got := s.get()
	if len(got) != len(want) {
		t.Fatalf("sleeps = %v", got)
	}
	for i := range want {
		if got[i] != want[i]*time.Millisecond {
			t.Errorf("sleep[%d] = %v, want %v", i, got[i], want[i]*time.Millisecond)
		}
	}
}

func TestChatGivesUpAfterMaxAttemptsWithRateLimitError(t *testing.T) {
	f := newFake(t, fail(429, `{"error":{"message":"quota"}}`))
	_, err := newClient(t, f, &sleeps{}, llm.WithMaxAttempts(3)).Chat(context.Background(), hello, llm.Options{})
	if !errors.Is(err, llm.ErrRateLimited) {
		t.Fatalf("err = %v, want ErrRateLimited", err)
	}
	if n := len(f.requests()); n != 3 {
		t.Errorf("requests = %d, want 3", n)
	}
}

func TestChatDoesNotWaitForAbsurdRetryAfter(t *testing.T) {
	f := newFake(t, fail(429, `{}`, "Retry-After", "3600"))
	s := &sleeps{}
	_, err := newClient(t, f, s).Chat(context.Background(), hello, llm.Options{})
	if !errors.Is(err, llm.ErrRateLimited) {
		t.Fatalf("err = %v, want ErrRateLimited", err)
	}
	if len(s.get()) != 0 || len(f.requests()) != 1 {
		t.Errorf("slept %v / %d requests; an hour-long Retry-After should fail fast", s.get(), len(f.requests()))
	}
}

func TestChatRetriesNetworkErrors(t *testing.T) {
	hangUp := func(w http.ResponseWriter, _ *http.Request, _ map[string]any) {
		conn, _, _ := w.(http.Hijacker).Hijack()
		_ = conn.Close()
	}
	f := newFake(t, hangUp, reply("ok"))
	res, err := newClient(t, f, &sleeps{}).Chat(context.Background(), hello, llm.Options{})
	if err != nil || res.Content != "ok" {
		t.Fatalf("res=%+v err=%v", res, err)
	}
}

func TestChatReportsUnreachableHost(t *testing.T) {
	f := newFake(t, reply("x"))
	url := f.URL
	f.Close() // nothing listens there any more
	c, _ := llm.New(llm.Config{BaseURL: url, APIKey: testKey, Model: "m"}, llm.WithSleep((&sleeps{}).fn), llm.WithMaxAttempts(2))
	_, err := c.Chat(context.Background(), hello, llm.Options{})
	if !errors.Is(err, llm.ErrUnreachable) {
		t.Fatalf("err = %v, want ErrUnreachable", err)
	}
	if strings.Contains(err.Error(), testKey) {
		t.Errorf("error leaks key: %v", err)
	}
}

func TestChatTimesOutPerAttempt(t *testing.T) {
	var hits atomic.Int32
	slow := func(w http.ResponseWriter, r *http.Request, _ map[string]any) {
		hits.Add(1)
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}
	f := newFake(t, slow)
	start := time.Now()
	_, err := newClient(t, f, &sleeps{}, llm.WithTimeout(50*time.Millisecond), llm.WithMaxAttempts(2)).Chat(context.Background(), hello, llm.Options{})
	if !errors.Is(err, llm.ErrTimeout) {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
	if hits.Load() != 2 {
		t.Errorf("attempts = %d, want 2 (a timeout is retried)", hits.Load())
	}
	if time.Since(start) > 3*time.Second {
		t.Errorf("took %v; the per-attempt timeout was not applied", time.Since(start))
	}
}

func TestChatStopsWhenContextIsCancelled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	f := newFake(t, func(w http.ResponseWriter, r *http.Request, _ map[string]any) {
		cancel()
		<-r.Context().Done()
	})
	_, err := newClient(t, f, &sleeps{}, llm.WithMaxAttempts(5)).Chat(ctx, hello, llm.Options{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if errors.Is(err, llm.ErrTimeout) {
		t.Errorf("a caller cancel must not be reported as a provider timeout")
	}
	if n := len(f.requests()); n != 1 {
		t.Errorf("requests = %d, want 1 (no retry after cancel)", n)
	}
}

func TestChatSwitchesToMaxCompletionTokensWhenRequired(t *testing.T) {
	// OpenAI reasoning models reject max_tokens in favour of max_completion_tokens.
	f := newFake(t,
		fail(400, `{"error":{"message":"Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.","param":"max_tokens"}}`),
		reply("ok"))
	res, err := newClient(t, f, &sleeps{}).Chat(context.Background(), hello, llm.Options{MaxTokens: 50})
	if err != nil || res.Content != "ok" {
		t.Fatalf("res=%+v err=%v", res, err)
	}
	reqs := f.requests()
	if len(reqs) != 2 {
		t.Fatalf("requests = %d, want 2", len(reqs))
	}
	if _, has := reqs[1].Body["max_tokens"]; has || reqs[1].Body["max_completion_tokens"] != float64(50) {
		t.Errorf("retry body = %v", reqs[1].Body)
	}
}
