package httpapi_test

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
)

// A key with a recognisable prefix and suffix, so a partial leak (masking like "sk-…4f2a")
// is caught as well as a full one.
const (
	keyPrefix = "QZXPFX"
	keySuffix = "SFXQZX"
	apiKey    = keyPrefix + "-middle-secret-" + keySuffix
)

func assertNoKey(t *testing.T, where string, body string) {
	t.Helper()
	for _, frag := range []string{apiKey, keyPrefix, keySuffix, "middle-secret"} {
		if strings.Contains(body, frag) {
			t.Errorf("%s leaks (part of) the API key %q: %s", where, frag, body)
		}
	}
}

// upstream is a fake OpenAI-compatible provider that records the Authorization it sees.
type upstream struct {
	*httptest.Server
	mu    sync.Mutex
	auths []string
}

func newUpstream(t *testing.T, h func(w http.ResponseWriter, body map[string]any)) *upstream {
	t.Helper()
	u := &upstream{}
	u.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		var body map[string]any
		_ = json.Unmarshal(raw, &body)
		u.mu.Lock()
		u.auths = append(u.auths, r.Header.Get("Authorization"))
		u.mu.Unlock()
		h(w, body)
	}))
	t.Cleanup(u.Close)
	return u
}

func (u *upstream) lastAuth() string {
	u.mu.Lock()
	defer u.mu.Unlock()
	if len(u.auths) == 0 {
		return ""
	}
	return u.auths[len(u.auths)-1]
}

func chatOK(w http.ResponseWriter, content string) {
	_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"role": "assistant", "content": content}}}})
}

func healthyUpstream(t *testing.T) *upstream {
	return newUpstream(t, func(w http.ResponseWriter, body map[string]any) {
		if body["response_format"] != nil {
			chatOK(w, `{"ok":true}`)
			return
		}
		chatOK(w, "ok")
	})
}

type aiClient struct {
	e     env
	token string
	t     *testing.T
	all   *[]string // every response body, for the blanket "no key anywhere" check
}

func (c aiClient) do(method, path string, body any) *httptest.ResponseRecorder {
	c.t.Helper()
	rec := c.e.do(c.t, method, path, "Bearer "+c.token, body)
	*c.all = append(*c.all, method+" "+path+" -> "+rec.Body.String())
	return rec
}

func (c aiClient) create(name, baseURL string, key any) api.AiProvider {
	c.t.Helper()
	body := map[string]any{"name": name, "baseUrl": baseURL, "model": "gpt-test"}
	if key != nil {
		body["apiKey"] = key
	}
	rec := c.do("POST", "/ai-providers", body)
	if rec.Code != http.StatusCreated {
		c.t.Fatalf("create %s = %d %s", name, rec.Code, rec.Body)
	}
	var p api.AiProvider
	mustJSON(c.t, rec, &p)
	return p
}

func newAIClient(t *testing.T, e env, user string) aiClient {
	t.Helper()
	return aiClient{e: e, token: e.login(t, user), t: t, all: new([]string)}
}

