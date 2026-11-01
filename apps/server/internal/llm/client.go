package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

// Roles of chat messages.
const (
	RoleSystem    = "system"
	RoleUser      = "user"
	RoleAssistant = "assistant"
)

// Message is one chat message.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// Config identifies one endpoint. APIKey may be empty for keyless local endpoints.
type Config struct {
	BaseURL string
	APIKey  string
	Model   string
}

// Options tunes one call. Zero values mean "leave it to the endpoint's defaults".
type Options struct {
	// Temperature is sent only when non-nil (some models reject the parameter).
	Temperature *float64
	// MaxTokens caps the completion length (0 = unset).
	MaxTokens int
	// Timeout overrides the client's per-attempt timeout (0 = client default).
	Timeout time.Duration
}

// Result is a successful completion.
type Result struct {
	Content      string
	Model        string
	FinishReason string
}

// Defaults.
const (
	DefaultTimeout     = 60 * time.Second
	DefaultMaxAttempts = 3
	DefaultBackoffBase = 500 * time.Millisecond
	DefaultBackoffMax  = 8 * time.Second
	// maxRetryAfter is the longest Retry-After we will wait out; a longer one fails fast.
	maxRetryAfter = 30 * time.Second
	maxBodyBytes  = 8 << 20
)

// Client talks to one OpenAI-compatible endpoint. It is safe for concurrent use.
type Client struct {
	cfg         Config
	http        *http.Client
	timeout     time.Duration
	maxAttempts int
	backoffBase time.Duration
	backoffMax  time.Duration
	sleep       func(context.Context, time.Duration) error
	rand        func() float64
}

// Option customises a Client.
type Option func(*Client)

// WithTimeout sets the per-attempt timeout (connect + request + reading the response).
func WithTimeout(d time.Duration) Option { return func(c *Client) { c.timeout = d } }

// WithMaxAttempts sets the total number of tries per request (1 = no retries).
func WithMaxAttempts(n int) Option { return func(c *Client) { c.maxAttempts = max(1, n) } }

// WithBackoff sets the exponential backoff base and cap.
func WithBackoff(base, maxDelay time.Duration) Option {
	return func(c *Client) { c.backoffBase, c.backoffMax = base, maxDelay }
}

// WithHTTPClient replaces the HTTP client (its own Timeout should stay unset).
func WithHTTPClient(h *http.Client) Option { return func(c *Client) { c.http = h } }

// WithSleep replaces the wait between retries (tests).
func WithSleep(f func(context.Context, time.Duration) error) Option {
	return func(c *Client) { c.sleep = f }
}

// WithRand replaces the jitter source, a function returning [0,1) (tests).
func WithRand(f func() float64) Option { return func(c *Client) { c.rand = f } }

