package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"strconv"
	"strings"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
)

var errGrammarNotConfigured = errors.New("grammar store is not configured")

// WithGrammar enables the /grammar/points routes. The Generator may be nil:
// reading a catalogue point never needs a provider, only auto-generation does.
func WithGrammar(store grammar.Store, gen *grammar.Generator) Option {
	return func(s *server) { s.grammar, s.grammarGen = store, gen }
}

func (s *server) grammarStore() (grammar.Store, error) {
	if s.grammar == nil {
		return nil, errGrammarNotConfigured
	}
	return s.grammar, nil
}

// parsePointID reads a catalogue id from the path. Ids are positive integers;
// malformed or non-positive ones cannot exist, so callers answer 404.
func parsePointID(s string) (int64, bool) {
	id, err := strconv.ParseInt(s, 10, 64)
	return id, err == nil && id > 0
}

// callerID resolves the Learner whose AI Provider settings generation follows.
func callerID(ctx context.Context) (uuid.UUID, bool) {
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return uuid.Nil, false
	}
	return id.ID, true
}

func jlptLevel(level string) api.GrammarJLPTLevel { return api.GrammarJLPTLevel(level) }

func exampleView(e grammar.Example) api.GrammarExample {
	return api.GrammarExample{
		Id: e.ID, SentenceJa: e.SentenceJA, TranslationEn: e.TranslationEN,
		SpanStart: e.SpanStart, SpanEnd: e.SpanEnd, SpanText: e.SpanText,
		Source: api.GrammarExampleSource(e.Source),
	}
}

func examplesView(examples []grammar.Example) []api.GrammarExample {
	out := make([]api.GrammarExample, len(examples))
	for i, e := range examples {
		out[i] = exampleView(e)
	}
	return out
}

// rejectionViews flattens generation rejections into one entry per reason code.
// Reasons arrive as "code: detail"; the code is the machine-readable half.
func rejectionViews(rejections []grammar.CandidateRejection) []api.CandidateRejection {
	var out []api.CandidateRejection
	for _, r := range rejections {
		sentence := r.Sentence
		for _, reason := range r.Reasons {
			code, message := reason, reason
			if c, m, ok := strings.Cut(reason, ": "); ok {
				code, message = c, m
			}
			out = append(out, api.CandidateRejection{Code: code, Message: message, Sentence: &sentence})
		}
	}
	return out
}

// grammarDetail assembles the full view of one point: catalogue fields, its
// explanation state and its validated example sentences.
func (s *server) grammarDetail(ctx context.Context, id int64) (api.GrammarPointDetail, error) {
	point, err := s.grammar.Point(ctx, id)
	if err != nil {
		return api.GrammarPointDetail{}, err
	}
	content, err := s.grammar.Content(ctx, id)
	if err != nil {
		return api.GrammarPointDetail{}, err
	}
	examples, err := s.grammar.Examples(ctx, id)
	if err != nil {
		return api.GrammarPointDetail{}, err
	}
	explanation := ""
	if content.Explanation != nil {
		explanation = *content.Explanation
	}
	return api.GrammarPointDetail{
		Id: point.ID, JlptLevel: jlptLevel(string(point.Level)),
		CatalogueNumber: point.Number, Pattern: point.Pattern, Meaning: point.Meaning,
		Explanation: explanation, ExplanationEdited: content.ExplanationEdited,
		Examples: examplesView(examples),
	}, nil
}