func TestAIProviderKeyIsWriteOnlyAcrossEveryResponse(t *testing.T) {
	e := newEnv(t, fakeDB{})
	alice := newAIClient(t, e, "alice")
	up := healthyUpstream(t)

	p := alice.create("Main", up.URL, apiKey)
	if !p.HasApiKey || p.BaseUrl != up.URL+"/v1" {
		t.Fatalf("created = %+v", p)
	}

	// Exercise every route that could carry a provider back to the client.
	alice.do("GET", "/ai-providers", nil)
	alice.do("GET", "/ai-providers/"+p.Id.String(), nil)
	alice.do("PATCH", "/ai-providers/"+p.Id.String(), map[string]any{"name": "Renamed"})
	alice.do("PATCH", "/ai-providers/"+p.Id.String(), map[string]any{"apiKey": apiKey + "2"}) // replace
	alice.do("POST", "/ai-providers/"+p.Id.String()+"/test", nil)
	alice.do("PUT", "/ai-tasks/story", map[string]any{"providerId": p.Id})
	alice.do("GET", "/ai-tasks", nil)
	// Error paths must not echo the request body or the key either.
	alice.do("POST", "/ai-providers", map[string]any{"name": "Main", "baseUrl": up.URL, "model": "m", "apiKey": apiKey})           // 409 duplicate
	alice.do("POST", "/ai-providers", map[string]any{"name": "Bad", "baseUrl": "ftp://x", "model": "m", "apiKey": apiKey})         // 400
	alice.do("POST", "/ai-providers", map[string]any{"name": "Bad2", "baseUrl": up.URL, "model": "m", "apiKey": apiKey + " \n x"}) // 400 bad key
	alice.do("POST", "/ai-providers", `{"name": "x", "apiKey": "`+apiKey)                                                          // malformed JSON
	alice.do("DELETE", "/ai-providers/"+p.Id.String(), nil)                                                                        // 409 in use
	alice.do("PATCH", "/ai-providers/00000000-0000-0000-0000-000000000000", map[string]any{"apiKey": apiKey})

	for _, body := range *alice.all {
		assertNoKey(t, "response", body)
	}
}

func TestAIProviderResponsesNeverContainAKeyFieldAtAll(t *testing.T) {
	e := newEnv(t, fakeDB{})
	alice := newAIClient(t, e, "alice")
	p := alice.create("Main", "http://localhost:11434", apiKey)
	for _, rec := range []*httptest.ResponseRecorder{
		alice.do("GET", "/ai-providers", nil),
		alice.do("GET", "/ai-providers/"+p.Id.String(), nil),
	} {
		var raw any
		mustJSON(t, rec, &raw)
		var walk func(v any)
		walk = func(v any) {
			switch x := v.(type) {
			case map[string]any:
				for k, val := range x {
					if strings.Contains(strings.ToLower(k), "key") && k != "hasApiKey" {
						t.Errorf("response has a %q field: %s", k, rec.Body)
					}
					walk(val)
				}
			case []any:
				for _, i := range x {
					walk(i)
				}
			}
		}
		walk(raw)
	}
}

func TestAIProviderKeyPatchSemantics(t *testing.T) {
	e := newEnv(t, fakeDB{})
	alice := newAIClient(t, e, "alice")
	up := healthyUpstream(t)
	p := alice.create("Main", up.URL, apiKey)
	id := p.Id.String()
	has := func() bool {
		var got api.AiProvider
		mustJSON(t, alice.do("GET", "/ai-providers/"+id, nil), &got)
		return got.HasApiKey
	}
	probe := func() string { // which Authorization does the provider see now?
		alice.do("POST", "/ai-providers/"+id+"/test", nil)
		return up.lastAuth()
	}

	if rec := alice.do("PATCH", "/ai-providers/"+id, map[string]any{"name": "Renamed", "model": "other"}); rec.Code != 200 {
		t.Fatalf("patch = %d %s", rec.Code, rec.Body)
	}
	if !has() || probe() != "Bearer "+apiKey {
		t.Fatalf("omitting apiKey must keep the stored key (auth seen: %q)", up.lastAuth())
	}

	alice.do("PATCH", "/ai-providers/"+id, map[string]any{"apiKey": "sk-replacement"})
	if !has() || probe() != "Bearer sk-replacement" {
		t.Fatalf("a new apiKey must replace the stored one (auth seen: %q)", up.lastAuth())
	}

	alice.do("PATCH", "/ai-providers/"+id, `{"apiKey": null}`)
	if has() || probe() != "" {
		t.Fatalf("explicit null must clear the key (auth seen: %q)", up.lastAuth())
	}

	alice.do("PATCH", "/ai-providers/"+id, map[string]any{"apiKey": "sk-again"})
	if !has() {
		t.Fatal("key not set again")
	}
	alice.do("PATCH", "/ai-providers/"+id, map[string]any{"apiKey": ""})
	if has() || probe() != "" {
		t.Fatalf("empty string must clear the key (auth seen: %q)", up.lastAuth())
	}
}

