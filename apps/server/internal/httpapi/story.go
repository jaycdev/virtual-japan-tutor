package httpapi

import (
	"context"
	"errors"
	"strconv"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
)

// WithStory enables the /stories routes (issue #10: story generation behind
// the kagome validation gate, the ready-story background flow, the library,
// ratings, comprehension answers, and story settings).
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

// GetReadyStory serves the story the background generator prepared, from
// storage only — the request never waits on an AI provider. Reading it
// clears the ready marker so the next scheduler pass re-arms generation.
func (s *server) GetReadyStory(ctx context.Context, request api.GetReadyStoryRequestObject) (api.GetReadyStoryResponseObject, error) {
	svc, err := s.storyService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	st, err := svc.OpenReady(ctx, id.ID)
	if err != nil {
		if errors.Is(err, story.ErrNoReadyStory) {
			return api.GetReadyStory404JSONResponse{Code: "no_ready_story", Message: "No story is ready yet; the background generator is on it."}, nil
		}
		return nil, err
	}
	us, err := svc.GetSettings(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	return api.GetReadyStory200JSONResponse(storyView(st, us.FuriganaThresholdSRSLevel)), nil
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

// AnswerStoryQuestion grades one comprehension question. The first answer
// for a story also appends the Practice Records for its Focus Set items
// (see internal/story and docs/adr/0008-practice-records.md); the view never
// reveals answer indexes before the Learner answers.
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
	return api.GetStorySettings200JSONResponse{FuriganaThresholdSrsLevel: us.FuriganaThresholdSRSLevel}, nil
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
	us, err := svc.PutSettings(ctx, id.ID, story.UserSettings{FuriganaThresholdSRSLevel: request.Body.FuriganaThresholdSrsLevel})
	if err != nil {
		if sErr, is := asStoryError(err); is && sErr.Status == 400 {
			return api.PutStorySettings400JSONResponse{Code: sErr.Code, Message: sErr.Message}, nil
		}
		return nil, err
	}
	return api.PutStorySettings200JSONResponse{FuriganaThresholdSrsLevel: us.FuriganaThresholdSRSLevel}, nil
}

// storyView maps a stored story onto the API shape. showFurigana is computed
// here, against the Learner's current Furigana Threshold (GLOSSARY.md):
// unknown tokens always show their reading; Known Items show it only below
// the threshold. Question answer indexes stay server-side.
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
			tokens = append(tokens, tok)
		}
		spans := make([]api.StoryGrammarSpan, 0, len(sen.Spans))
		for _, sp := range sen.Spans {
			spans = append(spans, api.StoryGrammarSpan{
				Start:          sp.Start,
				End:            sp.End,
				GrammarPointId: strconv.FormatInt(sp.GrammarPointID, 10),
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
		Genre:      st.Genre,
		Text:       st.Text,
		Sentences:  sentences,
		Questions:  questions,
		VocabItems: vocab,
		CreatedAt:  st.CreatedAt,
		Attempts:   &st.Attempts,
	}
	if st.Rating != nil {
		r := api.StoryRating(*st.Rating)
		view.Rating = &r
	}
	return view
}
