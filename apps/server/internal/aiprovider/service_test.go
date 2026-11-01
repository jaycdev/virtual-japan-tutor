package aiprovider_test

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

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider/aiprovidertest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

const secretKey = "sk-live-VERY-SECRET-key-123456"

type env struct {
	svc   *aiprovider.Service
	store *aiprovidertest.MemStore
	box   *secrets.Box
}

func newEnv(t *testing.T, opts ...aiprovider.Option) env {
	t.Helper()
	box, err := secrets.NewFromKey(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	store := aiprovidertest.NewMemStore()
	all := append([]aiprovider.Option{aiprovider.WithClientOptions(
		llm.WithSleep(func(context.Context, time.Duration) error { return nil }), llm.WithRand(func() float64 { return 0 }))}, opts...)
	return env{svc: aiprovider.NewService(store, box, all...), store: store, box: box}
}

func as(user uuid.UUID) context.Context {
	return auth.WithIdentity(context.Background(), auth.Identity{User: auth.User{ID: user, Username: user.String()}})
}

func TestCreateStoresAnEncryptedKeyAndNeverExposesIt(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())

	p, err := e.svc.Create(alice, aiprovider.Input{Name: "OpenAI", BaseURL: "https://api.openai.com", Model: "gpt-x", APIKey: aiprovider.SetKey(secretKey)})
	if err != nil {
		t.Fatal(err)
	}
	if !p.HasAPIKey || p.BaseURL != "https://api.openai.com/v1" {
		t.Fatalf("provider = %+v", p)
	}
	if b, _ := json.Marshal(p); strings.Contains(string(b), "SECRET") {
		t.Fatalf("serialised provider contains the key: %s", b)
	}

	stored := e.store.All()
	if len(stored) != 1 || stored[0].APIKeyEncrypted == nil {
		t.Fatalf("stored = %+v", stored)
	}
	enc := *stored[0].APIKeyEncrypted
	if !strings.HasPrefix(enc, "v1:") || strings.Contains(enc, "SECRET") {
		t.Fatalf("stored key is not v1 ciphertext: %q", enc)
	}
	if plain, err := e.box.Decrypt(enc); err != nil || plain != secretKey {
		t.Fatalf("decrypt = %q, %v", plain, err)
	}
}

func TestCreateValidatesInput(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())
	good := aiprovider.Input{Name: "n", BaseURL: "http://localhost:11434", Model: "llama3"}
	if _, err := e.svc.Create(alice, good); err != nil {
		t.Fatalf("keyless local endpoint rejected: %v", err)
	}
	cases := map[string]func(*aiprovider.Input){
		"empty name":      func(i *aiprovider.Input) { i.Name = "  " },
		"long name":       func(i *aiprovider.Input) { i.Name = strings.Repeat("x", 81) },
		"empty model":     func(i *aiprovider.Input) { i.Model = "" },
		"bad scheme":      func(i *aiprovider.Input) { i.BaseURL = "ftp://x/v1" },
		"url credentials": func(i *aiprovider.Input) { i.BaseURL = "https://u:p@x/v1" },
		"key with newline": func(i *aiprovider.Input) {
			i.APIKey = aiprovider.SetKey("abc\r\nX-Evil: 1")
		},
	}
	for name, mut := range cases {
		t.Run(name, func(t *testing.T) {
			in := good
			in.Name = name // unique, so only the mutation can fail
			mut(&in)
			if _, err := e.svc.Create(alice, in); !errors.Is(err, aiprovider.ErrInvalidInput) {
				t.Fatalf("err = %v, want ErrInvalidInput", err)
			}
		})
	}
	if _, err := e.svc.Create(alice, good); !errors.Is(err, aiprovider.ErrNameTaken) {
		t.Fatalf("duplicate err = %v, want ErrNameTaken", err)
	}
}

