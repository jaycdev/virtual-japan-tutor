package httpapi_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story/storytest"
)

// Reader-side HTTP tests (issue #11): the Reading Panel's preferences
// (/reading-settings) and the grammar-point enrichment the story view now
// carries for Grammar Span hovers. The story service runs over
// storytest.MemStore — no database, no AI provider.

type readerEnv struct {
	e       env
	store   *storytest.MemStore
	aliceID uuid.UUID
	storyID uuid.UUID
}

func newReaderEnv(t *testing.T) *readerEnv {
	t.Helper()
	clock := authtest.NewFakeClock()
	authSvc := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour, Now: clock.Now})
	alice, err := authSvc.CreateUser(context.Background(), "alice", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authSvc.CreateUser(context.Background(), "bob", password); err != nil {
		t.Fatal(err)
	}

	store := storytest.New()
	svc := story.NewService(store, nil, nil, nil, nil, story.Settings{}, nil)

	o := &readerEnv{
		e:       env{h: httpapi.New(fakeDB{}, authSvc, httpapi.WithStory(svc)), svc: authSvc, clock: clock},
		store:   store,
		aliceID: alice.ID,
	}
	o.storyID = o.saveStory(alice.ID)
	return o
}

// saveStory seeds one validated Story with the shapes the reader consumes: a
// linked token, an unlinked particle, and a Grammar Span carrying its
// read-time enrichment (the Postgres store joins these in from grammar_points).
func (o *readerEnv) saveStory(userID uuid.UUID) uuid.UUID {
	entSeq := int64(1162857)
	srs := 2
	st := &story.Story{
		UserID:    userID,
		Genre:     "slice of life",
		Text:      "学校へ行きました。",
		Validated: true,
		Attempts:  1,
		Sentences: []story.Sentence{{
			Pos: 0,
			JA:  "学校へ行きました。",
			EN:  "I went to school.",
			Tokens: []story.Token{
				{Pos: 0, Surface: "学校", Start: 0, End: 2, Reading: "がっこう", Dictionary: "学校", EntSeq: &entSeq, Tag: story.TagUnknown, SRSLevel: &srs},
				{Pos: 1, Surface: "へ", Start: 2, End: 3, Reading: "へ", Dictionary: "へ", Tag: story.TagUnknown},
				{Pos: 2, Surface: "行きました", Start: 3, End: 8, Reading: "いきました", Dictionary: "行く", Tag: story.TagUnknown},
				{Pos: 3, Surface: "。", Start: 8, End: 9, Reading: "", Tag: story.TagUnknown},
			},
			Spans: []story.Span{{
				Start: 5, End: 8, GrammarPointID: 7, IsFocus: true,
				Pattern: "～ました", Meaning: "past tense (polite)", JLPTLevel: "N5",
			}},
		}},
		Questions: []story.Question{{
			Pos: 0, PromptJA: "どこへ行きましたか。",
			OptionsJA: []string{"学校", "公園"}, AnswerIndex: 0,
		}},
		VocabItems: []story.VocabItem{{EntSeq: 1162857, JA: "学校", EN: "school", IsFocus: true}},
	}
	if err := o.store.Save(context.Background(), st); err != nil {
		panic(err)
	}
	return st.ID
}

// --- /reading-settings ---

func TestReadingSettingsRequiresASession(t *testing.T) {
	o := newReaderEnv(t)
	wantError(t, o.e.do(t, "GET", "/reading-settings", "", nil), http.StatusUnauthorized, "unauthorized")
	wantError(t, o.e.do(t, "PUT", "/reading-settings", "", map[string]bool{"blurTranslation": false}), http.StatusUnauthorized, "unauthorized")
}

func TestReadingSettingsDefaultToBlurred(t *testing.T) {
	o := newReaderEnv(t)
	rec := o.e.do(t, "GET", "/reading-settings", "Bearer "+o.e.login(t, "alice"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body)
	}
	var body api.ReadingSettings
	mustJSON(t, rec, &body)
	if !body.BlurTranslation {
		t.Errorf("blurTranslation = false, want the default true")
	}
}

