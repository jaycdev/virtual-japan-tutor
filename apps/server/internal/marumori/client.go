package marumori

import (
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

// Defaults. MaruMori answers are usually small, but a large known-vocabulary list is
// one big JSON document, so the read cap is generous.
const (
	DefaultTimeout     = 30 * time.Second
	DefaultMaxAttempts = 3
	DefaultBackoffBase = 500 * time.Millisecond
	DefaultBackoffMax  = 8 * time.Second
	// maxRetryAfter is the longest Retry-After we will wait out; a longer one fails fast.
	maxRetryAfter = 30 * time.Second
	maxBodyBytes  = 32 << 20
)

// Client talks to one MaruMori account (base URL + API key). It is safe for concurrent
// use; Sync calls its methods in sequence, so upstream calls are never fanned out.
type Client struct {
	base        string
	key         string
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

// New returns a Client for one MaruMori account. baseURL may be empty for the default.
func New(baseURL, apiKey string, opts ...Option) (*Client, error) {
	base, err := NormalizeBaseURL(baseURL)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(apiKey) == "" {
		return nil, errors.New("MaruMori API key is required")
	}
	c := &Client{
		base:        base,
		key:         apiKey,
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

// NormalizeBaseURL validates a MaruMori base URL and strips its trailing slash. An
// empty string yields the default API.
func NormalizeBaseURL(raw string) (string, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return KnownDefaultBaseURL, nil
	}
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return "", fmt.Errorf("MaruMori base URL must be an http(s) URL, got %q", raw)
	}
	return strings.TrimRight(u.String(), "/"), nil
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

// homePayload carries the /home scalar counters. The live API nests them under
// "data"; the community reference and our original fixtures show them at the top
// level. Both shapes decode; when a "data" wrapper is present it wins wholesale, so
// a wrapper with missing counters is not backfilled from the top level. Everything
// else in the payload (level distributions, timeline, the of-the-day objects) is not
// declared, so it is dropped at decode time (ADR-0002).
type homePayload struct {
	Counts *struct {
		Total          int `json:"total"`
		Lessons        int `json:"lessons"`
		Reviews        int `json:"reviews"`
		GrammarTotal   int `json:"grammarTotal"`
		GrammarLessons int `json:"grammarLessons"`
		GrammarReviews int `json:"grammarReviews"`
	} `json:"counts"`
	Stats *struct {
		KanjiLearned           int `json:"kanjiLearned"`
		VocabularyLearned      int `json:"vocabularyLearned"`
		TotalGrammarLessonsDot int `json:"totalGrammarLessonsDone"`
	} `json:"stats"`
	Accuracy        *float64 `json:"accuracy"`
	GrammarAccurary *float64 `json:"grammarAccurary"` // the reference docs' spelling
	GrammarAccuracy *float64 `json:"grammarAccuracy"` // the live API's current spelling
}

// Home reads /home.
func (c *Client) Home(ctx context.Context) (Home, error) {
	var body struct {
		successFlag
		homePayload              // embedded: the documented top-level shape
		Data        *homePayload `json:"data"` // the live shape nests under "data"
	}
	if err := c.getJSON(ctx, "/home", &body); err != nil {
		return Home{}, err
	}
	p := body.homePayload
	if body.Data != nil {
		p = *body.Data
	}
	h := Home{}
	if p.Counts != nil {
		h.TotalLearned = p.Counts.Total
		h.TotalGrammarLearned = p.Counts.GrammarTotal
		h.PendingLessons = p.Counts.Lessons
		h.PendingReviews = p.Counts.Reviews
		h.PendingGrammarLessons = p.Counts.GrammarLessons
		h.PendingGrammarReviews = p.Counts.GrammarReviews
	}
	if p.Stats != nil {
		h.KanjiLearned = p.Stats.KanjiLearned
		h.VocabularyLearned = p.Stats.VocabularyLearned
		h.TotalGrammarDone = p.Stats.TotalGrammarLessonsDot
	}
	if p.Accuracy != nil {
		h.Accuracy = *p.Accuracy
	}
	switch {
	case p.GrammarAccuracy != nil:
		h.GrammarAccuracy = *p.GrammarAccuracy
	case p.GrammarAccurary != nil:
		h.GrammarAccuracy = *p.GrammarAccurary
	}
	return h, nil
}

// KnownKanji reads /known/kanji.
func (c *Client) KnownKanji(ctx context.Context) ([]KnownItem, error) {
	return c.known(ctx, "/known/kanji")
}

// KnownVocabulary reads /known/vocabulary.
func (c *Client) KnownVocabulary(ctx context.Context) ([]KnownItem, error) {
	return c.known(ctx, "/known/vocabulary")
}

// knownItem decodes the documented shape ("item" is the plain text) and, defensively,
// an embedded Kanji/VocabularyForm object: the text is taken from the item's written
// form, and every other field (definitions, kana lists, personal data…) is dropped.
type knownEntry struct {
	ID    string          `json:"_id"`
	Item  json.RawMessage `json:"item"`
	Level *int            `json:"level"`
}

func (e knownEntry) text() (string, bool) {
	var s string
	if json.Unmarshal(e.Item, &s) == nil {
		return s, s != ""
	}
	var obj struct {
		CurrentForm *struct {
			Form string `json:"form"`
		} `json:"currentForm"`
		AllForms []struct {
			Main bool   `json:"main"`
			Text string `json:"text"`
		} `json:"allForms"`
		Literal string `json:"literal"`
	}
	if json.Unmarshal(e.Item, &obj) != nil {
		return "", false
	}
	if obj.Literal != "" {
		return obj.Literal, true
	}
	if obj.CurrentForm != nil && obj.CurrentForm.Form != "" {
		return obj.CurrentForm.Form, true
	}
	for _, f := range obj.AllForms {
		if f.Main && f.Text != "" {
			return f.Text, true
		}
	}
	return "", false
}

func (c *Client) known(ctx context.Context, path string) ([]KnownItem, error) {
	var body struct {
		successFlag
		Items []knownEntry `json:"items"`
	}
	if err := c.getJSON(ctx, path, &body); err != nil {
		return nil, err
	}
	out := make([]KnownItem, 0, len(body.Items))
	for _, e := range body.Items {
		if e.ID == "" || e.Level == nil {
			return nil, &Error{Kind: ErrBadResponse, Detail: "a known item was missing its id or level"}
		}
		text, ok := e.text()
		if !ok {
			return nil, &Error{Kind: ErrBadResponse, Detail: "a known item had no readable text"}
		}
		out = append(out, KnownItem{MaruMoriID: e.ID, Text: text, Level: *e.Level})
	}
	return out, nil
}

// GrammarLessons reads /srs/grammar-lessons (pending points; no progress upstream).
func (c *Client) GrammarLessons(ctx context.Context) ([]GrammarObservation, error) {
	var body struct {
		successFlag
		Lessons []struct {
			ID       string `json:"_id"`
			Key      string `json:"_key"`
			Progress *struct {
				Level     *int  `json:"level"`
				Suspended *bool `json:"suspended"`
			} `json:"progress"`
		} `json:"lessons"`
	}
	if err := c.getJSON(ctx, "/srs/grammar-lessons", &body); err != nil {
		return nil, err
	}
	out := make([]GrammarObservation, 0, len(body.Lessons))
	for _, l := range body.Lessons {
		o, err := grammarObservation(l.ID, l.Key, l.Progress)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, nil
}

// GrammarReviews reads /srs/grammar-reviews (points in review, with progress).
func (c *Client) GrammarReviews(ctx context.Context) ([]GrammarObservation, error) {
	var body struct {
		successFlag
		Reviews []struct {
			ID       string `json:"_id"`
			Key      string `json:"_key"`
			Progress *struct {
				Level     *int  `json:"level"`
				Suspended *bool `json:"suspended"`
			} `json:"progress"`
		} `json:"reviews"`
	}
	if err := c.getJSON(ctx, "/srs/grammar-reviews", &body); err != nil {
		return nil, err
	}
	out := make([]GrammarObservation, 0, len(body.Reviews))
	for _, r := range body.Reviews {
		o, err := grammarObservation(r.ID, r.Key, r.Progress)
		if err != nil {
			return nil, err
		}
		out = append(out, o)
	}
	return out, nil
}

func grammarObservation(id, key string, progress *struct {
	Level     *int  `json:"level"`
	Suspended *bool `json:"suspended"`
}) (GrammarObservation, error) {
	if id == "" {
		id = key
	}
	if id == "" {
		return GrammarObservation{}, &Error{Kind: ErrBadResponse, Detail: "a grammar point had no id"}
	}
	o := GrammarObservation{MaruMoriID: id}
	if progress != nil {
		o.Level, o.Suspended = progress.Level, progress.Suspended
	}
	return o, nil
}

// getJSON sends one GET with retries, decoding 2xx JSON into out. Retries cover
// 429/5xx/timeouts/network failures (exponential backoff with jitter, or the server's
// Retry-After); 401/403 and other 4xx answers are returned at once. out receives only
// the fields the package declares, so upstream content never survives decoding.
func (c *Client) getJSON(ctx context.Context, path string, out any) error {
	var lastErr error
	for attempt := 1; attempt <= c.maxAttempts; attempt++ {
		err := c.attempt(ctx, path, out)
		if err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err() // the caller gave up; not a MaruMori failure
		}
		lastErr = err
		var le *Error
		if !errors.As(err, &le) || !le.retryable() || attempt == c.maxAttempts {
			return err
		}
		wait := le.RetryAfter
		if wait > maxRetryAfter {
			return err
		}
		if wait <= 0 {
			ceiling := c.backoffBase << min(attempt-1, 30)
			if ceiling <= 0 || ceiling > c.backoffMax {
				ceiling = c.backoffMax
			}
			wait = time.Duration(c.rand() * float64(ceiling))
		}
		slog.Debug("marumori: retrying", "path", path, "attempt", attempt, "status", le.Status, "kind", le.Kind.Error(), "wait", wait)
		if err := c.sleep(ctx, wait); err != nil {
			return err
		}
	}
	return lastErr
}

func (c *Client) attempt(ctx context.Context, path string, out any) error {
	actx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(actx, http.MethodGet, c.base+path, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "virtual-japan-tutor")
	req.Header.Set("Authorization", "Bearer "+c.key)

	resp, err := c.http.Do(req)
	if err != nil {
		return c.transportError(ctx, actx, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, maxBodyBytes))
	if err != nil {
		return c.transportError(ctx, actx, err)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		return c.statusError(resp, raw)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return &Error{Kind: ErrBadResponse, Status: resp.StatusCode, Detail: "MaruMori did not return JSON"}
	}
	if o, ok := out.(successCheck); ok && !o.successOK() {
		msg, _ := upstreamMessage(raw)
		return &Error{Kind: ErrBadRequest, Status: resp.StatusCode, Detail: c.clean(msg)}
	}
	return nil
}

// successCheck is implemented by decode bodies that track MaruMori's "success" flag:
// MaruMori answers some failures with 200 and success:false.
type successCheck interface{ successOK() bool }

func (b *successFlag) successOK() bool { return b.Success == nil || *b.Success }

// successFlag is embedded by every decode body; it reads "success" as *bool so an
// absent flag counts as success.
type successFlag struct {
	Success *bool `json:"success"`
}

// transportError classifies a failure to complete the HTTP exchange. Only the
// underlying cause is reported (url.Error text would repeat the URL); the key is never
// in a URL.
func (c *Client) transportError(parent, attempt context.Context, err error) error {
	var ne net.Error
	if (errors.Is(attempt.Err(), context.DeadlineExceeded) && parent.Err() == nil) ||
		(errors.As(err, &ne) && ne.Timeout() && parent.Err() == nil) {
		return &Error{Kind: ErrTimeout, Detail: "MaruMori did not answer in time"}
	}
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	return &Error{Kind: ErrUnreachable, Detail: c.clean(err.Error())}
}

func (c *Client) statusError(resp *http.Response, raw []byte) error {
	msg, _ := upstreamMessage(raw)
	msg = c.clean(msg)
	e := &Error{Status: resp.StatusCode, Detail: msg}
	switch s := resp.StatusCode; {
	case s == http.StatusUnauthorized || s == http.StatusForbidden:
		e.Kind = ErrAuth
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

// upstreamMessage pulls a human-readable message from the common error body shapes:
// {"success":false,"error":"text"}, {"error":{"message"}}, {"message":"text"}.
func upstreamMessage(raw []byte) (msg, code string) {
	var b struct {
		Success *bool           `json:"success"`
		Error   json.RawMessage `json:"error"`
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
	return b.Message, ""
}

// clean makes an upstream-supplied string safe to show: the API key is removed (some
// APIs echo it back in auth errors), control characters dropped, length bounded.
func (c *Client) clean(s string) string {
	if c.key != "" {
		s = strings.ReplaceAll(s, c.key, "[redacted]")
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
