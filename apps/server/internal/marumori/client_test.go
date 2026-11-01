package marumori_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
)

const apiKey = "QZXPFX-middle-secret-SFXQZX"

// fixtureServer serves the testdata fixtures under the real MaruMori paths.
func fixtureServer(t *testing.T) *httptest.Server {
	t.Helper()
	return newServer(t, fixtureHandler())
}

func fixtureHandler() http.HandlerFunc {
	files := map[string]string{
		"/home":                "testdata/home.json",
		"/known/kanji":         "testdata/known_kanji.json",
		"/known/vocabulary":    "testdata/known_vocabulary.json",
		"/srs/grammar-lessons": "testdata/srs_grammar_lessons.json",
		"/srs/grammar-reviews": "testdata/srs_grammar_reviews.json",
	}
	return func(w http.ResponseWriter, r *http.Request) {
		raw, err := os.ReadFile(files[r.URL.Path])
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(raw)
	}
}

// recording wraps a handler and counts requests (and their Authorization headers).
type recording struct {
	mu    sync.Mutex
	paths []string
	auths []string
}

func (rec *recording) note(r *http.Request) {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	rec.paths = append(rec.paths, r.URL.Path)
	rec.auths = append(rec.auths, r.Header.Get("Authorization"))
}

func (rec *recording) count() int {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	return len(rec.paths)
}

func (rec *recording) lastAuth() string {
	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.auths) == 0 {
		return ""
	}
	return rec.auths[len(rec.auths)-1]
}