func TestUpdateKeepsReplacesOrClearsTheKey(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())
	p, _ := e.svc.Create(alice, aiprovider.Input{Name: "P", BaseURL: "https://x.example", Model: "m", APIKey: aiprovider.SetKey(secretKey)})
	keyOf := func() string {
		enc := e.store.All()[0].APIKeyEncrypted
		if enc == nil {
			return ""
		}
		plain, err := e.box.Decrypt(*enc)
		if err != nil {
			t.Fatal(err)
		}
		return plain
	}
	name := "Renamed"

	up, err := e.svc.Update(alice, p.ID, aiprovider.Patch{Name: &name}) // key omitted
	if err != nil || up.Name != "Renamed" || !up.HasAPIKey || keyOf() != secretKey {
		t.Fatalf("keep: %+v, %v, key=%q", up, err, keyOf())
	}
	if up, err = e.svc.Update(alice, p.ID, aiprovider.Patch{APIKey: aiprovider.SetKey("sk-new")}); err != nil || !up.HasAPIKey || keyOf() != "sk-new" {
		t.Fatalf("replace: %+v, %v, key=%q", up, err, keyOf())
	}
	if up, err = e.svc.Update(alice, p.ID, aiprovider.Patch{APIKey: aiprovider.SetKey("")}); err != nil || up.HasAPIKey || keyOf() != "" {
		t.Fatalf("clear: %+v, %v, key=%q", up, err, keyOf())
	}
	url := "http://10.0.0.5:8000"
	if up, err = e.svc.Update(alice, p.ID, aiprovider.Patch{BaseURL: &url}); err != nil || up.BaseURL != "http://10.0.0.5:8000/v1" {
		t.Fatalf("base url: %+v, %v", up, err)
	}
	empty := " "
	if _, err = e.svc.Update(alice, p.ID, aiprovider.Patch{Model: &empty}); !errors.Is(err, aiprovider.ErrInvalidInput) {
		t.Fatalf("blank model err = %v", err)
	}
}

func TestUsersAreIsolatedFromEachOther(t *testing.T) {
	e := newEnv(t)
	alice, bob := as(uuid.New()), as(uuid.New())
	a, _ := e.svc.Create(alice, aiprovider.Input{Name: "A", BaseURL: "https://a.example", Model: "m", APIKey: aiprovider.SetKey(secretKey)})
	if err := e.svc.Assign(alice, aiprovider.TaskStory, &a.ID); err != nil {
		t.Fatal(err)
	}
	bobID, _ := auth.UserID(bob)
	aliceID, _ := auth.UserID(alice)

	if list, _ := e.svc.List(bob); len(list) != 0 {
		t.Errorf("bob lists %+v", list)
	}
	if _, err := e.svc.Get(bob, a.ID); !errors.Is(err, aiprovider.ErrNotFound) {
		t.Errorf("bob Get err = %v", err)
	}
	n := "x"
	if _, err := e.svc.Update(bob, a.ID, aiprovider.Patch{Name: &n}); !errors.Is(err, aiprovider.ErrNotFound) {
		t.Errorf("bob Update err = %v", err)
	}
	if err := e.svc.Delete(bob, a.ID); !errors.Is(err, aiprovider.ErrNotFound) {
		t.Errorf("bob Delete err = %v", err)
	}
	if _, err := e.svc.Test(bob, a.ID); !errors.Is(err, aiprovider.ErrNotFound) {
		t.Errorf("bob Test err = %v (must not use alice's key)", err)
	}
	if err := e.svc.Assign(bob, aiprovider.TaskStory, &a.ID); !errors.Is(err, aiprovider.ErrNotFound) {
		t.Errorf("bob Assign err = %v", err)
	}
	if _, err := e.svc.ResolveProvider(context.Background(), bobID, aiprovider.TaskStory); !errors.Is(err, aiprovider.ErrNotAssigned) {
		t.Errorf("bob Resolve err = %v, want ErrNotAssigned", err)
	}
	if _, err := e.svc.ResolveProvider(context.Background(), aliceID, aiprovider.TaskStory); err != nil {
		t.Errorf("alice Resolve: %v", err)
	}
	// No identity, no query.
	if _, err := e.svc.List(context.Background()); !errors.Is(err, auth.ErrUnauthenticated) {
		t.Errorf("List without identity err = %v", err)
	}
}

func TestDeleteIsRejectedWhileAssigned(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())
	p, _ := e.svc.Create(alice, aiprovider.Input{Name: "P", BaseURL: "https://x.example", Model: "m"})
	_ = e.svc.Assign(alice, aiprovider.TaskGrammarContent, &p.ID)
	if err := e.svc.Delete(alice, p.ID); !errors.Is(err, aiprovider.ErrInUse) {
		t.Fatalf("err = %v, want ErrInUse", err)
	}
	_ = e.svc.Assign(alice, aiprovider.TaskGrammarContent, nil)
	if err := e.svc.Delete(alice, p.ID); err != nil {
		t.Fatal(err)
	}
}

