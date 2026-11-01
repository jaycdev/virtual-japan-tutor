// Package liveup wires the live MaruMori tests: the tests in this repo never talk to
// MaruMori unless MARUMORI_API_KEY is set (a key for one's own account lives in the
// git-ignored .mise.local.toml, so `mise exec` puts it in the environment). When it is
// set, the tests hit the real public API for that one account — read-only, per
// docs/adr/0002 — and this package hands them the client, the key, and the drift and
// leak checks those tests share. Like marumoritest, it is only ever imported from
// test files, so it stays out of the server binary. Live tests share one rate-limited
// account: run them serially, e.g. `go test -p 1 -run TestLive ./...`.
package liveup

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
)

// KeyEnv is the environment variable holding a personal MaruMori API key.
const KeyEnv = "MARUMORI_API_KEY"

// BadKey is a syntactically valid key MaruMori must reject, for the live 401 paths.
// BadKeyClient checks it cannot collide with the real key.
const BadKey = "marumori-live-test-not-a-real-key-000000"

// Key returns the live API key, skipping the calling test when none is set.
func Key(t *testing.T) string {
	t.Helper()
	key := strings.TrimSpace(os.Getenv(KeyEnv))
	if key == "" {
		t.Skipf("%s not set: add your MaruMori API key to .mise.local.toml and run under `mise exec`", KeyEnv)
	}
	// The same shape Service.SetAPIKey demands, checked before anything is sent.
	if len(key) > 4096 || strings.IndexFunc(key, func(r rune) bool {
		return r < 0x21 || r > 0x7e
	}) >= 0 {
		t.Fatalf("%s is not a printable ASCII key, refusing to send it anywhere", KeyEnv)
	}
	return key
}

// Client returns a real *marumori.Client for the live API, wrapped so tests can assert
// against exactly what it returned.
func Client(t *testing.T) *Recorder {
	t.Helper()
	c, err := marumori.New("", Key(t))
	if err != nil {
		t.Fatal(err)
	}
	return &Recorder{Upstream: c}
}

// Fragments returns bounded pieces of key, so both a full echo and a masked
// partial leak are caught. Pieces shorter than 4 runes are dropped as too noisy.
func Fragments(key string) []string {
	r := []rune(key)
	cut := len(r) / 3
	if cut < 1 {
		cut = 1
	}
	seen := map[string]bool{}
	var out []string
	for _, f := range []string{key, string(r[:cut]), string(r[len(r)-cut:])} {
		if len([]rune(f)) >= 4 && !seen[f] {
			seen[f] = true
			out = append(out, f)
		}
	}
	return out
}

// NoLeak fails if s contains any fragment of key: the ADR-0002 rule that the key never
// reaches a response body, a stored row or a run error. The failure names where and
// how much leaked, never what: printing the fragment would itself leak the key.
func NoLeak(t *testing.T, where, key, s string) {
	t.Helper()
	for _, frag := range Fragments(key) {
		if i := strings.Index(s, frag); i >= 0 {
			t.Errorf("%s leaks a %d-rune fragment of the live API key at offset %d", where, len([]rune(frag)), i)
		}
	}
}

// KnownFilter counts items the Service treats as Known: a non-empty id and text and an
// SRS level 1-9. Everything outside that is skipped or counted as level 0, never stored.
func KnownFilter(items []marumori.KnownItem) int {
	n := 0
	for _, it := range items {
		if it.MaruMoriID != "" && it.Text != "" && it.Level >= 1 && it.Level <= 9 {
			n++
		}
	}
	return n
}

// LevelZero counts the items the Service counts as skipped (learning, not Known).
func LevelZero(items []marumori.KnownItem) int {
	n := 0
	for _, it := range items {
		if it.MaruMoriID != "" && it.Text != "" && it.Level == 0 {
			n++
		}
	}
	return n
}

// UniqueIDs collects the distinct non-empty MaruMori ids of grammar observations, the
// set the observations table keys on across both grammar endpoints.
func UniqueIDs(observations ...[]marumori.GrammarObservation) map[string]bool {
	ids := map[string]bool{}
	for _, set := range observations {
		for _, o := range set {
			if o.MaruMoriID != "" {
				ids[o.MaruMoriID] = true
			}
		}
	}
	return ids
}

