package httpapi

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
)

var errAINotConfigured = errors.New("AI provider service is not configured")

func (s *server) providers() (*aiprovider.Service, error) {
	if s.ai == nil {
		return nil, errAINotConfigured
	}
	return s.ai, nil
}

func providerView(p aiprovider.Provider) api.AiProvider {
	return api.AiProvider{
		Id: p.ID, Name: p.Name, BaseUrl: p.BaseURL, Model: p.Model,
		HasApiKey: p.HasAPIKey, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
}

// parseID reads a provider id from the path. Malformed ids cannot exist, so callers answer 404.
func parseID(s string) (uuid.UUID, bool) {
	id, err := uuid.Parse(s)
	return id, err == nil && id != uuid.Nil
}

func apiErr(code, message string) api.Error { return api.Error{Code: code, Message: message} }

// keyChange reads the tri-state apiKey field: absent keeps the stored key; null or an empty
// string removes it; any other string replaces it.
func keyChange(raw json.RawMessage) (aiprovider.KeyChange, error) {
	if len(raw) == 0 {
		return aiprovider.KeyChange{}, nil
	}
	var v *string
	if err := json.Unmarshal(raw, &v); err != nil {
		return aiprovider.KeyChange{}, errors.New("apiKey must be a string or null")
	}
	if v == nil {
		return aiprovider.SetKey(""), nil
	}
	return aiprovider.SetKey(*v), nil
}

func (s *server) ListAiProviders(ctx context.Context, _ api.ListAiProvidersRequestObject) (api.ListAiProvidersResponseObject, error) {
	svc, err := s.providers()
	if err != nil {
		return nil, err
	}
	list, err := svc.List(ctx)
	if err != nil {
		return nil, err
	}
	out := make(api.ListAiProviders200JSONResponse, len(list))
	for i, p := range list {
		out[i] = providerView(p)
	}
	return out, nil
}

func (s *server) CreateAiProvider(ctx context.Context, req api.CreateAiProviderRequestObject) (api.CreateAiProviderResponseObject, error) {
	svc, err := s.providers()
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return api.CreateAiProvider400JSONResponse(apiErr("bad_request", "Malformed request")), nil
	}
	key, err := keyChange(req.Body.ApiKey)
	if err != nil {
		return api.CreateAiProvider400JSONResponse(apiErr("bad_request", err.Error())), nil
	}
	p, err := svc.Create(ctx, aiprovider.Input{Name: req.Body.Name, BaseURL: req.Body.BaseUrl, Model: req.Body.Model, APIKey: key})
	switch {
	case errors.Is(err, aiprovider.ErrInvalidInput):
		return api.CreateAiProvider400JSONResponse(apiErr("invalid_provider", err.Error())), nil
	case errors.Is(err, aiprovider.ErrNameTaken):
		return api.CreateAiProvider409JSONResponse(apiErr("name_taken", "A provider with this name already exists")), nil
	case err != nil:
		return nil, err
	}
	return api.CreateAiProvider201JSONResponse(providerView(p)), nil
}

func (s *server) GetAiProvider(ctx context.Context, req api.GetAiProviderRequestObject) (api.GetAiProviderResponseObject, error) {
	svc, err := s.providers()
	if err != nil {
		return nil, err
	}
	id, ok := parseID(req.Id)
	if !ok {
		return api.GetAiProvider404JSONResponse{NotFoundJSONResponse: notFound("AI provider not found")}, nil
	}
	p, err := svc.Get(ctx, id)
	switch {
	case errors.Is(err, aiprovider.ErrNotFound):
		return api.GetAiProvider404JSONResponse{NotFoundJSONResponse: notFound("AI provider not found")}, nil
	case err != nil:
		return nil, err
	}
	return api.GetAiProvider200JSONResponse(providerView(p)), nil
}

func notFound(msg string) api.NotFoundJSONResponse {
	return api.NotFoundJSONResponse(apiErr("not_found", msg))
}

func (s *server) UpdateAiProvider(ctx context.Context, req api.UpdateAiProviderRequestObject) (api.UpdateAiProviderResponseObject, error) {
	svc, err := s.providers()
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return api.UpdateAiProvider400JSONResponse(apiErr("bad_request", "Malformed request")), nil
	}
	key, err := keyChange(req.Body.ApiKey)
	if err != nil {
		return api.UpdateAiProvider400JSONResponse(apiErr("bad_request", err.Error())), nil
	}
	id, ok := parseID(req.Id)
	if !ok {
		return api.UpdateAiProvider404JSONResponse{NotFoundJSONResponse: notFound("AI provider not found")}, nil
	}
	p, err := svc.Update(ctx, id, aiprovider.Patch{
		Name: req.Body.Name, BaseURL: req.Body.BaseUrl, Model: req.Body.Model, APIKey: key,
	})
	switch {
	case errors.Is(err, aiprovider.ErrNotFound):
		return api.UpdateAiProvider404JSONResponse{NotFoundJSONResponse: notFound("AI provider not found")}, nil
	case errors.Is(err, aiprovider.ErrInvalidInput):
		return api.UpdateAiProvider400JSONResponse(apiErr("invalid_provider", err.Error())), nil
	case errors.Is(err, aiprovider.ErrNameTaken):
		return api.UpdateAiProvider409JSONResponse(apiErr("name_taken", "A provider with this name already exists")), nil
	case err != nil:
		return nil, err
	}
	return api.UpdateAiProvider200JSONResponse(providerView(p)), nil
}