func TestAssignmentsListEveryTask(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())
	got, err := e.svc.Assignments(alice)
	if err != nil || len(got) != len(aiprovider.Tasks) {
		t.Fatalf("Assignments = %+v, %v", got, err)
	}
	for i, a := range got {
		if a.Task != aiprovider.Tasks[i] || a.ProviderID != nil {
			t.Errorf("assignment %d = %+v", i, a)
		}
	}
	if err := e.svc.Assign(alice, aiprovider.Task("nonsense"), nil); !errors.Is(err, aiprovider.ErrUnknownTask) {
		t.Errorf("unknown task err = %v", err)
	}
}

// --- fake provider endpoint ---

type fakeLLM struct {
	*httptest.Server
	hits atomic.Int32
	mu   sync.Mutex
	auth []string
}

func newLLM(t *testing.T, h func(n int, w http.ResponseWriter, body map[string]any)) *fakeLLM {
	t.Helper()
	f := &fakeLLM{}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		f.mu.Lock()
		f.auth = append(f.auth, r.Header.Get("Authorization"))
		f.mu.Unlock()
		h(int(f.hits.Add(1)), w, body)
	}))
	t.Cleanup(f.Close)
	return f
}

func okReply(w http.ResponseWriter, content string) {
	_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}}})
}

func jsonErr(w http.ResponseWriter, status int, msg string, headers ...string) {
	for i := 0; i+1 < len(headers); i += 2 {
		w.Header().Set(headers[i], headers[i+1])
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"message": msg}})
}

func (e env) providerFor(t *testing.T, ctx context.Context, f *fakeLLM, key string) aiprovider.Provider {
	t.Helper()
	in := aiprovider.Input{Name: "fake", BaseURL: f.URL, Model: "gpt-test"}
	if key != "" {
		in.APIKey = aiprovider.SetKey(key)
	}
	p, err := e.svc.Create(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

func TestConnectionTestReportsSuccessAndStructuredOutputSupport(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())
	f := newLLM(t, func(_ int, w http.ResponseWriter, body map[string]any) {
		if body["response_format"] != nil {
			okReply(w, `{"ok": true}`)
			return
		}
		okReply(w, "ok")
	})
	p := e.providerFor(t, alice, f, secretKey)

	res, err := e.svc.Test(alice, p.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !res.OK || res.Structured != llm.ModeJSONSchema || !strings.Contains(res.Message, "Connected") {
		t.Fatalf("result = %+v", res)
	}
	if f.auth[0] != "Bearer "+secretKey {
		t.Errorf("the stored key was not decrypted and sent: %q", f.auth[0])
	}
}

func TestConnectionTestWhenEndpointHasNoStructuredOutput(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())
	f := newLLM(t, func(_ int, w http.ResponseWriter, body map[string]any) {
		if body["response_format"] != nil {
			jsonErr(w, 400, "response_format is not supported")
			return
		}
		if strings.Contains(body["messages"].([]any)[0].(map[string]any)["content"].(string), "JSON") {
			okReply(w, "```json\n{\"ok\": true}\n```")
			return
		}
		okReply(w, "ok")
	})
	res, err := e.svc.Test(alice, e.providerFor(t, alice, f, "").ID)
	if err != nil || !res.OK || res.Structured != llm.ModePromptOnly {
		t.Fatalf("result = %+v, %v", res, err)
	}
	if !strings.Contains(res.Message, "Connected") {
		t.Errorf("message = %q", res.Message)
	}
}

func TestConnectionTestWhenStructuredOutputIsUnusable(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())
	f := newLLM(t, func(_ int, w http.ResponseWriter, _ map[string]any) { okReply(w, "just chatting") })
	res, err := e.svc.Test(alice, e.providerFor(t, alice, f, "").ID)
	if err != nil || !res.OK || res.Structured != "unavailable" {
		t.Fatalf("result = %+v, %v", res, err)
	}
}