func TestAIProviderValidationAndConflicts(t *testing.T) {
	e := newEnv(t, fakeDB{})
	alice := newAIClient(t, e, "alice")
	p := alice.create("Main", "http://192.168.1.50:8000/v1/", nil) // LAN address, trailing slash, keyless
	if p.BaseUrl != "http://192.168.1.50:8000/v1" || p.HasApiKey {
		t.Fatalf("created = %+v", p)
	}

	wantError(t, alice.do("POST", "/ai-providers", map[string]any{"name": "main", "baseUrl": "http://x", "model": "m"}), 409, "name_taken")
	wantError(t, alice.do("POST", "/ai-providers", map[string]any{"name": "N", "baseUrl": "file:///etc/passwd", "model": "m"}), 400, "invalid_provider")
	wantError(t, alice.do("POST", "/ai-providers", map[string]any{"name": "N", "baseUrl": "http://x", "model": " "}), 400, "invalid_provider")
	wantError(t, alice.do("POST", "/ai-providers", `{not json`), 400, "bad_request")
	wantError(t, alice.do("PATCH", "/ai-providers/"+p.Id.String(), map[string]any{"baseUrl": "nope"}), 400, "invalid_provider")
	other := alice.create("Other", "http://x", nil)
	wantError(t, alice.do("PATCH", "/ai-providers/"+other.Id.String(), map[string]any{"name": "MAIN"}), 409, "name_taken")
	wantError(t, alice.do("GET", "/ai-providers/not-a-uuid", nil), 404, "not_found")
}

func TestAITaskAssignmentAndDeleteRules(t *testing.T) {
	e := newEnv(t, fakeDB{})
	alice := newAIClient(t, e, "alice")
	a := alice.create("A", "http://a.example", nil)
	b := alice.create("B", "http://b.example", nil)

	var tasks []api.AiTaskAssignment
	mustJSON(t, alice.do("GET", "/ai-tasks", nil), &tasks)
	if len(tasks) != 2 || tasks[0].Task != api.AiTask("story") || tasks[1].Task != api.AiTask("grammar_content") || tasks[0].ProviderId != nil || tasks[1].ProviderId != nil {
		t.Fatalf("initial tasks = %+v", tasks)
	}

	// Several providers saved; one chosen per task.
	for _, tc := range []struct {
		task string
		id   any
	}{{"story", b.Id}, {"grammar_content", a.Id}} {
		if rec := alice.do("PUT", "/ai-tasks/"+tc.task, map[string]any{"providerId": tc.id}); rec.Code != 200 {
			t.Fatalf("assign %s = %d %s", tc.task, rec.Code, rec.Body)
		}
	}
	mustJSON(t, alice.do("GET", "/ai-tasks", nil), &tasks)
	if *tasks[0].ProviderId != b.Id || *tasks[1].ProviderId != a.Id {
		t.Fatalf("tasks = %+v", tasks)
	}
	var list []api.AiProvider
	mustJSON(t, alice.do("GET", "/ai-providers", nil), &list)
	if len(list) != 2 || list[0].Id != a.Id || list[1].Id != b.Id {
		t.Fatalf("list = %+v", list)
	}

	// Decision: deleting an assigned provider is rejected with 409, never silently un-assigned.
	wantError(t, alice.do("DELETE", "/ai-providers/"+b.Id.String(), nil), 409, "provider_in_use")
	alice.do("PUT", "/ai-tasks/story", map[string]any{"providerId": a.Id})
	if rec := alice.do("DELETE", "/ai-providers/"+b.Id.String(), nil); rec.Code != 204 {
		t.Fatalf("delete unassigned = %d %s", rec.Code, rec.Body)
	}
	wantError(t, alice.do("DELETE", "/ai-providers/"+b.Id.String(), nil), 404, "not_found")

	// Clear with DELETE; unknown task and unknown provider are 404; a missing or null id is 400.
	var cleared api.AiTaskAssignment
	rec := alice.do("DELETE", "/ai-tasks/story", nil)
	mustJSON(t, rec, &cleared)
	if rec.Code != 200 || cleared.ProviderId != nil {
		t.Fatalf("clear = %d %s", rec.Code, rec.Body)
	}
	wantError(t, alice.do("DELETE", "/ai-tasks/painting", nil), 404, "not_found")
	wantError(t, alice.do("PUT", "/ai-tasks/story", `{"providerId": null}`), 400, "bad_request")
	wantError(t, alice.do("PUT", "/ai-tasks/painting", map[string]any{"providerId": a.Id}), 404, "not_found")
	wantError(t, alice.do("PUT", "/ai-tasks/story", map[string]any{"providerId": "00000000-0000-0000-0000-000000000001"}), 404, "not_found")
	wantError(t, alice.do("PUT", "/ai-tasks/story", `{}`), 400, "bad_request")
}