func (s *server) DeleteAiProvider(ctx context.Context, req api.DeleteAiProviderRequestObject) (api.DeleteAiProviderResponseObject, error) {
	svc, err := s.providers()
	if err != nil {
		return nil, err
	}
	id, ok := parseID(req.Id)
	if !ok {
		return api.DeleteAiProvider404JSONResponse{NotFoundJSONResponse: notFound("AI provider not found")}, nil
	}
	err = svc.Delete(ctx, id)
	switch {
	case errors.Is(err, aiprovider.ErrNotFound):
		return api.DeleteAiProvider404JSONResponse{NotFoundJSONResponse: notFound("AI provider not found")}, nil
	case errors.Is(err, aiprovider.ErrInUse):
		return api.DeleteAiProvider409JSONResponse(apiErr("provider_in_use",
			"This provider is assigned to a task; choose another provider for the task first")), nil
	case err != nil:
		return nil, err
	}
	return api.DeleteAiProvider204Response{}, nil
}

func (s *server) TestAiProvider(ctx context.Context, req api.TestAiProviderRequestObject) (api.TestAiProviderResponseObject, error) {
	svc, err := s.providers()
	if err != nil {
		return nil, err
	}
	id, ok := parseID(req.Id)
	if !ok {
		return api.TestAiProvider404JSONResponse{NotFoundJSONResponse: notFound("AI provider not found")}, nil
	}
	res, err := svc.Test(ctx, id)
	switch {
	case errors.Is(err, aiprovider.ErrNotFound):
		return api.TestAiProvider404JSONResponse{NotFoundJSONResponse: notFound("AI provider not found")}, nil
	case err != nil:
		return nil, err
	}
	out := api.TestAiProvider200JSONResponse{Ok: res.OK, LatencyMs: res.Latency.Milliseconds(), Message: res.Message}
	if res.OK {
		mode := api.AiProviderTestResultStructuredOutput(res.Structured)
		if res.Structured == llm.Mode(aiprovider.ModeUnavailable) {
			mode = api.Unavailable
		}
		out.StructuredOutput = &mode
	}
	return out, nil
}

func assignmentView(a aiprovider.Assignment) api.AiTaskAssignment {
	out := api.AiTaskAssignment{Task: api.AiTask(a.Task)}
	if a.ProviderID != nil {
		id := *a.ProviderID
		out.ProviderId = &id
	}
	return out
}

func (s *server) ListAiTasks(ctx context.Context, _ api.ListAiTasksRequestObject) (api.ListAiTasksResponseObject, error) {
	svc, err := s.providers()
	if err != nil {
		return nil, err
	}
	list, err := svc.Assignments(ctx)
	if err != nil {
		return nil, err
	}
	out := make(api.ListAiTasks200JSONResponse, len(list))
	for i, a := range list {
		out[i] = assignmentView(a)
	}
	return out, nil
}

func (s *server) SetAiTask(ctx context.Context, req api.SetAiTaskRequestObject) (api.SetAiTaskResponseObject, error) {
	svc, err := s.providers()
	if err != nil {
		return nil, err
	}
	if req.Body == nil || req.Body.ProviderId == uuid.Nil {
		return api.SetAiTask400JSONResponse(apiErr("bad_request", "providerId is required")), nil
	}
	id := req.Body.ProviderId
	err = svc.Assign(ctx, aiprovider.Task(req.Task), &id)
	switch {
	case errors.Is(err, aiprovider.ErrUnknownTask):
		return api.SetAiTask404JSONResponse(apiErr("not_found", "Unknown task")), nil
	case errors.Is(err, aiprovider.ErrNotFound):
		return api.SetAiTask404JSONResponse(apiErr("not_found", "AI provider not found")), nil
	case err != nil:
		return nil, err
	}
	return api.SetAiTask200JSONResponse(assignmentView(aiprovider.Assignment{Task: aiprovider.Task(req.Task), ProviderID: &id})), nil
}

func (s *server) ClearAiTask(ctx context.Context, req api.ClearAiTaskRequestObject) (api.ClearAiTaskResponseObject, error) {
	svc, err := s.providers()
	if err != nil {
		return nil, err
	}
	err = svc.Assign(ctx, aiprovider.Task(req.Task), nil)
	switch {
	case errors.Is(err, aiprovider.ErrUnknownTask):
		return api.ClearAiTask404JSONResponse(apiErr("not_found", "Unknown task")), nil
	case err != nil:
		return nil, err
	}
	return api.ClearAiTask200JSONResponse(assignmentView(aiprovider.Assignment{Task: aiprovider.Task(req.Task)})), nil
}