func (s *server) ListGrammarPoints(ctx context.Context, req api.ListGrammarPointsRequestObject) (api.ListGrammarPointsResponseObject, error) {
	store, err := s.grammarStore()
	if err != nil {
		return nil, err
	}
	filter := grammar.Filter{}
	if req.Params.Level != nil {
		if !req.Params.Level.Valid() {
			return api.ListGrammarPoints400JSONResponse(apiErr("bad_request", "level must be one of N5, N4, N3, N2, N1")), nil
		}
		filter.Level = string(*req.Params.Level)
	}
	if req.Params.Q != nil {
		filter.Query = *req.Params.Q
	}
	if req.Params.Limit != nil && (*req.Params.Limit < 1 || *req.Params.Limit > grammar.MaxLimit) {
		return api.ListGrammarPoints400JSONResponse(apiErr("bad_request", "limit must be between 1 and 200")), nil
	}
	if req.Params.Offset != nil && *req.Params.Offset < 0 {
		return api.ListGrammarPoints400JSONResponse(apiErr("bad_request", "offset must be 0 or greater")), nil
	}
	filter.Limit = grammar.ClampLimit(derefOr(req.Params.Limit, 0)) // 0 selects the default
	filter.Offset = derefOr(req.Params.Offset, 0)

	summaries, total, err := store.Points(ctx, filter)
	if err != nil {
		return nil, err
	}
	items := make([]api.GrammarPointSummary, len(summaries))
	for i, p := range summaries {
		items[i] = api.GrammarPointSummary{
			Id: p.ID, JlptLevel: jlptLevel(string(p.Level)), CatalogueNumber: p.Number,
			Pattern: p.Pattern, Meaning: p.Meaning,
			HasExplanation: p.HasExplanation, ExampleCount: p.ExampleCount,
		}
	}
	return api.ListGrammarPoints200JSONResponse{
		Items: items, Total: total, Limit: filter.Limit, Offset: filter.Offset,
	}, nil
}

func derefOr[T any](p *T, fallback T) T {
	if p != nil {
		return *p
	}
	return fallback
}

func (s *server) GetGrammarPoint(ctx context.Context, req api.GetGrammarPointRequestObject) (api.GetGrammarPointResponseObject, error) {
	if _, err := s.grammarStore(); err != nil {
		return nil, err
	}
	id, ok := parsePointID(req.Id)
	if !ok {
		return api.GetGrammarPoint404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
	}
	userID, ok := callerID(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated // unreachable behind requireSession; fail closed
	}

	// First read generates; stored content is served untouched. A missing or
	// failing provider never turns a readable catalogue point into an error:
	// the point is answered with whatever content it has.
	pointNotFound := api.GetGrammarPoint404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}
	if s.grammarGen != nil {
		// A missing explanation and a thin set of examples are both topped up,
		// in that order. ErrNotAssigned is quiet: the point is answered with
		// whatever content it already has.
		if _, err := s.grammarGen.EnsureExplanation(ctx, id, userID); err != nil {
			if errors.Is(err, grammar.ErrPointNotFound) {
				return pointNotFound, nil
			}
			if !errors.Is(err, grammar.ErrNotAssigned) {
				slog.Warn("grammar: explanation generation failed", "point", id, "err", err)
			}
		}
		if _, err := s.grammarGen.EnsureExamples(ctx, id, userID, grammar.MinExamplesPerPoint); err != nil {
			if errors.Is(err, grammar.ErrPointNotFound) {
				return pointNotFound, nil
			}
			if !errors.Is(err, grammar.ErrNotAssigned) {
				slog.Warn("grammar: example generation failed", "point", id, "err", err)
			}
		}
	}
	detail, err := s.grammarDetail(ctx, id)
	switch {
	case errors.Is(err, grammar.ErrPointNotFound):
		return api.GetGrammarPoint404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
	case err != nil:
		return nil, err
	}
	return api.GetGrammarPoint200JSONResponse(detail), nil
}

func (s *server) UpdateGrammarPoint(ctx context.Context, req api.UpdateGrammarPointRequestObject) (api.UpdateGrammarPointResponseObject, error) {
	store, err := s.grammarStore()
	if err != nil {
		return nil, err
	}
	id, ok := parsePointID(req.Id)
	if !ok {
		return api.UpdateGrammarPoint404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
	}
	if req.Body == nil || strings.TrimSpace(req.Body.Explanation) == "" {
		return api.UpdateGrammarPoint400JSONResponse(apiErr("bad_request", "explanation must not be empty")), nil
	}
	if err := store.SetExplanation(ctx, id, req.Body.Explanation, true); err != nil {
		switch {
		case errors.Is(err, grammar.ErrPointNotFound):
			return api.UpdateGrammarPoint404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
		case err != nil:
			return nil, err
		}
	}
	detail, err := s.grammarDetail(ctx, id)
	switch {
	case errors.Is(err, grammar.ErrPointNotFound):
		return api.UpdateGrammarPoint404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
	case err != nil:
		return nil, err
	}
	return api.UpdateGrammarPoint200JSONResponse(detail), nil
}

