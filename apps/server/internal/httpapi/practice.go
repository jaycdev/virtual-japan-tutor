package httpapi

import (
	"context"
	"errors"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
)

// WithPractice enables the /practice/sessions routes (issue #9: Practice
// Sessions drawn from the Focus Set, recording into the Practice Record).
func WithPractice(svc *practice.Service) Option { return func(s *server) { s.practice = svc } }

// practice.Error carries an HTTP status; each handler maps it to its
// operation's declared error responses. A non-*practice.Error is a genuine
// server fault: return it so the strict handler answers 500.
func asPracticeError(err error) (*practice.Error, bool) {
	var pErr *practice.Error
	if errors.As(err, &pErr) {
		return pErr, true
	}
	return nil, false
}

func (s *server) practiceService() (*practice.Service, error) {
	if s.practice == nil {
		return nil, errors.New("practice service is not configured")
	}
	return s.practice, nil
}

func (s *server) StartPracticeSession(ctx context.Context, request api.StartPracticeSessionRequestObject) (api.StartPracticeSessionResponseObject, error) {
	svc, err := s.practiceService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated // unreachable behind requireSession; fail closed
	}
	seed := int64(0)
	if request.Body != nil && request.Body.Seed != nil {
		seed = *request.Body.Seed
	}
	sessionID, err := svc.StartSession(ctx, id.ID, seed)
	if err != nil {
		if pErr, is := asPracticeError(err); is && pErr.Status == 409 {
			return api.StartPracticeSession409JSONResponse{Code: pErr.Code, Message: pErr.Message}, nil
		}
		return nil, err
	}
	sess, err := svc.GetSession(ctx, id.ID, sessionID)
	if err != nil {
		return nil, err
	}
	return api.StartPracticeSession200JSONResponse(practiceSessionView(sess)), nil
}

func (s *server) GetPracticeSession(ctx context.Context, request api.GetPracticeSessionRequestObject) (api.GetPracticeSessionResponseObject, error) {
	svc, err := s.practiceService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	sess, err := svc.GetSession(ctx, id.ID, string(request.SessionId))
	if err != nil {
		if pErr, is := asPracticeError(err); is && pErr.Status == 404 {
			return api.GetPracticeSession404JSONResponse{NotFoundJSONResponse: notFound(pErr.Message)}, nil
		}
		return nil, err
	}
	return api.GetPracticeSession200JSONResponse(practiceSessionView(sess)), nil
}

func (s *server) AnswerPracticeExercise(ctx context.Context, request api.AnswerPracticeExerciseRequestObject) (api.AnswerPracticeExerciseResponseObject, error) {
	svc, err := s.practiceService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	if request.Body == nil {
		return api.AnswerPracticeExercise400JSONResponse{Code: "bad_request", Message: "exerciseId and optionId are required"}, nil
	}
	out, err := svc.SubmitAnswer(ctx, id.ID, string(request.SessionId), request.Body.ExerciseId, request.Body.OptionId)
	if err != nil {
		if pErr, is := asPracticeError(err); is {
			switch pErr.Status {
			case 400:
				return api.AnswerPracticeExercise400JSONResponse{Code: pErr.Code, Message: pErr.Message}, nil
			case 404:
				return api.AnswerPracticeExercise404JSONResponse{NotFoundJSONResponse: notFound(pErr.Message)}, nil
			case 409:
				return api.AnswerPracticeExercise409JSONResponse{Code: pErr.Code, Message: pErr.Message}, nil
			}
		}
		return nil, err
	}
	return api.AnswerPracticeExercise200JSONResponse{
		Correct:         out.Correct,
		CorrectOptionId: out.CorrectOptionID,
		State:           api.PracticeState(out.State),
	}, nil
}

// practiceSessionView maps the stored session to the API view. Once an
// exercise has been answered its chosen and correct options are revealed, so
// a resumed session shows the same feedback; nothing is revealed before.
func practiceSessionView(sess *practice.Session) api.PracticeSession {
	view := api.PracticeSession{
		Id:         sess.ID,
		State:      api.PracticeState(sess.State),
		Skipped:    sess.Skipped,
		TargetSize: &sess.TargetSize,
		Exercises:  make([]api.PracticeExercise, 0, len(sess.Exercises)),
	}
	for i, e := range sess.Exercises {
		ex := api.PracticeExercise{
			Id:          e.ID,
			Kind:        api.PracticeExerciseKind(e.Kind),
			ItemKind:    api.ItemKind(e.Item.Kind),
			ItemRef:     e.Item.Ref,
			Prompt:      e.Prompt,
			Instruction: &e.Instruction,
			Options:     &[]api.PracticeOption{},
		}
		opts := make([]api.PracticeOption, 0, len(e.Options))
		for _, o := range e.Options {
			opts = append(opts, api.PracticeOption{Id: o.ID, Text: o.Text})
		}
		ex.Options = &opts
		if sess.Done[i] {
			ex.Answered = true
			correct := sess.Answers[i].Correct
			ex.Correct = &correct
			chosen := sess.Answers[i].OptionID
			ex.ChosenOptionId = &chosen
			right := e.CorrectOptionID
			ex.CorrectOptionId = &right
		}
		view.Exercises = append(view.Exercises, ex)
	}
	if sess.State == practice.StateComplete {
		total, right := len(sess.Exercises), 0
		items := make([]api.PracticeResultsItem, 0, len(sess.Exercises))
		for i, e := range sess.Exercises {
			a := sess.Answers[i]
			if a.Correct {
				right++
			}
			items = append(items, api.PracticeResultsItem{
				ItemKind: api.ItemKind(e.Item.Kind),
				ItemRef:  e.Item.Ref,
				Correct:  a.Correct,
			})
		}
		view.Results = &api.PracticeResults{Total: total, Correct: right, Items: &items}
	}
	return view
}