func newServer(t *testing.T, h func(http.ResponseWriter, *http.Request)) *httptest.Server {
	rec := &recording{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.note(r)
		h(w, r)
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newClient(t *testing.T, base string, opts ...marumori.Option) *marumori.Client {
	t.Helper()
	c, err := marumori.New(base, apiKey, opts...)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// noSleep skips retry waits and records them instead.
func recordSleep(got *[]time.Duration) marumori.Option {
	return marumori.WithSleep(func(_ context.Context, d time.Duration) error {
		*got = append(*got, d)
		return nil
	})
}

func assertNoKey(t *testing.T, where string, s string) {
	t.Helper()
	for _, frag := range []string{apiKey, "QZXPFX", "SFXQZX", "middle-secret"} {
		if strings.Contains(s, frag) {
			t.Errorf("%s leaks (part of) the API key %q: %s", where, frag, s)
		}
	}
}

func marshal(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func TestKnownKanjiDecodesIdentityAndLevelOnly(t *testing.T) {
	srv := fixtureServer(t)
	items, err := newClient(t, srv.URL).KnownKanji(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 4 {
		t.Fatalf("items = %d, want 4 (level 0 included: filtering is Sync's job)", len(items))
	}
	want := []marumori.KnownItem{
		{MaruMoriID: "Kanji/3964299", Text: "肌", Level: 1},
		{MaruMoriID: "Kanji/3959262", Text: "橋", Level: 2},
		{MaruMoriID: "Kanji/3961242", Text: "集", Level: 2},
		{MaruMoriID: "Kanji/3965583", Text: "目", Level: 0},
	}
	for i := range want {
		if items[i] != want[i] {
			t.Errorf("items[%d] = %+v, want %+v", i, items[i], want[i])
		}
	}
}

func TestKnownVocabularyDropsEmbeddedItemContent(t *testing.T) {
	srv := fixtureServer(t)
	items, err := newClient(t, srv.URL).KnownVocabulary(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 7 {
		t.Fatalf("items = %d, want 7", len(items))
	}
	// The fixture's sixth entry carries a full VocabularyForm object; only its written
	// form survives.
	if items[5] != (marumori.KnownItem{MaruMoriID: "VocabularyForms/31400002", Text: "先ず", Level: 2}) {
		t.Errorf("object-form item = %+v", items[5])
	}
	all := marshal(t, items)
	for _, forbidden := range []string{"first (of all)", "My private MaruMori note", "anyways", "allDefinitions", "personalData"} {
		if strings.Contains(all, forbidden) {
			t.Errorf("decoded vocabulary carries upstream content %q: %s", forbidden, all)
		}
	}
}

func TestHomeKeepsCountersAndDropsContent(t *testing.T) {
	srv := fixtureServer(t)
	home, err := newClient(t, srv.URL).Home(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	want := marumori.Home{
		TotalLearned: 1240, TotalGrammarLearned: 60,
		PendingLessons: 12, PendingReviews: 34, PendingGrammarLessons: 2, PendingGrammarReviews: 5,
		KanjiLearned: 512, VocabularyLearned: 728, TotalGrammarDone: 60,
		Accuracy: 87.5, GrammarAccuracy: 91.25,
	}
	if home != want {
		t.Fatalf("home = %+v, want %+v", home, want)
	}
	all := marshal(t, home)
	for _, forbidden := range []string{"interest", "curiosity", "skin", "moon", "gloss", "example", "ofTheDay", "timeline", "streak"} {
		if strings.Contains(strings.ToLower(all), strings.ToLower(forbidden)) {
			t.Errorf("decoded home carries upstream content %q: %s", forbidden, all)
		}
	}
}

func TestGrammarObservationsKeepProgressNotContent(t *testing.T) {
	srv := fixtureServer(t)
	c := newClient(t, srv.URL)

	lessons, err := c.GrammarLessons(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(lessons) != 1 || lessons[0].MaruMoriID != "Grammar/101" || lessons[0].Level != nil {
		t.Fatalf("lessons = %+v, want one lesson-only point without progress", lessons)
	}

	reviews, err := c.GrammarReviews(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(reviews) != 2 || reviews[0].MaruMoriID != "Grammar/202" || *reviews[0].Level != 3 || *reviews[0].Suspended {
		t.Fatalf("reviews[0] = %+v", reviews[0])
	}
	if reviews[1].MaruMoriID != "Grammar/203" || *reviews[1].Level != 5 || !*reviews[1].Suspended {
		t.Fatalf("reviews[1] = %+v", reviews[1])
	}

	all := marshal(t, append(lessons, reviews...))
	for _, forbidden := range []string{"つもり", "てしまう", "intention", "passive", "旅行", "layout"} {
		if strings.Contains(all, forbidden) {
			t.Errorf("decoded grammar observations carry upstream content %q: %s", forbidden, all)
		}
	}
}

func TestClientSendsBearerAuthToEveryEndpoint(t *testing.T) {
	rec := &recording{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.note(r)
		fixtureHandler()(w, r)
	}))
	t.Cleanup(srv.Close)
	c := newClient(t, srv.URL)
	ctx := context.Background()
	if _, err := c.KnownKanji(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := c.KnownVocabulary(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := c.Home(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GrammarLessons(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GrammarReviews(ctx); err != nil {
		t.Fatal(err)
	}
	if rec.count() != 5 {
		t.Fatalf("served %d requests, want 5 endpoints", rec.count())
	}
	if got := rec.lastAuth(); got != "Bearer "+apiKey {
		t.Errorf("Authorization header = %q, want Bearer key", got)
	}
}

func TestRejectedKeyFailsOnceWithoutRetry(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		// MaruMori echoes the key in the error body: clean() must strip it.
		_, _ = w.Write([]byte(`{"success":false,"error":"invalid api key: ` + apiKey + `"}`))
	})
	var sleeps []time.Duration
	c := newClient(t, srv.URL, recordSleep(&sleeps))

	_, err := c.KnownKanji(context.Background())
	if !errors.Is(err, marumori.ErrAuth) {
		t.Fatalf("err = %v, want ErrAuth", err)
	}
	if len(sleeps) != 0 {
		t.Errorf("retried an auth failure: %v sleeps", sleeps)
	}
	assertNoKey(t, "error", err.Error())
	if !strings.Contains(err.Error(), "[redacted]") {
		t.Errorf("error did not redact the echoed key: %v", err)
	}
}

func TestServerErrorsRetryWithBackoffThenSucceed(t *testing.T) {
	var calls int
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls < 3 {
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":{"message":"upstream bleckout"}}`))
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"items":[]}`))
	})
	var sleeps []time.Duration
	c := newClient(t, srv.URL, recordSleep(&sleeps), marumori.WithRand(func() float64 { return 0.5 }))

	items, err := c.KnownKanji(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 0 || calls != 3 {
		t.Fatalf("items = %d calls = %d, want success on the 3rd attempt", len(items), calls)
	}
	// Jittered exponential backoff: 0.5*500ms then 0.5*1000ms.
	if len(sleeps) != 2 || sleeps[0] != 250*time.Millisecond || sleeps[1] != 500*time.Millisecond {
		t.Errorf("sleeps = %v, want [250ms 500ms]", sleeps)
	}
}

func TestRateLimitHonoursRetryAfter(t *testing.T) {
	var calls int
	srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
		calls++
		if calls == 1 {
			w.Header().Set("Retry-After", "2")
			w.WriteHeader(http.StatusTooManyRequests)
			return
		}
		_, _ = w.Write([]byte(`{"success":true,"items":[]}`))
	})
	var sleeps []time.Duration
	c := newClient(t, srv.URL, recordSleep(&sleeps))

	if _, err := c.KnownKanji(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(sleeps) != 1 || sleeps[0] != 2*time.Second {
		t.Errorf("sleeps = %v, want exactly the 2s Retry-After", sleeps)
	}
}

func TestLongRetryAfterFailsFast(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Retry-After", "600")
		w.WriteHeader(http.StatusTooManyRequests)
	})
	var sleeps []time.Duration
	_, err := newClient(t, srv.URL, recordSleep(&sleeps)).KnownKanji(context.Background())
	if !errors.Is(err, marumori.ErrRateLimited) || len(sleeps) != 0 {
		t.Fatalf("err = %v sleeps = %v, want a fast ErrRateLimited", err, sleeps)
	}
}

func TestSuccessFalseAt200IsAnError(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"success":false,"error":"account suspended"}`))
	})
	_, err := newClient(t, srv.URL).Home(context.Background())
	if !errors.Is(err, marumori.ErrBadRequest) {
		t.Fatalf("err = %v, want ErrBadRequest", err)
	}
	if !strings.Contains(err.Error(), "account suspended") {
		t.Errorf("error lost the upstream message: %v", err)
	}
}

func TestNonJSONAndMalformedItemsAreBadResponses(t *testing.T) {
	cases := []struct {
		name, body string
	}{
		{"not JSON", "<html>502 Bad Gateway</html>"},
		{"known item missing id", `{"success":true,"items":[{"item":"肌","level":1}]}`},
		{"known item missing level", `{"success":true,"items":[{"_id":"Kanji/1","item":"肌"}]}`},
		{"known item with unusable text", `{"success":true,"items":[{"_id":"Kanji/1","item":{"foo":1},"level":1}]}`},
		{"grammar point with no id", `{"success":true,"lessons":[{"grammar":"x"}]}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
				_, _ = w.Write([]byte(tc.body))
			})
			c := newClient(t, srv.URL)
			var err error
			if strings.Contains(tc.body, "lessons") {
				_, err = c.GrammarLessons(context.Background())
			} else if strings.Contains(tc.body, "items") {
				_, err = c.KnownKanji(context.Background())
			} else {
				_, err = c.Home(context.Background())
			}
			if !errors.Is(err, marumori.ErrBadResponse) {
				t.Fatalf("err = %v, want ErrBadResponse", err)
			}
		})
	}
}

func TestTimeoutAndUnreachableAreClassified(t *testing.T) {
	slow := newServer(t, func(w http.ResponseWriter, _ *http.Request) {
		time.Sleep(200 * time.Millisecond)
		_, _ = w.Write([]byte(`{"success":true,"items":[]}`))
	})
	_, err := newClient(t, slow.URL, marumori.WithTimeout(50*time.Millisecond), marumori.WithMaxAttempts(1)).
		KnownKanji(context.Background())
	if !errors.Is(err, marumori.ErrTimeout) {
		t.Errorf("slow endpoint: err = %v, want ErrTimeout", err)
	}

	dead := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	deadURL := dead.URL
	dead.Close()
	if _, err := newClient(t, deadURL, marumori.WithMaxAttempts(1)).Home(context.Background()); !errors.Is(err, marumori.ErrUnreachable) {
		t.Errorf("dead endpoint: err = %v, want ErrUnreachable", err)
	}
}

func TestContextCancellationIsNotAMaruMoriFailure(t *testing.T) {
	srv := newServer(t, func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := newClient(t, srv.URL).KnownKanji(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
}

func TestBaseURLNormalisation(t *testing.T) {
	got, err := marumori.NormalizeBaseURL("")
	if err != nil || got != marumori.KnownDefaultBaseURL {
		t.Errorf("empty base = %q, %v, want the default API", got, err)
	}
	got, err = marumori.NormalizeBaseURL("https://api.example.test/marumori/")
	if err != nil || got != "https://api.example.test/marumori" {
		t.Errorf("normalise = %q, %v", got, err)
	}
	if _, err := marumori.NormalizeBaseURL("ftp://nope"); err == nil {
		t.Error("ftp base accepted")
	}
	if _, err := marumori.New("https://api.example.test", " "); err == nil {
		t.Error("empty API key accepted")
	}
}
