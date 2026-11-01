package marumori_test

import (
	"context"
	"net/http"
	"os"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
)

// TestHomeAcceptsBothPayloadShapes pins the drift fix: the community reference (and
// our first fixture) showed /home's counters at the top level, but the live API
// nests them under "data" and re-spells grammarAccurary as grammarAccuracy. Both
// shapes must decode to the same Home, with the data wrapper winning when present,
// or every Sync silently stores zeroed home stats.
func TestHomeAcceptsBothPayloadShapes(t *testing.T) {
	want := marumori.Home{
		TotalLearned: 1240, TotalGrammarLearned: 60,
		PendingLessons: 12, PendingReviews: 34, PendingGrammarLessons: 2, PendingGrammarReviews: 5,
		KanjiLearned: 512, VocabularyLearned: 728, TotalGrammarDone: 60,
		Accuracy: 87.5, GrammarAccuracy: 91.25,
	}
	for _, tc := range []struct {
		name string
		file string
	}{
		{"top level (reference docs)", "testdata/home.json"},
		{"data wrapper (live API)", "testdata/home_wrapped.json"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			srv := newServer(t, func(w http.ResponseWriter, r *http.Request) {
				raw, err := os.ReadFile(tc.file)
				if err != nil {
					t.Fatal(err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write(raw)
			})
			home, err := newClient(t, srv.URL).Home(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			if home != want {
				t.Errorf("home = %+v, want %+v", home, want)
			}
		})
	}
}
