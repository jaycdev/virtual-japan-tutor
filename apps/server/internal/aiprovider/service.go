package aiprovider

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

const (
	maxNameRunes  = 80
	maxModelRunes = 200
	maxKeyBytes   = 4096
	// DefaultName is the name of the provider seeded from AI_DEFAULT_* env vars.
	DefaultName = "Default"

	testOverall = 45 * time.Second
)

// ModeUnavailable is reported by a connection test when the endpoint answers chat requests
// but no structured-output mode produced usable JSON.
const ModeUnavailable llm.Mode = "unavailable"

// Provider is the client-facing view of a stored AI Provider. It deliberately has no key
// field, not even a masked one: only HasAPIKey.
type Provider struct {
	ID        uuid.UUID
	Name      string
	BaseURL   string
	Model     string
	HasAPIKey bool
	CreatedAt time.Time
	UpdatedAt time.Time
}

// KeyChange says what to do with the stored API key. The zero value keeps it.
type KeyChange struct {
	set   bool
	value string
}

// SetKey replaces the key; an empty value removes it.
func SetKey(v string) KeyChange { return KeyChange{set: true, value: v} }

// Input creates a provider.
type Input struct {
	Name, BaseURL, Model string
	APIKey               KeyChange // the zero value means no key
}

// Patch changes the fields that are non-nil / set.
type Patch struct {
	Name, BaseURL, Model *string
	APIKey               KeyChange
}

// Assignment is the provider chosen for a task (nil: none).
type Assignment struct {
	Task       Task
	ProviderID *uuid.UUID
}

// TestResult is the outcome of a connection test. A failing provider is a result with
// OK=false, never an error.
type TestResult struct {
	OK         bool
	Latency    time.Duration
	Message    string
	Structured llm.Mode // set when OK
}

// Resolved is a provider ready for server-side use. Config holds the decrypted key: keep
// it out of responses and logs.
type Resolved struct {
	Provider Provider
	Config   llm.Config
	Client   *llm.Client
}

// DefaultConfig is the env-seeded default provider (AI_DEFAULT_*).
type DefaultConfig struct{ BaseURL, APIKey, Model string }

// Service implements AI Provider management over a Store.
type Service struct {
	store      Store
	box        *secrets.Box
	clientOpts []llm.Option
}

// Option customises a Service.
type Option func(*Service)

// WithClientOptions adds llm.Client options (timeouts, retries, and in tests the sleep and
// jitter sources) to every client the service builds.
func WithClientOptions(o ...llm.Option) Option {
	return func(s *Service) { s.clientOpts = append(s.clientOpts, o...) }
}

func NewService(store Store, box *secrets.Box, opts ...Option) *Service {
	s := &Service{store: store, box: box}
	for _, o := range opts {
		o(s)
	}
	return s
}

// --- CRUD (user from the context; no identity, no query) ---

func (s *Service) List(ctx context.Context) ([]Provider, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	recs, err := s.store.List(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]Provider, len(recs))
	for i, r := range recs {
		out[i] = view(r)
	}
	return out, nil
}

func (s *Service) Get(ctx context.Context, id uuid.UUID) (Provider, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return Provider{}, err
	}
	r, err := s.store.Get(ctx, uid, id)
	return view(r), err
}

func (s *Service) Create(ctx context.Context, in Input) (Provider, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return Provider{}, err
	}
	rec, err := s.newRecord(in)
	if err != nil {
		return Provider{}, err
	}
	r, err := s.store.Create(ctx, uid, rec)
	return view(r), err
}

func (s *Service) Update(ctx context.Context, id uuid.UUID, p Patch) (Provider, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return Provider{}, err
	}
	rec, err := s.store.Get(ctx, uid, id)
	if err != nil {
		return Provider{}, err
	}
	if p.Name != nil {
		if rec.Name, err = validName(*p.Name); err != nil {
			return Provider{}, err
		}
	}
	if p.BaseURL != nil {
		if rec.BaseURL, err = validBaseURL(*p.BaseURL); err != nil {
			return Provider{}, err
		}
	}
	if p.Model != nil {
		if rec.Model, err = validModel(*p.Model); err != nil {
			return Provider{}, err
		}
	}
	if p.APIKey.set {
		if rec.APIKeyEncrypted, err = s.sealKey(p.APIKey.value); err != nil {
			return Provider{}, err
		}
	}
	r, err := s.store.Update(ctx, uid, rec)
	return view(r), err
}

// Delete removes a provider. It is rejected with ErrInUse while a task is assigned to it:
// the Learner must pick another provider for the task first (silently un-assigning would
// leave Story generation with nothing to use).
func (s *Service) Delete(ctx context.Context, id uuid.UUID) error {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return err
	}
	return s.store.Delete(ctx, uid, id)
}

// Assignments lists every task in a stable order, with its provider if any.
func (s *Service) Assignments(ctx context.Context) ([]Assignment, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return nil, err
	}
	m, err := s.store.Assignments(ctx, uid)
	if err != nil {
		return nil, err
	}
	out := make([]Assignment, len(Tasks))
	for i, t := range Tasks {
		out[i] = Assignment{Task: t}
		if id, ok := m[t]; ok {
			out[i].ProviderID = &id
		}
	}
	return out, nil
}