func TestReadingSettingsPutRoundTripAndScoping(t *testing.T) {
	o := newReaderEnv(t)
	alice := "Bearer " + o.e.login(t, "alice")

	rec := o.e.do(t, "PUT", "/reading-settings", alice, map[string]bool{"blurTranslation": false})
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT status = %d (%s)", rec.Code, rec.Body)
	}
	var put api.ReadingSettings
	mustJSON(t, rec, &put)
	if put.BlurTranslation {
		t.Errorf("PUT returned blurTranslation = true, want the false that was sent")
	}

	rec = o.e.do(t, "GET", "/reading-settings", alice, nil)
	var got api.ReadingSettings
	mustJSON(t, rec, &got)
	if got.BlurTranslation {
		t.Errorf("GET after PUT = true, want the saved false across requests")
	}

	// Preference is per user: bob still has the default.
	rec = o.e.do(t, "GET", "/reading-settings", "Bearer "+o.e.login(t, "bob"), nil)
	mustJSON(t, rec, &got)
	if !got.BlurTranslation {
		t.Errorf("bob's blurTranslation = false, want his own default true")
	}
}

// ReadingSettings carries a single required boolean, exactly like
// PutStorySettings' threshold: a malformed body is answered by the shared
// decode guard (400 bad_request for invalid JSON), and there is no partial
// body the handler could misread.

func TestReadingSettingsNotConfiguredIsAServiceError(t *testing.T) {
	// The pre-issue-#11 wiring (no WithStory) answers 500, like the other
	// optional services.
	e := newEnv(t, fakeDB{})
	rec := e.do(t, "GET", "/reading-settings", "Bearer "+e.login(t, "alice"), nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (%s)", rec.Code, rec.Body)
	}
}

// --- story view grammar enrichment (Grammar Span hover) ---

func TestGetStoryCarriesGrammarSpanEnrichmentAndTokenLinks(t *testing.T) {
	o := newReaderEnv(t)
	rec := o.e.do(t, "GET", "/stories/"+o.storyID.String(), "Bearer "+o.e.login(t, "alice"), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d (%s)", rec.Code, rec.Body)
	}
	var body api.Story
	mustJSON(t, rec, &body)

	if len(body.Sentences) != 1 || len(body.Sentences[0].GrammarSpans) != 1 {
		t.Fatalf("sentences = %+v, want one sentence with one grammar span", body.Sentences)
	}
	span := body.Sentences[0].GrammarSpans[0]
	if span.Pattern != "～ました" {
		t.Errorf("span pattern = %q, want the joined grammar_points pattern", span.Pattern)
	}
	if span.Meaning != "past tense (polite)" {
		t.Errorf("span meaning = %q, want the joined meaning", span.Meaning)
	}
	if span.JlptLevel != api.GrammarJLPTLevelN5 {
		t.Errorf("span jlptLevel = %q, want N5", span.JlptLevel)
	}
	if !span.IsFocus || span.GrammarPointId != "7" || span.Start != 5 || span.End != 8 {
		t.Errorf("span = %+v, want focus point 7 at runes [5,8)", span)
	}

	tokens := body.Sentences[0].Tokens
	if len(tokens) != 4 {
		t.Fatalf("tokens = %d, want 4", len(tokens))
	}
	if tokens[0].EntSeq == nil || *tokens[0].EntSeq != 1162857 {
		t.Errorf("学校 entSeq = %v, want the dictionary link for the Lookup row", tokens[0].EntSeq)
	}
	if tokens[0].Reading == nil || *tokens[0].Reading != "がっこう" || !tokens[0].ShowFurigana {
		t.Errorf("学校 token = %+v, want kana reading shown (unknown tag)", tokens[0])
	}
	if tokens[1].EntSeq != nil {
		t.Errorf("へ entSeq = %v, want unlinked: the Dictionary action must be disabled", tokens[1].EntSeq)
	}
}

func TestGetStoryForeignAndMalformedIDsStayNotFound(t *testing.T) {
	o := newReaderEnv(t)
	bob := "Bearer " + o.e.login(t, "bob")
	wantError(t, o.e.do(t, "GET", "/stories/"+o.storyID.String(), bob, nil), http.StatusNotFound, "not_found")
	wantError(t, o.e.do(t, "GET", "/stories/not-a-uuid", "Bearer "+o.e.login(t, "alice"), nil), http.StatusNotFound, "not_found")
}
