package llm_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
)

var storySchema = llm.Schema{
	Name:   "story",
	Schema: json.RawMessage(`{"type":"object","properties":{"title":{"type":"string"},"n":{"type":"integer"}},"required":["title"],"additionalProperties":false}`),
}

func lastUserMessage(body map[string]any) string {
	msgs := body["messages"].([]any)
	return msgs[len(msgs)-1].(map[string]any)["content"].(string)
}

func TestChatJSONUsesJSONSchemaWhenSupported(t *testing.T) {
	f := newFake(t, reply(`{"title":"桜","n":3}`))
	res, err := newClient(t, f, &sleeps{}).ChatJSON(context.Background(), hello, storySchema, llm.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Mode != llm.ModeJSONSchema || string(res.JSON) != `{"title":"桜","n":3}` {
		t.Errorf("res = %+v", res)
	}
	reqs := f.requests()
	if len(reqs) != 1 {
		t.Fatalf("requests = %d, want 1", len(reqs))
	}
	rf := reqs[0].Body["response_format"].(map[string]any)
	js := rf["json_schema"].(map[string]any)
	if rf["type"] != "json_schema" || js["name"] != "story" || js["strict"] != true || js["schema"].(map[string]any)["type"] != "object" {
		t.Errorf("response_format = %v", rf)
	}
}

func TestChatJSONFallsBackToJSONObject(t *testing.T) {
	f := newFake(t,
		fail(400, `{"error":{"message":"response_format type json_schema is not supported"}}`),
		reply(`{"title":"a"}`))
	res, err := newClient(t, f, &sleeps{}).ChatJSON(context.Background(), hello, storySchema, llm.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Mode != llm.ModeJSONObject {
		t.Errorf("mode = %q, want json_object", res.Mode)
	}
	second := f.requests()[1].Body
	if second["response_format"].(map[string]any)["type"] != "json_object" {
		t.Errorf("second request response_format = %v", second["response_format"])
	}
	// json_object mode requires the word "JSON" in the prompt; the schema is described there too.
	if p := lastUserMessage(second); !strings.Contains(p, "JSON") || !strings.Contains(p, `"required"`) {
		t.Errorf("prompt does not describe the JSON schema: %q", p)
	}
}

func TestChatJSONFallsBackToPromptOnlyAndExtractsJSON(t *testing.T) {
	f := newFake(t,
		fail(400, `{"error":{"message":"unknown field response_format"}}`),
		fail(422, `{"detail":"response_format not supported"}`),
		reply("Sure! Here you go:\n```json\n{\"title\": \"hello {braces} inside\"}\n```\nHope it helps."))
	res, err := newClient(t, f, &sleeps{}).ChatJSON(context.Background(), hello, storySchema, llm.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Mode != llm.ModePromptOnly || string(res.JSON) != `{"title": "hello {braces} inside"}` {
		t.Errorf("res = mode %q json %s", res.Mode, res.JSON)
	}
	third := f.requests()[2].Body
	if _, has := third["response_format"]; has {
		t.Errorf("prompt-only request must not send response_format: %v", third)
	}
	if !strings.Contains(lastUserMessage(third), "JSON") {
		t.Errorf("prompt-only request does not ask for JSON")
	}
}

func TestChatJSONDegradesWhenEndpointIgnoresResponseFormat(t *testing.T) {
	// Some servers accept response_format silently and still answer with prose.
	f := newFake(t, reply("I would love to write a story!"), reply("still prose"), reply(`Result: {"title":"ok"} done`))
	res, err := newClient(t, f, &sleeps{}).ChatJSON(context.Background(), hello, storySchema, llm.Options{})
	if err != nil {
		t.Fatal(err)
	}
	if res.Mode != llm.ModePromptOnly || string(res.JSON) != `{"title":"ok"}` {
		t.Errorf("res = %+v", res)
	}
}

func TestChatJSONRejectsOutputThatDoesNotMatchTheSchema(t *testing.T) {
	cases := map[string]string{
		"missing required key": `{"n":1}`,
		"wrong top-level type": `["title"]`,
		"not json at all":      `no json here`,
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFake(t, reply(content))
			_, err := newClient(t, f, &sleeps{}).ChatJSON(context.Background(), hello, storySchema, llm.Options{})
			if !errors.Is(err, llm.ErrBadResponse) {
				t.Fatalf("err = %v, want ErrBadResponse", err)
			}
			if n := len(f.requests()); n != 3 {
				t.Errorf("requests = %d, want 3 (every mode tried once)", n)
			}
		})
	}
}

func TestChatJSONDoesNotFallBackOnAuthModelOrRateLimitErrors(t *testing.T) {
	cases := map[string]struct {
		step step
		want error
	}{
		"auth":  {fail(401, `{"error":{"message":"bad key"}}`), llm.ErrAuth},
		"model": {fail(404, `{"error":{"message":"model not found","code":"model_not_found"}}`), llm.ErrModelNotFound},
		"rate":  {fail(429, `{}`), llm.ErrRateLimited},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			f := newFake(t, tc.step)
			_, err := newClient(t, f, &sleeps{}, llm.WithMaxAttempts(1)).ChatJSON(context.Background(), hello, storySchema, llm.Options{})
			if !errors.Is(err, tc.want) {
				t.Fatalf("err = %v, want %v", err, tc.want)
			}
			if n := len(f.requests()); n != 1 {
				t.Errorf("requests = %d, want 1", n)
			}
		})
	}
}

func TestChatJSONRequiresAValidSchema(t *testing.T) {
	c, _ := llm.New(llm.Config{BaseURL: "http://127.0.0.1:1", Model: "m"})
	for _, s := range []llm.Schema{{Name: "x", Schema: json.RawMessage(`not json`)}, {Name: "", Schema: json.RawMessage(`{}`)}} {
		if _, err := c.ChatJSON(context.Background(), hello, s, llm.Options{}); err == nil {
			t.Errorf("schema %+v accepted", s)
		}
	}
}