// CheckDrift fails when the live payloads are unrecognisably shaped: the guard against
// MaruMori changing under us that the fixture-backed tests cannot provide, since their
// fixtures were frozen from the same responses the client was written against. The
// cross-checks matter most: a field renamed upstream decodes as zero without any error,
// which is exactly how the "data" wrapper silently zeroed every home counter.
func CheckDrift(t *testing.T, label string, r *Recorder) {
	t.Helper()
	if r.HomeState.TotalLearned <= 0 {
		t.Errorf("/home counts.total = %d: want a positive number of learned items — flag if the account is simply empty", r.HomeState.TotalLearned)
	}
	if r.HomeState.KanjiLearned < 0 || r.HomeState.VocabularyLearned < 0 {
		t.Errorf("/home stats = %+v, want non-negative counters", r.HomeState)
	}
	if n := KnownFilter(r.Kanji); n > 0 && r.HomeState.KanjiLearned <= 0 {
		t.Errorf("/home stats.kanjiLearned = %d but /known/kanji holds %d Known items: a counter is decoding as zero", r.HomeState.KanjiLearned, n)
	}
	if n := KnownFilter(r.Vocabulary); n > 0 && r.HomeState.VocabularyLearned <= 0 {
		t.Errorf("/home stats.vocabularyLearned = %d but /known/vocabulary holds %d Known items: a counter is decoding as zero", r.HomeState.VocabularyLearned, n)
	}
	if r.HomeState.TotalGrammarLearned > 0 && r.HomeState.GrammarAccuracy <= 0 {
		t.Errorf("/home has %d grammar items but grammarAccuracy = %v: the accuracy field may have been renamed again", r.HomeState.TotalGrammarLearned, r.HomeState.GrammarAccuracy)
	}
	for _, set := range [][]marumori.KnownItem{r.Kanji, r.Vocabulary} {
		for _, it := range set {
			if it.MaruMoriID == "" {
				t.Errorf("%s: an item came back without an id", label)
				break
			}
			if it.Text == "" {
				t.Errorf("%s: item %s came back without readable text", label, it.MaruMoriID)
				break
			}
		}
	}
	for _, set := range [][]marumori.GrammarObservation{r.Lessons, r.Reviews} {
		for _, o := range set {
			if o.MaruMoriID == "" {
				t.Errorf("%s: a grammar point came back without an id", label)
				break
			}
		}
	}
}

// BadKeyClient returns a client for a syntactically valid key that MaruMori must
// reject, for the live 401 path. It skips when the environment key would already fit
// the wrong-key shape, so the wrong key can never be a real one.
func BadKeyClient(t *testing.T) *marumori.Client {
	t.Helper()
	for _, frag := range Fragments(Key(t)) {
		if strings.Contains(BadKey, frag) {
			t.Skipf("%s shares a fragment with the not-a-real-key probe string", KeyEnv)
		}
	}
	c, err := marumori.New("", BadKey)
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// Recorder wraps an Upstream and remembers exactly what each of the five endpoints
// returned, so a test can assert a run's counts against the upstream's own reading
// rather than a fixture. Sync calls the endpoints one at a time, so no locking.
// A failed endpoint records nothing: an earlier run's values survive, and no test
// asserts after a failed Sync.
type Recorder struct {
	marumorisync.Upstream

	HomeState  marumori.Home
	Kanji      []marumori.KnownItem
	Vocabulary []marumori.KnownItem
	Lessons    []marumori.GrammarObservation
	Reviews    []marumori.GrammarObservation
}

func (r *Recorder) Home(ctx context.Context) (marumori.Home, error) {
	home, err := r.Upstream.Home(ctx)
	if err == nil {
		r.HomeState = home
	}
	return home, err
}

func (r *Recorder) KnownKanji(ctx context.Context) ([]marumori.KnownItem, error) {
	items, err := r.Upstream.KnownKanji(ctx)
	if err == nil {
		r.Kanji = items
	}
	return items, err
}

func (r *Recorder) KnownVocabulary(ctx context.Context) ([]marumori.KnownItem, error) {
	items, err := r.Upstream.KnownVocabulary(ctx)
	if err == nil {
		r.Vocabulary = items
	}
	return items, err
}

func (r *Recorder) GrammarLessons(ctx context.Context) ([]marumori.GrammarObservation, error) {
	observations, err := r.Upstream.GrammarLessons(ctx)
	if err == nil {
		r.Lessons = observations
	}
	return observations, err
}

func (r *Recorder) GrammarReviews(ctx context.Context) ([]marumori.GrammarObservation, error) {
	observations, err := r.Upstream.GrammarReviews(ctx)
	if err == nil {
		r.Reviews = observations
	}
	return observations, err
}
