package httpapi_test

// The Phrase field of the story view (issue #97): a sentence with no Phrase
// must reach the API as an empty list, never null, so the web and mobile
// readers can read sentence.phrases without a check. Runs over the in-memory
// story store, so it needs no database.

import (
	"encoding/json"
	"testing"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
)

func TestStoryViewSentenceWithNoPhraseCarriesEmptyPhrasesList(t *testing.T) {
	o := newLibraryEnv(t)
	storyID := o.seedStory(t, o.aliceID, &story.Story{
		Genre:     "phrases",
		Title:     "は",
		Origin:    story.OriginAutomatic,
		Text:      "は。",
		Sentences: []story.Sentence{{Pos: 0, JA: "は。", EN: "topic."}},
		Questions: []story.Question{
			{Pos: 0, PromptJA: "q", OptionsJA: []string{"a", "b"}},
			{Pos: 1, PromptJA: "q", OptionsJA: []string{"a", "b"}},
			{Pos: 2, PromptJA: "q", OptionsJA: []string{"a", "b"}},
		},
	})

	rec := o.as(t, "alice", "GET", "/stories/"+storyID.String(), nil)
	if rec.Code != 200 {
		t.Fatalf("get: got %d body %s", rec.Code, rec.Body.String())
	}
	var got struct {
		Sentences []struct {
			Phrases json.RawMessage `json:"phrases"`
		} `json:"sentences"`
	}
	mustJSON(t, rec, &got)
	if len(got.Sentences) != 1 {
		t.Fatalf("sentences = %d, want 1", len(got.Sentences))
	}
	if raw := string(got.Sentences[0].Phrases); raw != "[]" {
		t.Fatalf("phrases = %s, want []", raw)
	}
}
