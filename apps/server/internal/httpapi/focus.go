package httpapi

import (
	"context"
	"errors"
	"math"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
)

var errFocusSetNotConfigured = errors.New("mastery service is not configured")

// focusService is the Mastery/Focus Set surface (issue #7).
func (s *server) focusService() (*mastery.Service, error) {
	if s.mastery == nil {
		return nil, errFocusSetNotConfigured
	}
	return s.mastery, nil
}

// focusSetItemView maps one ScoredItem to the spec's FocusSetItem. Mastery is
// rounded to 4 decimals: enough resolution to rank items, without exposing
// float noise from the decay maths. Kind and Source strings are the spec's
// enum members verbatim, so they convert directly.
func focusSetItemView(it mastery.ScoredItem) api.FocusSetItem {
	out := api.FocusSetItem{
		Kind:                 api.FocusSetItemKind(it.Item.Key.Kind),
		ItemRef:              it.Item.Key.Ref,
		Source:               api.FocusSetItemSource(it.Item.Source),
		Mastery:              float32(math.Round(it.Mastery*1e4) / 1e4),
		NewlyObservedGrammar: it.NewlyObservedGrammar,
	}
	if it.Item.SRSLevel != nil {
		lvl := *it.Item.SRSLevel
		out.SrsLevel = &lvl
	}
	return out
}

func (s *server) GetFocusSet(ctx context.Context, _ api.GetFocusSetRequestObject) (api.GetFocusSetResponseObject, error) {
	svc, err := s.focusService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated // unreachable behind requireSession; fail closed
	}
	set, err := svc.FocusSet(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	items := make([]api.FocusSetItem, 0, len(set.Items))
	for _, it := range set.Items {
		items = append(items, focusSetItemView(it))
	}
	return api.GetFocusSet200JSONResponse{Size: set.Size, Items: items}, nil
}