// New validates cfg and returns a Client for it.
func New(cfg Config, opts ...Option) (*Client, error) {
	base, err := NormalizeBaseURL(cfg.BaseURL)
	if err != nil {
		return nil, err
	}
	cfg.BaseURL = base
	cfg.Model = strings.TrimSpace(cfg.Model)
	if cfg.Model == "" {
		return nil, errors.New("model is required")
	}
	c := &Client{
		cfg:         cfg,
		http:        &http.Client{},
		timeout:     DefaultTimeout,
		maxAttempts: DefaultMaxAttempts,
		backoffBase: DefaultBackoffBase,
		backoffMax:  DefaultBackoffMax,
		sleep:       sleepCtx,
		rand:        rand.Float64,
	}
	for _, o := range opts {
		o(c)
	}
	return c, nil
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Chat sends a plain chat completion.
func (c *Client) Chat(ctx context.Context, msgs []Message, opts Options) (Result, error) {
	return c.complete(ctx, chatRequest{Model: c.cfg.Model, Messages: msgs}, opts)
}

type chatRequest struct {
	Model               string          `json:"model"`
	Messages            []Message       `json:"messages"`
	Temperature         *float64        `json:"temperature,omitempty"`
	MaxTokens           int             `json:"max_tokens,omitempty"`
	MaxCompletionTokens int             `json:"max_completion_tokens,omitempty"`
	ResponseFormat      json.RawMessage `json:"response_format,omitempty"`
}

// complete applies opts, sends the request with retries, and adapts once to endpoints that
// want max_completion_tokens instead of max_tokens (OpenAI reasoning models).
func (c *Client) complete(ctx context.Context, req chatRequest, opts Options) (Result, error) {
	req.Temperature = opts.Temperature
	req.MaxTokens = opts.MaxTokens
	timeout := c.timeout
	if opts.Timeout > 0 {
		timeout = opts.Timeout
	}
	res, err := c.send(ctx, req, timeout)
	if err != nil && req.MaxTokens > 0 && errors.Is(err, ErrBadRequest) &&
		strings.Contains(err.Error(), "max_completion_tokens") {
		req.MaxCompletionTokens, req.MaxTokens = req.MaxTokens, 0
		res, err = c.send(ctx, req, timeout)
	}
	return res, err
}

// send POSTs the request, retrying 429/5xx/timeouts/network errors with exponential
// backoff and jitter (or the server's Retry-After). Auth, validation and other 4xx errors
// are returned at once.
func (c *Client) send(ctx context.Context, req chatRequest, timeout time.Duration) (Result, error) {
	body, err := json.Marshal(req)
	if err != nil {
		return Result{}, err
	}
	var lastErr error
	for attempt := 1; attempt <= c.maxAttempts; attempt++ {
		res, err := c.attempt(ctx, body, timeout)
		if err == nil {
			return res, nil
		}
		if ctx.Err() != nil {
			return Result{}, ctx.Err() // the caller gave up; not a provider failure
		}
		lastErr = err
		var le *Error
		if !errors.As(err, &le) || !le.retryable() || attempt == c.maxAttempts {
			return Result{}, err
		}
		wait := le.RetryAfter
		if wait > maxRetryAfter {
			return Result{}, err
		}
		if wait <= 0 {
			ceiling := c.backoffBase << min(attempt-1, 30)
			if ceiling <= 0 || ceiling > c.backoffMax {
				ceiling = c.backoffMax
			}
			wait = time.Duration(c.rand() * float64(ceiling))
		}
		slog.Debug("llm: retrying", "attempt", attempt, "status", le.Status, "kind", le.Kind.Error(), "wait", wait)
		if err := c.sleep(ctx, wait); err != nil {
			return Result{}, err
		}
	}
	return Result{}, lastErr
}

func (c *Client) attempt(ctx context.Context, body []byte, timeout time.Duration) (Result, error) {
	actx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(actx, http.MethodPost, c.cfg.BaseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return Result{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "virtual-japan-tutor")
	if c.cfg.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.cfg.APIKey)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return Result{}, c.transportError(ctx, actx, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return Result{}, c.transportError(ctx, actx, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return Result{}, c.statusError(resp, raw)
	}
	return c.parse(raw, resp.StatusCode)
}

// transportError classifies a failure to complete the HTTP exchange. Only the underlying
// cause is reported (url.Error text would repeat the URL); the key is never in a URL.
func (c *Client) transportError(parent, attempt context.Context, err error) error {
	var ne net.Error
	if (errors.Is(attempt.Err(), context.DeadlineExceeded) && parent.Err() == nil) ||
		(errors.As(err, &ne) && ne.Timeout() && parent.Err() == nil) {
		return &Error{Kind: ErrTimeout, Detail: "the endpoint did not answer in time"}
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	return &Error{Kind: ErrUnreachable, Detail: c.clean(err.Error())}
}

func (c *Client) statusError(resp *http.Response, raw []byte) error {
	msg, code := upstreamMessage(raw)
	msg = c.clean(msg)
	e := &Error{Status: resp.StatusCode, Detail: msg}
	lower := strings.ToLower(msg)
	modelMissing := code == "model_not_found" ||
		(strings.Contains(lower, "model") && (strings.Contains(lower, "not found") ||
			strings.Contains(lower, "does not exist") || strings.Contains(lower, "not a valid model")))
	switch s := resp.StatusCode; {
	case s == http.StatusUnauthorized || s == http.StatusForbidden:
		e.Kind = ErrAuth
	case modelMissing && (s == http.StatusNotFound || s == http.StatusBadRequest):
		e.Kind = ErrModelNotFound
	case s == http.StatusNotFound:
		e.Kind = ErrEndpointNotFound
	case s == http.StatusTooManyRequests:
		e.Kind = ErrRateLimited
		e.RetryAfter = parseRetryAfter(resp.Header.Get("Retry-After"), time.Now())
	case s == http.StatusRequestTimeout:
		e.Kind = ErrTimeout
	case s >= 500:
		e.Kind = ErrServer
	default:
		e.Kind = ErrBadRequest
	}
	return e
}

type chatResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		FinishReason string `json:"finish_reason"`
		Message      struct {
			Content *string `json:"content"`
			Refusal *string `json:"refusal"`
		} `json:"message"`
	} `json:"choices"`
}

func (c *Client) parse(raw []byte, status int) (Result, error) {
	var r chatResponse
	if err := json.Unmarshal(raw, &r); err != nil {
		return Result{}, &Error{Kind: ErrBadResponse, Status: status, Detail: "the endpoint did not return JSON (is the base URL an OpenAI-compatible /v1 endpoint?)"}
	}
	if len(r.Choices) == 0 {
		return Result{}, &Error{Kind: ErrBadResponse, Status: status, Detail: "the response contained no choices"}
	}
	m := r.Choices[0].Message
	if m.Content == nil || strings.TrimSpace(*m.Content) == "" {
		detail := "the response contained no message content"
		if m.Refusal != nil && *m.Refusal != "" {
			detail = "the model refused: " + c.clean(*m.Refusal)
		}
		return Result{}, &Error{Kind: ErrBadResponse, Status: status, Detail: detail}
	}
	return Result{Content: *m.Content, Model: r.Model, FinishReason: r.Choices[0].FinishReason}, nil
}

// upstreamMessage pulls a human-readable message (and error code) from the common error
// body shapes: {"error":{"message","code"}}, {"error":"text"}, {"detail":"text"}, {"message":"text"}.
func upstreamMessage(raw []byte) (msg, code string) {
	var b struct {
		Error   json.RawMessage `json:"error"`
		Detail  json.RawMessage `json:"detail"`
		Message string          `json:"message"`
	}
	if json.Unmarshal(raw, &b) != nil {
		text := strings.TrimSpace(string(raw))
		if strings.HasPrefix(text, "<") { // an HTML error page: not useful to show
			return "", ""
		}
		return text, ""
	}
	if len(b.Error) > 0 {
		var obj struct {
			Message string          `json:"message"`
			Code    json.RawMessage `json:"code"`
		}
		var s string
		switch {
		case json.Unmarshal(b.Error, &obj) == nil && obj.Message != "":
			_ = json.Unmarshal(obj.Code, &code)
			return obj.Message, code
		case json.Unmarshal(b.Error, &s) == nil && s != "":
			return s, ""
		}
	}
	var d string
	if json.Unmarshal(b.Detail, &d) == nil && d != "" {
		return d, ""
	}
	return b.Message, ""
}

// clean makes an upstream-supplied string safe to show: the API key is removed (some
// providers echo it back in auth errors), control characters dropped, length bounded.
func (c *Client) clean(s string) string {
	if c.cfg.APIKey != "" {
		s = strings.ReplaceAll(s, c.cfg.APIKey, "[redacted]")
	}
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return ' '
		}
		return r
	}, s)
	s = strings.TrimSpace(s)
	if r := []rune(s); len(r) > 300 {
		s = string(r[:300]) + "…"
	}
	return s
}

