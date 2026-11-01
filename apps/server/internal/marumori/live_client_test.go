package marumori_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync/liveup"
)

// These tests talk to the real MaruMori public API with the learner's own key and are
// skipped unless MARUMORI_API_KEY is set (.mise.local.toml + `mise exec`, see the
// liveup package). They are the contract check the fixture tests cannot be: those
// fixtures were frozen from the same responses the decoder was written against, so
// only a live call catches MaruMori renaming a field, re-shaping a payload or
// re-tightening auth. Read-only per docs/adr/0002: these tests only GET.

func TestLiveHome(t *testing.T) {
	c := liveup.Client(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	home, err := c.Home(ctx)
	if err != nil {
		t.Fatalf("GET /home: %v", err)
	}
	c.HomeState = home
	liveup.CheckDrift(t, "GET /home", c)
}

func TestLiveKnownLists(t *testing.T) {
	c := liveup.Client(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()

	kanji, err := c.KnownKanji(ctx)
	if err != nil {
		t.Fatalf("GET /known/kanji: %v", err)
	}
	vocabulary, err := c.KnownVocabulary(ctx)
	if err != nil {
		t.Fatalf("GET /known/vocabulary: %v", err)
	}
	if len(kanji) == 0 && len(vocabulary) == 0 {
		t.Error("both known lists came back empty: unexpected for a real account, MaruMori or the decoder is off")
	}
	for _, set := range [][]marumori.KnownItem{kanji, vocabulary} {
		for _, it := range set {
			if it.MaruMoriID == "" || it.Text == "" {
				t.Fatalf("a known item decoded without id or text: %+v", it)
			}
			if it.Level < 0 {
				t.Fatalf("item %s decoded with SRS level %d: the decoder is misreading progress", it.MaruMoriID, it.Level)
			}
		}
	}
	t.Logf("live account: %d kanji, %d vocabulary items", len(kanji), len(vocabulary))
}

func TestLiveGrammarObservations(t *testing.T) {
	c := liveup.Client(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	lessons, err := c.GrammarLessons(ctx)
	if err != nil {
		t.Fatalf("GET /srs/grammar-lessons: %v", err)
	}
	reviews, err := c.GrammarReviews(ctx)
	if err != nil {
		t.Fatalf("GET /srs/grammar-reviews: %v", err)
	}
	for _, o := range append(append([]marumori.GrammarObservation{}, lessons...), reviews...) {
		if o.MaruMoriID == "" {
			t.Fatal("a grammar point decoded without an id")
		}
	}
	t.Logf("live account: %d grammar lessons, %d grammar reviews", len(lessons), len(reviews))
}

func TestLiveBadKeyIsRejected(t *testing.T) {
	c := liveup.BadKeyClient(t)
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	_, err := c.Home(ctx)
	if err == nil {
		t.Fatal("a made-up key was accepted by the real API")
	}
	if !errors.Is(err, marumori.ErrAuth) {
		t.Errorf("err = %v, want marumori.ErrAuth: auth semantics changed upstream", err)
	}
	// The key must not echo back through our error surfaces, whole or in part.
	liveup.NoLeak(t, "error text", liveup.BadKey, err.Error())
}