func TestAIProvidersAreIsolatedBetweenUsers(t *testing.T) {
	e := newEnv(t, fakeDB{})
	alice, bob := newAIClient(t, e, "alice"), newAIClient(t, e, "bob")
	up := healthyUpstream(t)
	p := alice.create("Alice's", up.URL, apiKey)
	alice.do("PUT", "/ai-tasks/story", map[string]any{"providerId": p.Id})
	id := p.Id.String()

	var list []api.AiProvider
	mustJSON(t, bob.do("GET", "/ai-providers", nil), &list)
	if len(list) != 0 {
		t.Fatalf("bob lists alice's providers: %+v", list)
	}
	wantError(t, bob.do("GET", "/ai-providers/"+id, nil), 404, "not_found")
	wantError(t, bob.do("PATCH", "/ai-providers/"+id, map[string]any{"name": "mine now"}), 404, "not_found")
	wantError(t, bob.do("DELETE", "/ai-providers/"+id, nil), 404, "not_found")
	wantError(t, bob.do("POST", "/ai-providers/"+id+"/test", nil), 404, "not_found")
	wantError(t, bob.do("PUT", "/ai-tasks/story", map[string]any{"providerId": p.Id}), 404, "not_found")
	if auths := len(up.auths); auths != 0 {
		t.Errorf("bob's test request reached alice's provider %d time(s) with alice's key", auths)
	}
	var tasks []api.AiTaskAssignment
	mustJSON(t, bob.do("GET", "/ai-tasks", nil), &tasks)
	if tasks[0].ProviderId != nil {
		t.Errorf("bob sees alice's assignment: %+v", tasks)
	}

	// Bob can reuse the name, and alice's data is untouched.
	bob.create("Alice's", "http://b.example", nil)
	var got api.AiProvider
	mustJSON(t, alice.do("GET", "/ai-providers/"+id, nil), &got)
	if got.Name != "Alice's" || !got.HasApiKey {
		t.Errorf("alice's provider changed: %+v", got)
	}
}

func TestAIRoutesRequireAuthentication(t *testing.T) {
	e := newEnv(t, fakeDB{})
	id := "00000000-0000-0000-0000-000000000000"
	for _, r := range [][2]string{
		{"GET", "/ai-providers"}, {"POST", "/ai-providers"}, {"GET", "/ai-providers/" + id}, {"PATCH", "/ai-providers/" + id},
		{"DELETE", "/ai-providers/" + id}, {"POST", "/ai-providers/" + id + "/test"}, {"GET", "/ai-tasks"}, {"PUT", "/ai-tasks/story"}, {"DELETE", "/ai-tasks/story"},
	} {
		wantError(t, e.do(t, r[0], r[1], "", map[string]any{}), 401, "unauthorized")
		wantError(t, e.do(t, r[0], r[1], "Bearer nope", map[string]any{}), 401, "unauthorized")
	}
}