func (s *server) GenerateGrammarExamples(ctx context.Context, req api.GenerateGrammarExamplesRequestObject) (api.GenerateGrammarExamplesResponseObject, error) {
	store, gen, err := s.grammarGenerator()
	if err != nil {
		return nil, err
	}
	id, ok := parsePointID(req.Id)
	if !ok {
		return api.GenerateGrammarExamples404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
	}
	// The point must exist before anything spends a provider.
	if _, err := store.Point(ctx, id); err != nil {
		switch {
		case errors.Is(err, grammar.ErrPointNotFound):
			return api.GenerateGrammarExamples404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
		case err != nil:
			return nil, err
		}
	}
	count := 10
	if req.Body != nil && req.Body.Count != nil {
		count = *req.Body.Count
	}
	if count < 1 || count > grammar.MaxExamplesPerRequest {
		return api.GenerateGrammarExamples400JSONResponse(apiErr("bad_request", "count must be between 1 and 30")), nil
	}
	userID, ok := callerID(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated // unreachable behind requireSession; fail closed
	}

	result, err := gen.GenerateExamples(ctx, id, userID, count)
	switch {
	case errors.Is(err, grammar.ErrPointNotFound):
		return api.GenerateGrammarExamples404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
	case errors.Is(err, grammar.ErrNotAssigned):
		return api.GenerateGrammarExamples409JSONResponse(apiErr("no_ai_provider",
			"No AI provider is assigned to the grammar_content task; choose one in AI settings")), nil
	case err != nil:
		return nil, err
	}

	// The result carries the point's whole example set after generation.
	examples, err := store.Examples(ctx, id)
	if err != nil {
		return nil, err
	}
	out := api.GenerationResult{
		Generated: result.Generated, Stored: result.Stored, Rejected: result.Rejected,
		Rejections: rejectionViews(result.Rejections),
		Examples:   examplesView(examples),
	}
	if result.Note != "" {
		out.Note = &result.Note
	}
	return api.GenerateGrammarExamples200JSONResponse(out), nil
}

func (s *server) RegenerateGrammarExplanation(ctx context.Context, req api.RegenerateGrammarExplanationRequestObject) (api.RegenerateGrammarExplanationResponseObject, error) {
	store, gen, err := s.grammarGenerator()
	if err != nil {
		return nil, err
	}
	id, ok := parsePointID(req.Id)
	if !ok {
		return api.RegenerateGrammarExplanation404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
	}
	// Check existence first so an unknown point answers 404 even without a
	// provider assigned (generation would fail with 409 first).
	if _, err := store.Point(ctx, id); err != nil {
		switch {
		case errors.Is(err, grammar.ErrPointNotFound):
			return api.RegenerateGrammarExplanation404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
		case err != nil:
			return nil, err
		}
	}
	userID, ok := callerID(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated // unreachable behind requireSession; fail closed
	}

	if _, err := gen.RegenerateExplanation(ctx, id, userID); err != nil {
		switch {
		case errors.Is(err, grammar.ErrPointNotFound):
			return api.RegenerateGrammarExplanation404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
		case errors.Is(err, grammar.ErrNotAssigned):
			return api.RegenerateGrammarExplanation409JSONResponse(apiErr("no_ai_provider",
				"No AI provider is assigned to the grammar_content task; choose one in AI settings")), nil
		case err != nil:
			return nil, err
		}
	}
	detail, err := s.grammarDetail(ctx, id)
	switch {
	case errors.Is(err, grammar.ErrPointNotFound):
		return api.RegenerateGrammarExplanation404JSONResponse{NotFoundJSONResponse: notFound("Grammar point not found")}, nil
	case err != nil:
		return nil, err
	}
	return api.RegenerateGrammarExplanation200JSONResponse(detail), nil
}

// grammarGenerator returns the store and generator together, for the routes
// that need the provider-backed generation flows.
func (s *server) grammarGenerator() (grammar.Store, *grammar.Generator, error) {
	store, err := s.grammarStore()
	if err != nil {
		return nil, nil, err
	}
	if s.grammarGen == nil {
		return nil, nil, errors.New("grammar generation is not configured")
	}
	return store, s.grammarGen, nil
}