func parseRetryAfter(v string, now time.Time) time.Duration {
	v = strings.TrimSpace(v)
	if v == "" {
		return 0
	}
	if secs, err := strconv.Atoi(v); err == nil {
		return time.Duration(max(secs, 0)) * time.Second
	}
	if t, err := http.ParseTime(v); err == nil {
		return max(t.Sub(now), 0)
	}
	return 0
}

// Sentinel error kinds; match with errors.Is.
var (
	ErrAuth             = errors.New("authentication failed")
	ErrModelNotFound    = errors.New("model not found")
	ErrEndpointNotFound = errors.New("endpoint not found")
	ErrRateLimited      = errors.New("rate limited")
	ErrTimeout          = errors.New("timed out")
	ErrUnreachable      = errors.New("cannot reach the endpoint")
	ErrBadRequest       = errors.New("request rejected")
	ErrBadResponse      = errors.New("unexpected response")
	ErrServer           = errors.New("provider error")
)

// Error is a failed call to a provider. Kind is one of the Err* sentinels (errors.Is works);
// Detail is a bounded, key-free excerpt of what the provider said.
type Error struct {
	Kind       error
	Status     int // HTTP status, 0 if none was received
	Detail     string
	RetryAfter time.Duration
}

func (e *Error) Error() string {
	if e.Detail == "" {
		return e.Kind.Error()
	}
	return fmt.Sprintf("%s: %s", e.Kind, e.Detail)
}

func (e *Error) Unwrap() error { return e.Kind }

func (e *Error) retryable() bool {
	switch e.Kind {
	case ErrRateLimited, ErrServer, ErrTimeout, ErrUnreachable:
		return true
	}
	return false
}