// Assign chooses the provider for a task (nil clears it).
func (s *Service) Assign(ctx context.Context, task Task, providerID *uuid.UUID) error {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return err
	}
	if !task.Valid() {
		return fmt.Errorf("%w: %q", ErrUnknownTask, task)
	}
	return s.store.Assign(ctx, uid, task, providerID)
}

// --- resolver and seeding (explicit user: used by later features and at startup) ---

// ResolveProvider returns the decrypted config and a ready client for the provider the
// user assigned to task. Callers pass auth.UserID(ctx), never request input.
func (s *Service) ResolveProvider(ctx context.Context, userID uuid.UUID, task Task) (Resolved, error) {
	if !task.Valid() {
		return Resolved{}, fmt.Errorf("%w: %q", ErrUnknownTask, task)
	}
	m, err := s.store.Assignments(ctx, userID)
	if err != nil {
		return Resolved{}, err
	}
	id, ok := m[task]
	if !ok {
		return Resolved{}, fmt.Errorf("%w: %s (choose one in Settings)", ErrNotAssigned, task)
	}
	rec, err := s.store.Get(ctx, userID, id)
	if err != nil {
		return Resolved{}, err
	}
	return s.resolve(rec)
}

// resolve builds the client from defaults (applied first) and then the service's own
// options, so options configured on the Service always win.
func (s *Service) resolve(rec Record, defaults ...llm.Option) (Resolved, error) {
	cfg := llm.Config{BaseURL: rec.BaseURL, Model: rec.Model}
	if rec.APIKeyEncrypted != nil {
		key, err := s.box.Decrypt(*rec.APIKeyEncrypted)
		if err != nil {
			return Resolved{}, ErrKeyUnreadable
		}
		cfg.APIKey = key
	}
	client, err := llm.New(cfg, append(append([]llm.Option(nil), defaults...), s.clientOpts...)...)
	if err != nil {
		return Resolved{}, err
	}
	return Resolved{Provider: view(rec), Config: cfg, Client: client}, nil
}

// SeedDefault creates the "Default" provider from cfg and assigns it to every task, but
// only if the user has no providers yet, so it is safe to call on every boot. A zero cfg is
// a no-op.
func (s *Service) SeedDefault(ctx context.Context, userID uuid.UUID, cfg DefaultConfig) (bool, error) {
	if cfg.BaseURL == "" && cfg.Model == "" && cfg.APIKey == "" {
		return false, nil
	}
	key := KeyChange{}
	if cfg.APIKey != "" {
		key = SetKey(cfg.APIKey)
	}
	rec, err := s.newRecord(Input{Name: DefaultName, BaseURL: cfg.BaseURL, Model: cfg.Model, APIKey: key})
	if err != nil {
		return false, err
	}
	return s.store.CreateDefaultIfNone(ctx, userID, rec, Tasks)
}

// --- connection test ---

// Test sends a tiny chat request (and a structured-output probe) to the provider and
// reports the outcome in plain language. Only a missing provider or a storage failure is
// an error.
func (s *Service) Test(ctx context.Context, id uuid.UUID) (TestResult, error) {
	uid, err := auth.UserID(ctx)
	if err != nil {
		return TestResult{}, err
	}
	rec, err := s.store.Get(ctx, uid, id)
	if err != nil {
		return TestResult{}, err
	}
	res, err := s.resolve(rec, llm.WithTimeout(15*time.Second), llm.WithMaxAttempts(3))
	if errors.Is(err, ErrKeyUnreadable) {
		return TestResult{Message: ErrKeyUnreadable.Error()}, nil
	}
	if err != nil {
		return TestResult{Message: "The saved configuration is invalid: " + err.Error()}, nil
	}

	ctx, cancel := context.WithTimeout(ctx, testOverall)
	defer cancel()

	start := time.Now()
	_, err = res.Client.Chat(ctx, []llm.Message{
		{Role: llm.RoleUser, Content: "Reply with the single word: ok"},
	}, llm.Options{MaxTokens: probeMaxTokens})
	latency := time.Since(start)
	if err != nil {
		return TestResult{Latency: latency, Message: describeFailure(err, rec)}, nil
	}

	mode := ModeUnavailable
	if j, jerr := res.Client.ChatJSON(ctx, []llm.Message{
		{Role: llm.RoleUser, Content: "Return a JSON object with the key ok set to true."},
	}, probeSchema, llm.Options{MaxTokens: probeMaxTokens}); jerr == nil {
		mode = j.Mode
	}
	return TestResult{OK: true, Latency: latency, Structured: mode, Message: successMessage(latency, mode)}, nil
}

// probeMaxTokens leaves room for a reasoning model to think before it answers; the tiny
// probe prompts stop early on ordinary models, so this costs nothing there.
const probeMaxTokens = 512

var probeSchema = llm.Schema{
	Name:   "connection_test",
	Schema: []byte(`{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}`),
}

