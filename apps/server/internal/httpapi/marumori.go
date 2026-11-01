package httpapi

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
)

var errMaruMoriNotConfigured = errors.New("MaruMori service is not configured")

func (s *server) maruMoriService() (*marumorisync.Service, error) {
	if s.marumori == nil {
		return nil, errMaruMoriNotConfigured
	}
	return s.marumori, nil
}

// The learner-facing views: marumorisync types in, api types out. A stored API key has
// no path into any of them — Status/Settings carry nothing key-shaped.

func maruMoriCountsView(c *marumorisync.Counts) *api.MaruMoriCounts {
	if c == nil {
		return nil
	}
	return &api.MaruMoriCounts{
		Kanji:            c.Kanji,
		Vocabulary:       c.Vocabulary,
		GrammarReviews:   c.GrammarReviews,
		GrammarLessons:   c.GrammarLessons,
		Linked:           c.Linked,
		Unlinked:         c.Unlinked,
		Ambiguous:        c.Ambiguous,
		New:              c.New,
		LevelChanges:     c.LevelChanges,
		Disappeared:      c.Disappeared,
		SkippedLevelZero: c.SkippedLevelZero,
	}
}

func maruMoriRunView(r marumorisync.SyncRun) api.MaruMoriSyncRun {
	return api.MaruMoriSyncRun{
		Id:         r.ID,
		Status:     api.MaruMoriSyncRunStatus(r.Status),
		StartedAt:  r.StartedAt,
		FinishedAt: r.FinishedAt,
		Error:      r.Error,
		Counts:     maruMoriCountsView(r.Counts),
	}
}

func maruMoriStatusView(st marumorisync.Status) api.MaruMoriStatus {
	out := api.MaruMoriStatus{Connected: st.Connected, ConnectedAt: st.ConnectedAt}
	if st.LastSync != nil {
		run := maruMoriRunView(*st.LastSync)
		out.LastSync = &run
	}
	if st.Totals != nil {
		t := st.Totals
		counts := api.MaruMoriStatusCounts{
			Kanji:      t.Kanji,
			Vocabulary: t.Vocabulary,
			LastSyncAt: t.LastSyncAt,
		}
		if t.Vocabulary > 0 {
			counts.VocabularyLinkRate = float32(t.VocabularyLinked) / float32(t.Vocabulary)
		}
		if counts.LastSyncAt == nil && st.LastSync != nil && st.LastSync.FinishedAt != nil {
			counts.LastSyncAt = st.LastSync.FinishedAt
		}
		out.Counts = &counts
	}
	return out
}

func (s *server) GetMaruMoriStatus(ctx context.Context, _ api.GetMaruMoriStatusRequestObject) (api.GetMaruMoriStatusResponseObject, error) {
	svc, err := s.maruMoriService()
	if err != nil {
		return nil, err
	}
	st, err := svc.Status(ctx)
	if err != nil {
		return nil, err
	}
	return api.GetMaruMoriStatus200JSONResponse(maruMoriStatusView(st)), nil
}

func (s *server) SetMaruMoriKey(ctx context.Context, req api.SetMaruMoriKeyRequestObject) (api.SetMaruMoriKeyResponseObject, error) {
	svc, err := s.maruMoriService()
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return api.SetMaruMoriKey400JSONResponse(apiErr("invalid_key", "apiKey is required")), nil
	}
	var apiKey string
	if err := json.Unmarshal(req.Body.ApiKey, &apiKey); err != nil {
		return api.SetMaruMoriKey400JSONResponse(apiErr("invalid_key", "apiKey must be a string")), nil
	}
	if err := svc.SetAPIKey(ctx, apiKey); err != nil {
		if errors.Is(err, marumorisync.ErrInvalidKey) {
			return api.SetMaruMoriKey400JSONResponse(apiErr("invalid_key", "A MaruMori API key must be a non-empty printable string")), nil
		}
		return nil, err
	}
	st, err := svc.Status(ctx)
	if err != nil {
		return nil, err
	}
	return api.SetMaruMoriKey200JSONResponse(maruMoriStatusView(st)), nil
}

func (s *server) DeleteMaruMoriKey(ctx context.Context, _ api.DeleteMaruMoriKeyRequestObject) (api.DeleteMaruMoriKeyResponseObject, error) {
	svc, err := s.maruMoriService()
	if err != nil {
		return nil, err
	}
	if err := svc.RemoveAPIKey(ctx); err != nil {
		return nil, err
	}
	return api.DeleteMaruMoriKey204Response{}, nil
}

func (s *server) SyncMaruMori(ctx context.Context, _ api.SyncMaruMoriRequestObject) (api.SyncMaruMoriResponseObject, error) {
	svc, err := s.maruMoriService()
	if err != nil {
		return nil, err
	}
	run, err := svc.Sync(ctx)
	switch {
	case errors.Is(err, marumorisync.ErrNoKey):
		return api.SyncMaruMori400JSONResponse(apiErr("no_key", "Add your MaruMori API key in Settings first")), nil
	case errors.Is(err, marumorisync.ErrSyncRunning):
		return api.SyncMaruMori409JSONResponse(apiErr("sync_running", "A Sync is already running")), nil
	case err != nil:
		return nil, err
	}
	// A failed Sync arrives here as a finished run: the reason is data, not an HTTP error.
	return api.SyncMaruMori200JSONResponse(maruMoriRunView(run)), nil
}

func (s *server) ListMaruMoriSyncs(ctx context.Context, _ api.ListMaruMoriSyncsRequestObject) (api.ListMaruMoriSyncsResponseObject, error) {
	svc, err := s.maruMoriService()
	if err != nil {
		return nil, err
	}
	runs, err := svc.RecentSyncs(ctx)
	if err != nil {
		return nil, err
	}
	out := make(api.ListMaruMoriSyncs200JSONResponse, len(runs))
	for i, run := range runs {
		out[i] = maruMoriRunView(run)
	}
	return out, nil
}