func TestConnectionTestFailuresAreReadableAndNotErrors(t *testing.T) {
	cases := []struct {
		name    string
		handler func(n int, w http.ResponseWriter, body map[string]any)
		opts    []aiprovider.Option
		want    []string // all must appear (case-insensitive)
	}{
		{"401", func(_ int, w http.ResponseWriter, _ map[string]any) {
			jsonErr(w, 401, "Incorrect API key provided: "+secretKey)
		}, nil, []string{"authentication failed", "api key"}},
		{"404 model", func(_ int, w http.ResponseWriter, _ map[string]any) {
			w.WriteHeader(404)
			_, _ = io.WriteString(w, `{"error":{"message":"The model `+"`gpt-test`"+` does not exist","code":"model_not_found"}}`)
		}, nil, []string{"model", "gpt-test", "not found"}},
		{"404 path", func(_ int, w http.ResponseWriter, _ map[string]any) {
			w.WriteHeader(404)
			_, _ = io.WriteString(w, "404 page not found")
		}, nil, []string{"base url", "/v1"}},
		{"429 forever", func(_ int, w http.ResponseWriter, _ map[string]any) {
			jsonErr(w, 429, "quota exceeded", "Retry-After", "1")
		}, nil, []string{"rate limit"}},
		{"timeout", func(_ int, w http.ResponseWriter, _ map[string]any) { time.Sleep(400 * time.Millisecond) },
			[]aiprovider.Option{aiprovider.WithClientOptions(llm.WithTimeout(50*time.Millisecond), llm.WithMaxAttempts(1))},
			[]string{"timed out"}},
		{"malformed JSON", func(_ int, w http.ResponseWriter, _ map[string]any) {
			_, _ = io.WriteString(w, "<html>captive portal</html>")
		},
			nil, []string{"openai-compatible"}},
		{"500", func(_ int, w http.ResponseWriter, _ map[string]any) { jsonErr(w, 500, "boom") }, nil, []string{"provider", "500"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			e := newEnv(t, tc.opts...)
			alice := as(uuid.New())
			f := newLLM(t, tc.handler)
			p := e.providerFor(t, alice, f, secretKey)
			res, err := e.svc.Test(alice, p.ID)
			if err != nil {
				t.Fatalf("a failing provider must not be a service error: %v", err)
			}
			if res.OK {
				t.Fatalf("result = %+v, want ok=false", res)
			}
			low := strings.ToLower(res.Message)
			for _, w := range tc.want {
				if !strings.Contains(low, strings.ToLower(w)) {
					t.Errorf("message %q lacks %q", res.Message, w)
				}
			}
			if strings.Contains(res.Message, secretKey) {
				t.Errorf("message leaks the key: %q", res.Message)
			}
		})
	}
}

func TestConnectionTestRetriesRateLimitThenSucceeds(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())
	f := newLLM(t, func(n int, w http.ResponseWriter, body map[string]any) {
		if n == 1 {
			jsonErr(w, 429, "slow down", "Retry-After", "1")
			return
		}
		if body["response_format"] != nil {
			okReply(w, `{"ok":true}`)
			return
		}
		okReply(w, "ok")
	})
	res, err := e.svc.Test(alice, e.providerFor(t, alice, f, "").ID)
	if err != nil || !res.OK {
		t.Fatalf("result = %+v, %v", res, err)
	}
}

func TestConnectionTestReportsUnreachableEndpoint(t *testing.T) {
	e := newEnv(t, aiprovider.WithClientOptions(llm.WithMaxAttempts(1)))
	alice := as(uuid.New())
	f := newLLM(t, func(int, http.ResponseWriter, map[string]any) {})
	p := e.providerFor(t, alice, f, "")
	f.Close()
	res, err := e.svc.Test(alice, p.ID)
	if err != nil || res.OK || !strings.Contains(strings.ToLower(res.Message), "cannot reach") {
		t.Fatalf("result = %+v, %v", res, err)
	}
}

func TestConnectionTestWhenTheStoredKeyCannotBeDecrypted(t *testing.T) {
	e := newEnv(t)
	alice := as(uuid.New())
	f := newLLM(t, func(_ int, w http.ResponseWriter, _ map[string]any) { okReply(w, "ok") })
	p := e.providerFor(t, alice, f, secretKey)
	// Simulate SECRETS_KEY having changed: the stored ciphertext no longer opens.
	other, _ := secrets.NewFromKey([]byte(strings.Repeat("k", 32)))
	swapped := aiprovider.NewService(e.store, other)
	res, err := swapped.Test(alice, p.ID)
	if err != nil || res.OK || !strings.Contains(res.Message, "SECRETS_KEY") {
		t.Fatalf("result = %+v, %v", res, err)
	}
	if f.hits.Load() != 0 {
		t.Errorf("called the provider without a key")
	}
}

// --- resolver ---

