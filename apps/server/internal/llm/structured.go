package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// Mode is how structured output was obtained. Endpoints differ in what they support, so
// ChatJSON tries the strongest mode first and degrades. The outcome is reported per call;
// nothing is remembered between calls.
type Mode string

const (
	// ModeJSONSchema uses response_format {"type":"json_schema"} (OpenAI Structured Outputs).
	ModeJSONSchema Mode = "json_schema"
	// ModeJSONObject uses response_format {"type":"json_object"} plus the schema in the prompt.
	ModeJSONObject Mode = "json_object"
	// ModePromptOnly sends no response_format: the schema is in the prompt and the JSON is
	// extracted from the reply.
	ModePromptOnly Mode = "prompt_only"
)

// Schema describes the JSON the caller wants. Schema is a JSON Schema document.
type Schema struct {
	Name   string // a-z, A-Z, 0-9, _ and - (OpenAI limits it to 64 characters)
	Schema json.RawMessage
}

// JSONResult is a completion whose content was validated as JSON.
type JSONResult struct {
	Result
	JSON json.RawMessage
	Mode Mode
}

// ChatJSON asks for a reply matching schema. It tries json_schema, then json_object, then
// prompt-only with JSON extraction, moving on when the endpoint rejects the request (4xx
// other than auth/model/rate-limit) or answers with something that is not JSON matching the
// schema's top-level type and required keys. Only that coarse check is made: callers must
// still validate the content they use.
func (c *Client) ChatJSON(ctx context.Context, msgs []Message, schema Schema, opts Options) (JSONResult, error) {
	shape, err := parseShape(schema)
	if err != nil {
		return JSONResult{}, err
	}
	var lastErr error
	for _, mode := range []Mode{ModeJSONSchema, ModeJSONObject, ModePromptOnly} {
		req := chatRequest{Model: c.cfg.Model, Messages: msgs}
		switch mode {
		case ModeJSONSchema:
			req.ResponseFormat, _ = json.Marshal(map[string]any{
				"type": "json_schema",
				"json_schema": map[string]any{
					"name": schema.Name, "schema": schema.Schema, "strict": true,
				},
			})
		case ModeJSONObject:
			req.ResponseFormat = json.RawMessage(`{"type":"json_object"}`)
			req.Messages = withSchemaPrompt(msgs, schema)
		case ModePromptOnly:
			req.Messages = withSchemaPrompt(msgs, schema)
		}

		res, err := c.complete(ctx, req, opts)
		if err == nil {
			if raw, perr := extractJSON(res.Content, shape); perr == nil {
				return JSONResult{Result: res, JSON: raw, Mode: mode}, nil
			}
			err = &Error{Kind: ErrBadResponse, Detail: fmt.Sprintf("the model did not return JSON matching the schema (mode %s)", mode)}
		}
		lastErr = err
		if !errors.Is(err, ErrBadRequest) && !errors.Is(err, ErrBadResponse) {
			return JSONResult{}, err // auth, model, rate limit, timeout...: another mode will not help
		}
	}
	return JSONResult{}, lastErr
}

func withSchemaPrompt(msgs []Message, schema Schema) []Message {
	out := slices.Clone(msgs)
	instr := "Respond with only a single JSON value that conforms to this JSON Schema. " +
		"No prose and no code fences.\nJSON Schema:\n" + string(schema.Schema)
	if n := len(out); n > 0 && out[n-1].Role == RoleUser {
		out[n-1].Content += "\n\n" + instr
	} else {
		out = append(out, Message{Role: RoleUser, Content: instr})
	}
	return out
}

// shape is the coarse part of a schema that ChatJSON checks.
type shape struct {
	Type     string   `json:"type"`
	Required []string `json:"required"`
}

func parseShape(s Schema) (shape, error) {
	if strings.TrimSpace(s.Name) == "" {
		return shape{}, errors.New("llm: schema name is required")
	}
	var sh shape
	if err := json.Unmarshal(s.Schema, &sh); err != nil {
		return shape{}, fmt.Errorf("llm: schema is not a JSON object: %w", err)
	}
	return sh, nil
}

func (sh shape) accepts(raw json.RawMessage) bool {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 {
		return false
	}
	switch sh.Type {
	case "object":
		var obj map[string]json.RawMessage
		if json.Unmarshal(raw, &obj) != nil {
			return false
		}
		for _, k := range sh.Required {
			if _, ok := obj[k]; !ok {
				return false
			}
		}
		return true
	case "array":
		return raw[0] == '['
	}
	return json.Valid(raw)
}

var fence = regexp.MustCompile("(?s)```[a-zA-Z]*\\s*\n(.*?)```")

// extractJSON finds the JSON value in a model reply: the whole reply, a fenced block, or
// the first embedded value that satisfies sh.
func extractJSON(content string, sh shape) (json.RawMessage, error) {
	content = strings.TrimSpace(content)
	candidates := []string{content}
	for _, m := range fence.FindAllStringSubmatch(content, -1) {
		candidates = append(candidates, strings.TrimSpace(m[1]))
	}
	for _, cand := range candidates {
		if json.Valid([]byte(cand)) && sh.accepts(json.RawMessage(cand)) {
			return json.RawMessage(cand), nil
		}
	}
	for i := 0; i < len(content); i++ {
		if content[i] != '{' && content[i] != '[' {
			continue
		}
		var raw json.RawMessage
		dec := json.NewDecoder(strings.NewReader(content[i:]))
		if dec.Decode(&raw) == nil && sh.accepts(raw) {
			return raw, nil
		}
	}
	return nil, errors.New("no matching JSON found")
}