func successMessage(latency time.Duration, mode llm.Mode) string {
	base := fmt.Sprintf("Connected: the model answered in %d ms.", latency.Milliseconds())
	switch mode {
	case llm.ModeJSONSchema:
		return base + " Structured JSON output is supported."
	case llm.ModeJSONObject:
		return base + " JSON mode is supported (json_schema is not); the app will use it."
	case llm.ModePromptOnly:
		return base + " The endpoint has no JSON mode; the app will ask for JSON in the prompt and extract it."
	}
	return base + " Warning: it did not return usable JSON when asked, so features that need structured output may fail with this model."
}

func describeFailure(err error, rec Record) string {
	var le *llm.Error
	detail := ""
	status := ""
	if errors.As(err, &le) {
		if le.Detail != "" {
			detail = " (" + le.Detail + ")"
		}
		if le.Status != 0 {
			status = fmt.Sprintf(" (HTTP %d)", le.Status)
		}
	}
	switch {
	case errors.Is(err, llm.ErrAuth):
		return "Authentication failed" + status + ": check the API key" + detail + "."
	case errors.Is(err, llm.ErrModelNotFound):
		return fmt.Sprintf("Model not found: the endpoint does not know the model %q; check the model name%s.", rec.Model, detail)
	case errors.Is(err, llm.ErrEndpointNotFound):
		return "Endpoint not found" + status + ": check the base URL (it should end in /v1)."
	case errors.Is(err, llm.ErrRateLimited):
		return "Rate limited by the provider" + status + " even after retrying; wait a moment and try again" + detail + "."
	case errors.Is(err, llm.ErrTimeout), errors.Is(err, context.DeadlineExceeded):
		return "Timed out waiting for the endpoint; check the base URL and that the server is running."
	case errors.Is(err, llm.ErrUnreachable):
		return "Cannot reach the endpoint" + detail + ": check the base URL and your network."
	case errors.Is(err, llm.ErrTruncated):
		return "The endpoint works, but the model spent its whole token limit thinking and gave no answer" + detail +
			". Use a non-reasoning model or lower its reasoning effort."
	case errors.Is(err, llm.ErrBadResponse):
		return "The endpoint answered, but not like an OpenAI-compatible chat API" + detail + ": check the base URL."
	case errors.Is(err, llm.ErrBadRequest):
		return "The endpoint rejected the request" + status + detail + "."
	case errors.Is(err, llm.ErrServer):
		return "The provider reported an error" + status + detail + "."
	case errors.Is(err, context.Canceled):
		return "The test was cancelled."
	}
	return "Connection test failed."
}

// --- helpers ---

func view(r Record) Provider {
	return Provider{ID: r.ID, Name: r.Name, BaseURL: r.BaseURL, Model: r.Model,
		HasAPIKey: r.APIKeyEncrypted != nil, CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt}
}

func (s *Service) newRecord(in Input) (Record, error) {
	name, err := validName(in.Name)
	if err != nil {
		return Record{}, err
	}
	base, err := validBaseURL(in.BaseURL)
	if err != nil {
		return Record{}, err
	}
	model, err := validModel(in.Model)
	if err != nil {
		return Record{}, err
	}
	rec := Record{Name: name, BaseURL: base, Model: model}
	if in.APIKey.set {
		if rec.APIKeyEncrypted, err = s.sealKey(in.APIKey.value); err != nil {
			return Record{}, err
		}
	}
	return rec, nil
}

// sealKey encrypts a key; an empty key is stored as NULL.
func (s *Service) sealKey(key string) (*string, error) {
	key = strings.TrimSpace(key)
	if key == "" {
		return nil, nil
	}
	if len(key) > maxKeyBytes {
		return nil, invalid("API key is too long")
	}
	for _, r := range key {
		if unicode.IsControl(r) || unicode.IsSpace(r) {
			return nil, invalid("API key must not contain whitespace or control characters")
		}
	}
	enc, err := s.box.Encrypt(key)
	if err != nil {
		return nil, err
	}
	return &enc, nil
}

func invalid(msg string) error { return fmt.Errorf("%w: %s", ErrInvalidInput, msg) }

func validName(v string) (string, error) {
	v = strings.TrimSpace(v)
	if n := utf8.RuneCountInString(v); n == 0 || n > maxNameRunes {
		return "", invalid(fmt.Sprintf("name must be 1-%d characters", maxNameRunes))
	}
	for _, r := range v {
		if unicode.IsControl(r) {
			return "", invalid("name must not contain control characters")
		}
	}
	return v, nil
}

func validModel(v string) (string, error) {
	v = strings.TrimSpace(v)
	if n := utf8.RuneCountInString(v); n == 0 || n > maxModelRunes {
		return "", invalid(fmt.Sprintf("model must be 1-%d characters", maxModelRunes))
	}
	for _, r := range v {
		if unicode.IsControl(r) {
			return "", invalid("model must not contain control characters")
		}
	}
	return v, nil
}

func validBaseURL(v string) (string, error) {
	u, err := llm.NormalizeBaseURL(v)
	if err != nil {
		return "", invalid(err.Error())
	}
	return u, nil
}
