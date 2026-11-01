package httpapi

import (
	"context"
	"errors"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

var errGrammarKnowledgeNotConfigured = errors.New("known grammar service is not configured")

// knownGrammarService is the onboarding (Starting Level, Seeded Grammar) and
// Observed Grammar review surface (issue #6).
func (s *server) knownGrammarService() (*knowngrammar.Service, error) {
	if s.knownGrammar == nil {
		return nil, errGrammarKnowledgeNotConfigured
	}
	return s.knownGrammar, nil
}

// startingLevelStatusView turns the stored level and an optional Seeded Grammar
// delta into the api shape. The delta belongs to a change (the PUT); GET leaves
// Added and Removed absent rather than reporting zeros.
func startingLevelStatusView(level refdata.Level, configured bool, delta *knowngrammar.SeededDelta) api.StartingLevelStatus {
	out := api.StartingLevelStatus{Configured: configured}
	if delta != nil {
		out.Added = &delta.Added
		out.Removed = &delta.Removed
	}
	if configured {
		lvl := api.StartingLevelStatusLevel(level)
		out.Level = &lvl
	}
	return out
}

func (s *server) GetStartingLevel(ctx context.Context, _ api.GetStartingLevelRequestObject) (api.GetStartingLevelResponseObject, error) {
	svc, err := s.knownGrammarService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated // unreachable behind requireSession; fail closed
	}
	level, configured, err := svc.StartingLevel(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	return api.GetStartingLevel200JSONResponse(startingLevelStatusView(level, configured, nil)), nil
}

func (s *server) SetStartingLevel(ctx context.Context, req api.SetStartingLevelRequestObject) (api.SetStartingLevelResponseObject, error) {
	svc, err := s.knownGrammarService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	if req.Body == nil || !knownLevel(refdata.Level(req.Body.Level)) {
		return api.SetStartingLevel400JSONResponse(apiErr("invalid_level", "level must be one of N5, N4, N3, N2, N1")), nil
	}
	delta, err := svc.SetStartingLevel(ctx, id.ID, refdata.Level(req.Body.Level))
	if errors.Is(err, knowngrammar.ErrLevelRequired) {
		return api.SetStartingLevel400JSONResponse(apiErr("invalid_level", "level must be one of N5, N4, N3, N2, N1")), nil
	}
	if err != nil {
		return nil, err
	}
	return api.SetStartingLevel200JSONResponse(
		startingLevelStatusView(refdata.Level(req.Body.Level), true, &delta)), nil
}

// knownLevel accepts exactly the levels the spec's enum lists; the strict decoder
// passes unknown enum values through untouched.
func knownLevel(level refdata.Level) bool {
	for _, l := range refdata.Levels {
		if l == level {
			return true
		}
	}
	return false
}

func grammarReviewView(o knowngrammar.Observation) api.GrammarReviewItem {
	item := api.GrammarReviewItem{
		MarumoriId: o.MaruMoriID,
		Pattern:    o.Pattern,
		Flagged:    o.Flagged,
	}
	if o.JLPTLevel != "" {
		level := api.GrammarReviewItemJlptLevel(o.JLPTLevel)
		item.JlptLevel = &level
	}
	if o.MatchedPoint != 0 {
		matched := o.MatchedPoint
		item.MatchedPointId = &matched
	}
	return item
}

func (s *server) ListGrammarReviewItems(ctx context.Context, req api.ListGrammarReviewItemsRequestObject) (api.ListGrammarReviewItemsResponseObject, error) {
	svc, err := s.knownGrammarService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	observations, err := svc.Observations(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	flaggedOnly := req.Params.Flagged == nil || *req.Params.Flagged
	out := make(api.ListGrammarReviewItems200JSONResponse, 0, len(observations))
	for _, o := range observations {
		if flaggedOnly && !o.Flagged {
			continue
		}
		out = append(out, grammarReviewView(o))
	}
	return out, nil
}
