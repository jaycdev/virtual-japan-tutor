package story

import (
	"slices"
	"testing"
)

// simulateAutomaticGenres replays the Automatic genre decision of
// ensureAutomaticStory for `days` consecutive Stories. The model is told to
// surprise the reader only when no genre was picked, and it honours the
// avoid list the way the prompt asks: it names its favourite unless that is
// on the list, then the first preset genre that is not. Recent genres are
// newest-first and capped at 5, as GenresByLastActivity(ctx, u, 5) returns.
func simulateAutomaticGenres(days int, pref string, ratings map[string]map[Rating]int, favourite string) []string {
	var history []string // oldest first
	for range days {
		recent := make([]string, 0, 5)
		for i := len(history) - 1; i >= 0 && len(recent) < 5; i-- {
			recent = append(recent, history[i])
		}
		genre := automaticGenre(pref, ratings, latestGenre(recent), 0.95)
		if genre == "" {
			genre = modelSurprise(favourite, recent)
		}
		history = append(history, genre)
	}
	return history
}

func modelSurprise(favourite string, avoid []string) string {
	if !slices.Contains(avoid, favourite) {
		return favourite
	}
	for _, g := range presetGenres {
		if !slices.Contains(avoid, g) {
			return g
		}
	}
	return favourite
}

func distinctGenres(xs []string) int {
	var seen []string
	for _, x := range xs {
		if !slices.Contains(seen, x) {
			seen = append(seen, x)
		}
	}
	return len(seen)
}

// The Learner's symptom: every Automatic Story came out as "comedy". The
// fixed code must never give the same genre on two days in a row, and must
// keep using several genres over a month.
func TestAutomaticGenresDoNotRepeatOnConsecutiveDays(t *testing.T) {
	cases := []struct {
		name        string
		ratings     map[string]map[Rating]int
		minDistinct int
	}{
		{"no ratings", nil, 3},
		{"one upvote on comedy", map[string]map[Rating]int{"comedy": {RatingUp: 1}}, 3},
		// Two upvoted genres alternate: the Learner's own choice, so only two
		// genres are expected here.
		{"two upvoted genres", map[string]map[Rating]int{"comedy": {RatingUp: 2}, "travel": {RatingUp: 1}}, 2},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := simulateAutomaticGenres(30, "", tc.ratings, "comedy")
			for i := 1; i < len(got); i++ {
				if got[i] == got[i-1] {
					t.Fatalf("day %d and %d both %q: %v", i-1, i, got[i], got)
				}
			}
			if n := distinctGenres(got); n < tc.minDistinct {
				t.Fatalf("30 stories used %d distinct genre(s) %v, want at least %d", n, got, tc.minDistinct)
			}
		})
	}
}
