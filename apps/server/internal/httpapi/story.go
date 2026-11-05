package httpapi

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
)

// WithStory enables the /stories routes (issue #10: story generation behind
// the kagome validation gate, the Automatic Story background flow, the
// library, ratings, comprehension answers, and story settings).
func WithStory(svc *story.Service) Option { return func(s *server) { s.story = svc } }

func (s *server) storyService() (*story.Service, error) {
	if s.story == nil {
		return nil, errors.New("story service is not configured")
	}
	return s.story, nil
}

// story.Error carries an HTTP status; each handler maps it to its
// operation's declared responses. A non-*story.Error that is not the
// not-found sentinel is a genuine server fault: return it so the strict
// handler answers 500.
func asStoryError(err error) (*story.Error, bool) {
	var sErr *story.Error
	if errors.As(err, &sErr) {
		return sErr, true
	}
	return nil, false
}

// storyID parses the path param. Story ids are UUIDs but the spec declares
// the parameter a plain string (path params bind before auth runs), so a
// malformed id must read exactly like a foreign one: both are 404.
func storyID(raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func (s *server) ListStories(ctx context.Context, request api.ListStoriesRequestObject) (api.ListStoriesResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated // unreachable behind requireSession; fail closed
	}
	lim, off := 20, 0
	if request.Params.Limit != nil {
		lim = *request.Params.Limit
	}
	if request.Params.Offset != nil {
		off = *request.Params.Offset
	}
	items, total, err := svc.List(ctx, id.ID, lim, off)
	if err != nil {
		return nil, err
	}
	us, err := svc.GetSettings(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	views := make([]api.Story, 0, len(items))
	for _, st := range items {
		views = append(views, storyView(st, us.FuriganaThresholdSRSLevel))
	}
	// Echo the clamped paging back so the client pages consistently.
	cLim, cOff := lim, off
	if cLim <= 0 {
		cLim = 20
	}
	if cLim > 100 {
		cLim = 100
	}
	if cOff < 0 {
		cOff = 0
	}
	return api.ListStories200JSONResponse{Items: views, Total: total, Limit: cLim, Offset: cOff}, nil
}

// GetTodaysStory serves Today's Story — the newest Automatic Story — from
// storage only; the request never waits on an AI provider. Opening it changes
// nothing: the daily rule, not the opening, decides when the next Automatic
// Story is written.
func (s *server) GetTodaysStory(ctx context.Context, request api.GetTodaysStoryRequestObject) (api.GetTodaysStoryResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	st, err := svc.TodaysStory(ctx, id.ID)
	if err != nil {
		if errors.Is(err, story.ErrNoStory) {
			return api.GetTodaysStory404JSONResponse{Code: "no_story", Message: "No Automatic Story yet; the background generator writes one every day."}, nil
		}
		return nil, err
	}
	us, err := svc.GetSettings(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	return api.GetTodaysStory200JSONResponse(storyView(st, us.FuriganaThresholdSRSLevel)), nil
}

func (s *server) GetStory(ctx context.Context, request api.GetStoryRequestObject) (api.GetStoryResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	sid, ok := storyID(request.StoryId)
	if !ok {
		return api.GetStory404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
	}
	st, err := svc.Get(ctx, sid, id.ID)
	if err != nil {
		if errors.Is(err, story.ErrNotFound) {
			return api.GetStory404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
		}
		return nil, err
	}
	us, err := svc.GetSettings(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	return api.GetStory200JSONResponse(storyView(st, us.FuriganaThresholdSRSLevel)), nil
}

func (s *server) RateStory(ctx context.Context, request api.RateStoryRequestObject) (api.RateStoryResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	if request.Body == nil {
		return api.RateStory400JSONResponse{Code: "invalid_rating", Message: "A rating (\"up\" or \"down\") is required."}, nil
	}
	sid, ok := storyID(request.StoryId)
	if !ok {
		return api.RateStory404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
	}
	if err := svc.Rate(ctx, sid, id.ID, story.Rating(*request.Body)); err != nil {
		if sErr, is := asStoryError(err); is && sErr.Status == 400 {
			return api.RateStory400JSONResponse{Code: sErr.Code, Message: sErr.Message}, nil
		}
		if errors.Is(err, story.ErrNotFound) {
			return api.RateStory404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
		}
		return nil, err
	}
	return api.RateStory204Response{}, nil
}

// SetStoryRead marks a story Read by hand. Unlike answering, this is not
// practice: it must not touch the rating, the Practiced At stamp, or record
// a Weak Signal (GLOSSARY.md: "Read" is avoided as a synonym for "practised"
// precisely because they are different things).
func (s *server) SetStoryRead(ctx context.Context, request api.SetStoryReadRequestObject) (api.SetStoryReadResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	sid, ok := storyID(request.StoryId)
	if !ok {
		return api.SetStoryRead404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
	}
	if err := svc.MarkRead(ctx, sid, id.ID, time.Now().UTC()); err != nil {
		if errors.Is(err, story.ErrNotFound) {
			return api.SetStoryRead404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
		}
		return nil, err
	}
	return api.SetStoryRead204Response{}, nil
}

// ClearStoryRead unmarks a story so the Learner can take it up again.
func (s *server) ClearStoryRead(ctx context.Context, request api.ClearStoryReadRequestObject) (api.ClearStoryReadResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	sid, ok := storyID(request.StoryId)
	if !ok {
		return api.ClearStoryRead404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
	}
	if err := svc.ClearRead(ctx, sid, id.ID); err != nil {
		if errors.Is(err, story.ErrNotFound) {
			return api.ClearStoryRead404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
		}
		return nil, err
	}
	return api.ClearStoryRead204Response{}, nil
}

// DeleteStory removes a story from the Library. Its rating goes with it;
// the Practice Records it wrote stay (the mastery log is append-only).
func (s *server) DeleteStory(ctx context.Context, request api.DeleteStoryRequestObject) (api.DeleteStoryResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	sid, ok := storyID(request.StoryId)
	if !ok {
		return api.DeleteStory404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
	}
	if err := svc.Delete(ctx, sid, id.ID); err != nil {
		if errors.Is(err, story.ErrNotFound) {
			return api.DeleteStory404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
		}
		return nil, err
	}
	return api.DeleteStory204Response{}, nil
}

// AnswerStoryQuestion grades one comprehension question. The first answer
// for a story also appends the Practice Records for its Focus Set items —
// vocabulary and Grammar Points alike (see internal/story and the write-side
// note in apps/server/migrations/00008_practice_and_weak_signals.sql; the
// practice log itself comes with ADR 0004); the view never reveals answer
// indexes before the Learner answers.
func (s *server) AnswerStoryQuestion(ctx context.Context, request api.AnswerStoryQuestionRequestObject) (api.AnswerStoryQuestionResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	if request.Body == nil {
		return api.AnswerStoryQuestion400JSONResponse{Code: "bad_request", Message: "questionIndex and answerIndex are required"}, nil
	}
	sid, ok := storyID(request.StoryId)
	if !ok {
		return api.AnswerStoryQuestion404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
	}
	res, err := svc.Answer(ctx, sid, id.ID, request.Body.QuestionIndex, request.Body.AnswerIndex)
	if err != nil {
		if sErr, is := asStoryError(err); is && sErr.Status == 400 {
			return api.AnswerStoryQuestion400JSONResponse{Code: sErr.Code, Message: sErr.Message}, nil
		}
		if errors.Is(err, story.ErrNotFound) {
			return api.AnswerStoryQuestion404JSONResponse{NotFoundJSONResponse: notFound("no such story")}, nil
		}
		return nil, err
	}
	return api.AnswerStoryQuestion200JSONResponse{
		Correct:          res.Correct,
		PracticeRecorded: &res.PracticeRecorded,
	}, nil
}

func (s *server) GetStorySettings(ctx context.Context, request api.GetStorySettingsRequestObject) (api.GetStorySettingsResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	us, err := svc.GetSettings(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	// Echo the preferences always (empty string = "surprise me") so the
	// settings form round-trips without guessing what an absent field means.
	// An empty timezone means unset: the server's own timezone decides which
	// local day an Automatic Story belongs to until the Learner picks one.
	return api.GetStorySettings200JSONResponse{
		FuriganaThresholdSrsLevel: us.FuriganaThresholdSRSLevel,
		Timezone:                  &us.Timezone,
		PreferredGenre:            &us.PreferredGenre,
		PreferredTheme:            &us.PreferredTheme,
	}, nil
}

func (s *server) PutStorySettings(ctx context.Context, request api.PutStorySettingsRequestObject) (api.PutStorySettingsResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	if request.Body == nil {
		return api.PutStorySettings400JSONResponse{Code: "bad_request", Message: "furiganaThresholdSrsLevel is required"}, nil
	}
	in := story.UserSettings{FuriganaThresholdSRSLevel: request.Body.FuriganaThresholdSrsLevel}
	if request.Body.Timezone != nil {
		in.Timezone = *request.Body.Timezone
	}
	if request.Body.PreferredGenre != nil {
		in.PreferredGenre = *request.Body.PreferredGenre
	}
	if request.Body.PreferredTheme != nil {
		in.PreferredTheme = *request.Body.PreferredTheme
	}
	us, err := svc.PutSettings(ctx, id.ID, in)
	if err != nil {
		if sErr, is := asStoryError(err); is && sErr.Status == 400 {
			return api.PutStorySettings400JSONResponse{Code: sErr.Code, Message: sErr.Message}, nil
		}
		return nil, err
	}
	return api.PutStorySettings200JSONResponse{
		FuriganaThresholdSrsLevel: us.FuriganaThresholdSRSLevel,
		Timezone:                  &us.Timezone,
		PreferredGenre:            &us.PreferredGenre,
		PreferredTheme:            &us.PreferredTheme,
	}, nil
}

// GetReadingSettings serves the reader preferences (issue #11) the Reading
// Panel restores on every visit — kept apart from story settings so the two
// forms cannot clobber each other.
func (s *server) GetReadingSettings(ctx context.Context, request api.GetReadingSettingsRequestObject) (api.GetReadingSettingsResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	rs, err := svc.GetReadingSettings(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	return api.GetReadingSettings200JSONResponse{
		BlurTranslation: rs.BlurTranslation,
		LookupHoldMs:    rs.LookupHoldMs,
	}, nil
}

func (s *server) PutReadingSettings(ctx context.Context, request api.PutReadingSettingsRequestObject) (api.PutReadingSettingsResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	if request.Body == nil {
		return api.PutReadingSettings400JSONResponse{Code: "bad_request", Message: "blurTranslation is required"}, nil
	}
	// The lookup-hold threshold (issue #12) drives a client-side timer; a
	// nonsense value would either signal every lookup or never signal, so
	// the spec bounds it. An absent field keeps the stored threshold: 0 is
	// a meaningful value, so it must arrive as a pointer, not decode to it.
	if h := request.Body.LookupHoldMs; h != nil && (*h < 0 || *h > 10000) {
		return api.PutReadingSettings400JSONResponse{Code: "invalid_settings", Message: "lookupHoldMs must be between 0 and 10000 ms"}, nil
	}
	rs, err := svc.PutReadingSettings(ctx, id.ID, story.ReadingSettingsUpdate{
		BlurTranslation: request.Body.BlurTranslation,
		LookupHoldMs:    request.Body.LookupHoldMs,
	})
	if err != nil {
		return nil, err
	}
	return api.PutReadingSettings200JSONResponse{
		BlurTranslation: rs.BlurTranslation,
		LookupHoldMs:    rs.LookupHoldMs,
	}, nil
}

// storyView maps a stored story onto the API shape. showFurigana is computed
// here, against the Learner's current Furigana Threshold (GLOSSARY.md):
// unknown tokens always show their reading; Known Items show it only below
// the threshold. Question answer indexes stay server-side.
func (s *server) GetStorySuggestions(ctx context.Context, _ api.GetStorySuggestionsRequestObject) (api.GetStorySuggestionsResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	genres, themes, err := svc.GenreThemeSuggestions(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	if genres == nil {
		genres = []string{}
	}
	if themes == nil {
		themes = []string{}
	}
	return api.GetStorySuggestions200JSONResponse{Genres: genres, Themes: themes}, nil
}

// GetStoryGeneration is the progress bar's poll (issue #33): the current or
// last generation run for the Learner, idle when none was ever tracked. The
// run itself lives in the story Service, so a reload finds the same picture.
func (s *server) GetStoryGeneration(ctx context.Context, _ api.GetStoryGenerationRequestObject) (api.GetStoryGenerationResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	return api.GetStoryGeneration200JSONResponse(storyGenerationView(svc.GenerationProgress(ctx, id.ID))), nil
}

// GenerateStory starts one On-demand Story (issue #33). It answers 202 with
// the initial running snapshot as soon as the run is opened: the write
// itself continues in the story Service, detached from this request, and
// clients follow it through GetStoryGeneration. A generation already
// running (on either path) answers 409, the MaruMori sync_running shape.
func (s *server) GenerateStory(ctx context.Context, request api.GenerateStoryRequestObject) (api.GenerateStoryResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	var opts story.OnDemandOptions
	if request.Body != nil {
		b := *request.Body
		if b.Genre != nil {
			g := strings.TrimSpace(*b.Genre)
			if utf8.RuneCountInString(g) > maxStoryGenreRunes {
				return api.GenerateStory400JSONResponse(apiErr("invalid_input", "genre is too long")), nil
			}
			opts.Genre = g
		}
		if b.Theme != nil {
			t := strings.TrimSpace(*b.Theme)
			if utf8.RuneCountInString(t) > maxStoryThemeRunes {
				return api.GenerateStory400JSONResponse(apiErr("invalid_input", "theme is too long")), nil
			}
			opts.Theme = t
		}
		if b.Surprise != nil {
			opts.Surprise = *b.Surprise
		}
	}
	p, err := svc.GenerateOnDemand(ctx, id.ID, opts)
	if err != nil {
		if se, isErr := asStoryError(err); isErr && se.Status == 409 {
			return api.GenerateStory409JSONResponse(apiErr(se.Code, se.Message)), nil
		}
		return nil, err
	}
	return api.GenerateStory202JSONResponse(storyGenerationView(p)), nil
}

// maxStoryGenreRunes and maxStoryThemeRunes mirror the spec's caps on the
// Generate box's free-text inputs.
const (
	maxStoryGenreRunes = 60
	maxStoryThemeRunes = 200
)

// storyGenerationView maps a Progress snapshot to its API shape, omitting
// the fields that only one status carries.
func storyGenerationView(p story.Progress) api.StoryGenerationProgress {
	v := api.StoryGenerationProgress{
		Status:  api.StoryGenerationProgressStatus(p.Status),
		Percent: p.Percent,
	}
	if p.Stage != "" {
		st := api.StoryGenerationProgressStage(p.Stage)
		v.Stage = &st
	}
	if p.Attempt > 0 {
		a := p.Attempt
		v.Attempt = &a
	}
	if p.MaxAttempts > 0 {
		m := p.MaxAttempts
		v.MaxAttempts = &m
	}
	if !p.StartedAt.IsZero() {
		at := p.StartedAt
		v.StartedAt = &at
	}
	if p.Message != "" {
		m := p.Message
		v.Message = &m
	}
	if p.StoryID != uuid.Nil {
		sid := openapi_types.UUID(p.StoryID)
		v.StoryId = &sid
	}
	return v
}

func storyView(st *story.Story, threshold int) api.Story {
	sentences := make([]api.StorySentence, 0, len(st.Sentences))
	for _, sen := range st.Sentences {
		tokens := make([]api.StoryToken, 0, len(sen.Tokens))
		for _, t := range sen.Tokens {
			tok := api.StoryToken{
				Surface:      t.Surface,
				Start:        t.Start,
				End:          t.End,
				Tag:          api.StoryTokenTag(t.Tag),
				ShowFurigana: story.Furigana(t, threshold),
			}
			if t.Reading != "" {
				r := t.Reading
				tok.Reading = &r
			}
			if t.Dictionary != "" {
				d := t.Dictionary
				tok.Dictionary = &d
			}
			if t.EntSeq != nil {
				tok.EntSeq = t.EntSeq
			}
			if t.SRSLevel != nil {
				tok.SrsLevel = t.SRSLevel
			}
			if h := t.Hint; h != nil {
				tok.GrammarHint = &api.StoryTokenGrammarHint{
					GrammarPointId: strconv.FormatInt(h.GrammarPointID, 10),
					Pattern:        h.Pattern,
					Meaning:        h.Meaning,
					JlptLevel:      jlptLevel(h.JLPTLevel),
				}
			}
			tokens = append(tokens, tok)
		}
		spans := make([]api.StoryGrammarSpan, 0, len(sen.Spans))
		for _, sp := range sen.Spans {
			spans = append(spans, api.StoryGrammarSpan{
				Start:          sp.Start,
				End:            sp.End,
				GrammarPointId: strconv.FormatInt(sp.GrammarPointID, 10),
				IsFocus:        sp.IsFocus,
				Pattern:        sp.Pattern,
				Meaning:        sp.Meaning,
				JlptLevel:      jlptLevel(string(sp.JLPTLevel)),
			})
		}
		sentences = append(sentences, api.StorySentence{
			Ja:           sen.JA,
			En:           sen.EN,
			Tokens:       tokens,
			GrammarSpans: spans,
		})
	}
	questions := make([]api.StoryQuestion, 0, len(st.Questions))
	for _, q := range st.Questions {
		questions = append(questions, api.StoryQuestion{
			Position:  q.Pos,
			PromptJa:  q.PromptJA,
			OptionsJa: q.OptionsJA,
		})
	}
	vocab := make([]api.StoryVocabItem, 0, len(st.VocabItems))
	for _, v := range st.VocabItems {
		item := api.StoryVocabItem{EntSeq: v.EntSeq, Ja: v.JA, IsKnown: v.IsKnown, IsFocus: v.IsFocus}
		if v.EN != "" {
			en := v.EN
			item.En = &en
		}
		vocab = append(vocab, item)
	}
	view := api.Story{
		Id:         st.ID.String(),
		Title:      st.Title,
		Genre:      st.Genre,
		Text:       st.Text,
		Sentences:  sentences,
		Questions:  questions,
		VocabItems: vocab,
		CreatedAt:  st.CreatedAt,
		Attempts:   &st.Attempts,
		Origin:     api.StoryOrigin(st.Origin),
	}
	if view.Origin == "" {
		view.Origin = api.Automatic // a stored story predating the column still reads as generator-made
	}
	if st.TitleEN != "" {
		te := st.TitleEN
		view.TitleEn = &te
	}
	if st.Theme != "" {
		th := st.Theme
		view.Theme = &th
	}
	if st.ReadAt != nil {
		view.ReadAt = st.ReadAt
	}
	if st.Rating != nil {
		r := api.StoryRating(*st.Rating)
		view.Rating = &r
	}
	return view
}
