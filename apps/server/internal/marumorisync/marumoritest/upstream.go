package marumoritest

import (
	"context"
	"sync"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
)

// FakeUpstream is a canned marumorisync.Upstream. Set the data fields to what the next
// read should return; set Err to make every read fail (as if MaruMori itself failed).
// Call counts let tests assert exactly which endpoints a Sync used.
type FakeUpstream struct {
	mu    sync.Mutex
	Calls []string

	HomeState  marumori.Home
	Kanji      []marumori.KnownItem
	Vocabulary []marumori.KnownItem
	Lessons    []marumori.GrammarObservation
	Reviews    []marumori.GrammarObservation

	// Err, when set, fails every endpoint with it (typically a *marumori.Error).
	Err error
	// ErrOn, when set, additionally fails only the listed endpoint.
	ErrOn map[string]error
}

var _ marumorisync.Upstream = (*FakeUpstream)(nil)

func (f *FakeUpstream) call(path string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Calls = append(f.Calls, path)
	if f.ErrOn != nil {
		if err, ok := f.ErrOn[path]; ok {
			return err
		}
	}
	return f.Err
}

// Home records the call and returns the canned home.
func (f *FakeUpstream) Home(ctx context.Context) (marumori.Home, error) {
	if err := f.call("/home"); err != nil {
		return marumori.Home{}, err
	}
	return f.HomeState, nil
}

// KnownKanji records the call and returns the canned list.
func (f *FakeUpstream) KnownKanji(ctx context.Context) ([]marumori.KnownItem, error) {
	if err := f.call("/known/kanji"); err != nil {
		return nil, err
	}
	return f.Kanji, nil
}

// KnownVocabulary records the call and returns the canned list.
func (f *FakeUpstream) KnownVocabulary(ctx context.Context) ([]marumori.KnownItem, error) {
	if err := f.call("/known/vocabulary"); err != nil {
		return nil, err
	}
	return f.Vocabulary, nil
}

// GrammarLessons records the call and returns the canned list.
func (f *FakeUpstream) GrammarLessons(ctx context.Context) ([]marumori.GrammarObservation, error) {
	if err := f.call("/srs/grammar-lessons"); err != nil {
		return nil, err
	}
	return f.Lessons, nil
}

// GrammarReviews records the call and returns the canned list.
func (f *FakeUpstream) GrammarReviews(ctx context.Context) ([]marumori.GrammarObservation, error) {
	if err := f.call("/srs/grammar-reviews"); err != nil {
		return nil, err
	}
	return f.Reviews, nil
}

// CallsOf counts how often one endpoint was read.
func (f *FakeUpstream) CallsOf(path string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.Calls {
		if c == path {
			n++
		}
	}
	return n
}