func TestAIConnectionTestOverHTTP(t *testing.T) {
	e := newEnv(t, fakeDB{})
	alice := newAIClient(t, e, "alice")

	good := alice.create("Good", healthyUpstream(t).URL, apiKey)
	var res api.AiProviderTestResult
	rec := alice.do("POST", "/ai-providers/"+good.Id.String()+"/test", nil)
	mustJSON(t, rec, &res)
	if rec.Code != 200 || !res.Ok || !strings.Contains(res.Message, "Connected") || res.StructuredOutput == nil || string(*res.StructuredOutput) != "json_schema" {
		t.Fatalf("good: %d %+v", rec.Code, res)
	}

	// A failing provider is HTTP 200 with ok=false and a readable reason, never a 5xx.
	denies := newUpstream(t, func(w http.ResponseWriter, _ map[string]any) {
		w.WriteHeader(401)
		_, _ = io.WriteString(w, `{"error":{"message":"Incorrect API key provided: `+apiKey+`"}}`)
	})
	bad := alice.create("Bad", denies.URL, apiKey)
	rec = alice.do("POST", "/ai-providers/"+bad.Id.String()+"/test", nil)
	mustJSON(t, rec, &res)
	if rec.Code != 200 || res.Ok || !strings.Contains(strings.ToLower(res.Message), "authentication failed") {
		t.Fatalf("401 case: %d %+v", rec.Code, res)
	}
	assertNoKey(t, "failure message", rec.Body.String())

	dead := httptest.NewServer(http.NotFoundHandler())
	deadURL := dead.URL
	dead.Close()
	gone := alice.create("Gone", deadURL, nil)
	rec = alice.do("POST", "/ai-providers/"+gone.Id.String()+"/test", nil)
	mustJSON(t, rec, &res)
	if rec.Code != 200 || res.Ok || !strings.Contains(strings.ToLower(res.Message), "cannot reach") {
		t.Fatalf("unreachable case: %d %+v", rec.Code, res)
	}

	for _, body := range *alice.all {
		assertNoKey(t, "response", body)
	}
}

// Keys and Authorization headers must never be logged, not even when a provider echoes
// them back in an error or when requests fail.
func TestAPIKeysAreNeverLogged(t *testing.T) {
	var buf bytes.Buffer
	var mu sync.Mutex
	prev := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&lockedWriter{&mu, &buf}, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	e := newEnv(t, fakeDB{})
	alice := newAIClient(t, e, "alice")
	echo := newUpstream(t, func(w http.ResponseWriter, _ map[string]any) {
		w.WriteHeader(500)
		_, _ = io.WriteString(w, `{"error":{"message":"upstream blew up for key `+apiKey+`"}}`)
	})
	p := alice.create("Noisy", echo.URL, apiKey)
	alice.do("POST", "/ai-providers/"+p.Id.String()+"/test", nil)
	alice.do("PATCH", "/ai-providers/"+p.Id.String(), map[string]any{"apiKey": apiKey + "2"})
	alice.do("POST", "/ai-providers/"+p.Id.String()+"/test", nil)
	alice.do("POST", "/ai-providers", `{"name":"x","apiKey":"`+apiKey) // malformed body

	mu.Lock()
	defer mu.Unlock()
	logs := buf.String()
	if logs == "" {
		t.Fatal("expected some debug logging from the retries; the check would be vacuous")
	}
	assertNoKey(t, "log output", logs)
	if strings.Contains(strings.ToLower(logs), "bearer ") || strings.Contains(strings.ToLower(logs), "authorization") {
		t.Errorf("log output mentions an Authorization header: %s", logs)
	}
}

type lockedWriter struct {
	mu *sync.Mutex
	w  io.Writer
}

func (l *lockedWriter) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.w.Write(p)
}

func TestTaskSetMatchesTheOpenAPIEnum(t *testing.T) {
	spec, err := api.GetSwagger()
	if err != nil {
		t.Fatal(err)
	}
	var fromSpec []string
	for _, v := range spec.Components.Schemas["AiTask"].Value.Enum {
		fromSpec = append(fromSpec, v.(string))
	}
	var fromGo []string
	for _, k := range aiprovider.Tasks {
		fromGo = append(fromGo, string(k))
	}
	if strings.Join(fromSpec, ",") != strings.Join(fromGo, ",") {
		t.Fatalf("OpenAPI AiTask enum %v != aiprovider.Tasks %v", fromSpec, fromGo)
	}
}