func TestResolveProviderReturnsDecryptedConfigAndAWorkingClient(t *testing.T) {
	e := newEnv(t)
	uid := uuid.New()
	alice := as(uid)
	f := newLLM(t, func(_ int, w http.ResponseWriter, body map[string]any) {
		okReply(w, "model="+body["model"].(string))
	})
	p := e.providerFor(t, alice, f, secretKey)
	_ = e.svc.Assign(alice, aiprovider.TaskStory, &p.ID)

	r, err := e.svc.ResolveProvider(context.Background(), uid, aiprovider.TaskStory)
	if err != nil {
		t.Fatal(err)
	}
	if r.Config.APIKey != secretKey || r.Config.Model != "gpt-test" || r.Provider.ID != p.ID {
		t.Fatalf("resolved = %+v", r)
	}
	res, err := r.Client.Chat(context.Background(), []llm.Message{{Role: llm.RoleUser, Content: "hi"}}, llm.Options{})
	if err != nil || res.Content != "model=gpt-test" {
		t.Fatalf("client: %+v, %v", res, err)
	}
}

func TestResolveProviderFailsClearlyWhenNothingIsAssigned(t *testing.T) {
	e := newEnv(t)
	uid := uuid.New()
	_, _ = e.svc.Create(as(uid), aiprovider.Input{Name: "unassigned", BaseURL: "https://x.example", Model: "m"})
	_, err := e.svc.ResolveProvider(context.Background(), uid, aiprovider.TaskStory)
	if !errors.Is(err, aiprovider.ErrNotAssigned) || !strings.Contains(err.Error(), "story") {
		t.Fatalf("err = %v, want ErrNotAssigned mentioning the task", err)
	}
	if _, err := e.svc.ResolveProvider(context.Background(), uid, aiprovider.Task("x")); !errors.Is(err, aiprovider.ErrUnknownTask) {
		t.Fatalf("unknown task err = %v", err)
	}
}

// --- env-seeded default ---

func TestSeedDefaultCreatesAndAssignsOnceOnly(t *testing.T) {
	e := newEnv(t)
	uid := uuid.New()
	def := aiprovider.DefaultConfig{BaseURL: "http://litellm.internal:4000", APIKey: secretKey, Model: "gpt-x"}

	created, err := e.svc.SeedDefault(context.Background(), uid, def)
	if err != nil || !created {
		t.Fatalf("first seed = %v, %v", created, err)
	}
	created, err = e.svc.SeedDefault(context.Background(), uid, def)
	if err != nil || created {
		t.Fatalf("second seed = %v, %v; want no-op", created, err)
	}
	alice := as(uid)
	list, _ := e.svc.List(alice)
	if len(list) != 1 || list[0].Name != "Default" || !list[0].HasAPIKey || list[0].BaseURL != "http://litellm.internal:4000/v1" {
		t.Fatalf("providers = %+v", list)
	}
	for _, task := range aiprovider.Tasks {
		r, err := e.svc.ResolveProvider(context.Background(), uid, task)
		if err != nil || r.Config.APIKey != secretKey {
			t.Errorf("task %s: %+v, %v", task, r, err)
		}
	}
	enc := *e.store.All()[0].APIKeyEncrypted
	if !strings.HasPrefix(enc, "v1:") || strings.Contains(enc, "VERY-SECRET") {
		t.Errorf("seeded key stored as %q", enc)
	}
}

func TestSeedDefaultLeavesUsersWithProvidersAloneAndSkipsWhenUnconfigured(t *testing.T) {
	e := newEnv(t)
	uid := uuid.New()
	_, _ = e.svc.Create(as(uid), aiprovider.Input{Name: "Mine", BaseURL: "https://x.example", Model: "m"})
	if created, err := e.svc.SeedDefault(context.Background(), uid, aiprovider.DefaultConfig{BaseURL: "https://d.example", Model: "m"}); err != nil || created {
		t.Fatalf("seed over existing = %v, %v", created, err)
	}
	if created, err := e.svc.SeedDefault(context.Background(), uuid.New(), aiprovider.DefaultConfig{}); err != nil || created {
		t.Fatalf("unconfigured seed = %v, %v", created, err)
	}
	if _, err := e.svc.SeedDefault(context.Background(), uuid.New(), aiprovider.DefaultConfig{BaseURL: "ftp://bad", Model: "m"}); !errors.Is(err, aiprovider.ErrInvalidInput) {
		t.Fatalf("bad default err = %v", err)
	}
}
