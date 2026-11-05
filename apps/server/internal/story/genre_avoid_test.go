package story

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
)

// An Automatic Story with no genre picked must tell the model which genres
// the reader has just read, and must not name a genre of its own; a picked
// genre must not come with the avoid line.
func TestEnsureAutomaticStoryAvoidsRecentGenresWhenNoGenreIsPicked(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "surprise", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.roll = func() float64 { return 0.95 } // no Preferred Genre below, so the variety branch
	if err := store.Save(ctx, &Story{UserID: user, Genre: "food", Validated: true, Origin: OriginOnDemand, CreatedAt: time.Now().Add(-time.Hour)}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	prompt := provider.lastUserPrompt()
	if !strings.Contains(prompt, "Avoid these genres too, the reader has just read them: food.") {
		t.Fatalf("no genre picked: the prompt must avoid the recent genres:\n%s", prompt)
	}
	if strings.Contains(prompt, "- Genre/theme: food.") {
		t.Fatalf("the just-read genre must not be picked again:\n%s", prompt)
	}
}

func TestEnsureAutomaticStoryOmitsAvoidLineWhenAGenreIsPicked(t *testing.T) {
	ctx := context.Background()
	user := uuid.New()
	provider := newFakeProvider(t, string(fixture(t, "surprise", cleanClause, cleanClause, cleanClause, cleanClause)))
	svc, store, _, _ := newTestService(t, provider)
	svc.roll = func() float64 { return 0.95 }
	up := RatingUp
	if err := store.Save(ctx, &Story{UserID: user, Genre: "travel", Validated: true, Origin: OriginOnDemand, Rating: &up, CreatedAt: time.Now().Add(-48 * time.Hour)}); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := store.Save(ctx, &Story{UserID: user, Genre: "food", Validated: true, Origin: OriginOnDemand, CreatedAt: time.Now().Add(-time.Hour)}); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if err := svc.ensureAutomaticStory(ctx, user); err != nil {
		t.Fatalf("ensureAutomaticStory: %v", err)
	}
	prompt := provider.lastUserPrompt()
	if !strings.Contains(prompt, "- Genre/theme: travel.") {
		t.Fatalf("expected the upvoted genre to be picked:\n%s", prompt)
	}
	if strings.Contains(prompt, "Avoid these genres too") {
		t.Fatalf("a picked genre must not bring the avoid line:\n%s", prompt)
	}
}
