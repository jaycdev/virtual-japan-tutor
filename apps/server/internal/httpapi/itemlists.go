package httpapi

import (
	"context"
	"errors"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/itemlist"
)

// WithItemLists enables the /item-lists and /weak-signals routes (issue #12:
// Item Lists, Boosting Lists and the reader's Weak Signals).
func WithItemLists(svc *itemlist.Service) Option { return func(s *server) { s.itemLists = svc } }

func (s *server) itemListService() (*itemlist.Service, error) {
	if s.itemLists == nil {
		return nil, errors.New("item list service is not configured")
	}
	return s.itemLists, nil
}

// asItemListError unwraps the service's status-carrying error. A foreign
// error is returned to the strict handler, which answers 500.
func asItemListError(err error) (*itemlist.Error, bool) {
	var iErr *itemlist.Error
	if errors.As(err, &iErr) {
		return iErr, true
	}
	return nil, false
}

// itemListID parses the path param. Like story ids, the spec declares it a
// plain string (path params bind before auth runs), so a malformed id must
// read exactly like a foreign one: both are 404.
func itemListID(raw string) (uuid.UUID, bool) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

func itemListView(l itemlist.List) api.ItemList {
	return api.ItemList{
		Id:        openapi_types.UUID(l.ID),
		Name:      l.Name,
		Boosting:  l.Boosting,
		IsDefault: l.IsDefault,
		ItemCount: l.ItemCount,
	}
}

// GetItemLists lists the Learner's Item Lists; the first call also seeds the
// built-in Saved list, and isDefault marks the effective Save target.
func (s *server) GetItemLists(ctx context.Context, request api.GetItemListsRequestObject) (api.GetItemListsResponseObject, error) {
	svc, err := s.itemListService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	lists, defID, err := svc.Lists(ctx, id.ID)
	if err != nil {
		return nil, err
	}
	views := make([]api.ItemList, 0, len(lists))
	for _, l := range lists {
		views = append(views, itemListView(l))
	}
	return api.GetItemLists200JSONResponse{
		DefaultListId: openapi_types.UUID(defID),
		Items:         views,
	}, nil
}

// CreateItemLists adds a list; names are unique per Learner ignoring case.
func (s *server) CreateItemLists(ctx context.Context, request api.CreateItemListsRequestObject) (api.CreateItemListsResponseObject, error) {
	svc, err := s.itemListService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	if request.Body == nil {
		return api.CreateItemLists400JSONResponse{Code: "bad_request", Message: "A list needs a name."}, nil
	}
	list, err := svc.Create(ctx, id.ID, request.Body.Name, request.Body.Boosting)
	if err != nil {
		if iErr, is := asItemListError(err); is {
			switch iErr.Status {
			case 409:
				return api.CreateItemLists409JSONResponse{Code: iErr.Code, Message: iErr.Message}, nil
			case 400:
				return api.CreateItemLists400JSONResponse{Code: iErr.Code, Message: iErr.Message}, nil
			}
		}
		return nil, err
	}
	return api.CreateItemLists201JSONResponse(itemListView(list)), nil
}

// SetDefaultItemList points every one-tap Save at another list.
func (s *server) SetDefaultItemList(ctx context.Context, request api.SetDefaultItemListRequestObject) (api.SetDefaultItemListResponseObject, error) {
	svc, err := s.itemListService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	if request.Body == nil {
		return api.SetDefaultItemList404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
	}
	if err := svc.SetDefault(ctx, id.ID, uuid.UUID(request.Body.ListId)); err != nil {
		if iErr, is := asItemListError(err); is && iErr.Status == 404 {
			return api.SetDefaultItemList404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
		}
		return nil, err
	}
	return api.SetDefaultItemList204Response{}, nil
}

// UpdateItemList renames and/or re-flags a list. Saved keeps its name.
func (s *server) UpdateItemList(ctx context.Context, request api.UpdateItemListRequestObject) (api.UpdateItemListResponseObject, error) {
	svc, err := s.itemListService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	lid, ok := itemListID(request.ListId)
	if !ok {
		return api.UpdateItemList404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
	}
	cur, found, err := svc.Current(ctx, id.ID, lid)
	if err != nil {
		return nil, err
	}
	if !found {
		return api.UpdateItemList404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
	}
	var (
		name     string // "" tells the service to keep the current name
		boosting = cur.Boosting
	)
	if request.Body != nil {
		if request.Body.Name != nil {
			name = *request.Body.Name
		}
		if request.Body.Boosting != nil {
			boosting = *request.Body.Boosting
		}
	}
	list, err := svc.Update(ctx, id.ID, lid, name, boosting)
	if err != nil {
		if iErr, is := asItemListError(err); is {
			switch iErr.Status {
			case 404:
				return api.UpdateItemList404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
			case 409:
				return api.UpdateItemList409JSONResponse{Code: iErr.Code, Message: iErr.Message}, nil
			case 400:
				return api.UpdateItemList400JSONResponse{Code: iErr.Code, Message: iErr.Message}, nil
			}
		}
		return nil, err
	}
	return api.UpdateItemList200JSONResponse(itemListView(list)), nil
}

// DeleteItemList drops a list and its memberships; Saved refuses with 400.
func (s *server) DeleteItemList(ctx context.Context, request api.DeleteItemListRequestObject) (api.DeleteItemListResponseObject, error) {
	svc, err := s.itemListService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	lid, ok := itemListID(request.ListId)
	if !ok {
		return api.DeleteItemList404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
	}
	if err := svc.Delete(ctx, id.ID, lid); err != nil {
		if iErr, is := asItemListError(err); is {
			switch iErr.Status {
			case 404:
				return api.DeleteItemList404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
			case 400:
				return api.DeleteItemList400JSONResponse{Code: iErr.Code, Message: iErr.Message}, nil
			}
		}
		return nil, err
	}
	return api.DeleteItemList204Response{}, nil
}

// AddItemToList handles the reader's Save: the item lands in the list, and a
// Known item saved into a Boosting List also records the boosting_list Weak
// Signal (service-side).
func (s *server) AddItemToList(ctx context.Context, request api.AddItemToListRequestObject) (api.AddItemToListResponseObject, error) {
	svc, err := s.itemListService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	lid, ok := itemListID(request.ListId)
	if !ok {
		return api.AddItemToList404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
	}
	if request.Body == nil {
		return api.AddItemToList400JSONResponse{Code: "bad_request", Message: "itemKind and itemRef are required"}, nil
	}
	item := itemlist.ItemKey{Kind: string(request.Body.ItemKind), Ref: request.Body.ItemRef}
	if err := svc.AddItem(ctx, id.ID, lid, item); err != nil {
		if iErr, is := asItemListError(err); is {
			switch iErr.Status {
			case 404:
				return api.AddItemToList404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
			case 400:
				return api.AddItemToList400JSONResponse{Code: iErr.Code, Message: iErr.Message}, nil
			}
		}
		return nil, err
	}
	return api.AddItemToList204Response{}, nil
}

// RemoveItemListItems drops one membership; the item stays in every other
// list holding it. DELETE carries the item as query params.
func (s *server) RemoveItemListItems(ctx context.Context, request api.RemoveItemListItemsRequestObject) (api.RemoveItemListItemsResponseObject, error) {
	svc, err := s.itemListService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	lid, ok := itemListID(request.ListId)
	if !ok {
		return api.RemoveItemListItems404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
	}
	// The query pair is spec-optional (so 401 beats 400 on this route) but
	// semantically required: a missing half is a 400.
	if request.Params.ItemKind == nil || request.Params.ItemRef == nil || *request.Params.ItemRef == "" {
		return api.RemoveItemListItems400JSONResponse{Code: "bad_request", Message: "itemKind and itemRef are required"}, nil
	}
	item := itemlist.ItemKey{Kind: string(*request.Params.ItemKind), Ref: *request.Params.ItemRef}
	if err := svc.RemoveItem(ctx, id.ID, lid, item); err != nil {
		if iErr, is := asItemListError(err); is {
			switch iErr.Status {
			case 404:
				return api.RemoveItemListItems404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
			case 400:
				return api.RemoveItemListItems400JSONResponse{Code: iErr.Code, Message: iErr.Message}, nil
			}
		}
		return nil, err
	}
	return api.RemoveItemListItems204Response{}, nil
}

// GetItemListItems lists one list's members with display labels (issue #12
// list management): the service checks ownership and caps the read.
func (s *server) GetItemListItems(ctx context.Context, request api.GetItemListItemsRequestObject) (api.GetItemListItemsResponseObject, error) {
	svc, err := s.itemListService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	lid, ok := itemListID(request.ListId)
	if !ok {
		return api.GetItemListItems404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
	}
	members, err := svc.Members(ctx, id.ID, lid)
	if err != nil {
		if iErr, is := asItemListError(err); is && iErr.Status == 404 {
			return api.GetItemListItems404JSONResponse{NotFoundJSONResponse: notFound("no such item list")}, nil
		}
		return nil, err
	}
	items := make([]api.ItemListMember, 0, len(members))
	for _, m := range members {
		items = append(items, api.ItemListMember{
			ItemKind: api.ItemKind(m.Kind),
			ItemRef:  m.Ref,
			Surface:  m.Surface,
			Gloss:    m.Gloss,
		})
	}
	return api.GetItemListItems200JSONResponse{Items: items}, nil
}

// PostWeakSignals stores reader-originated Weak Signals. The service
// validates every item is the Learner's own Known Item and silently drops
// the rest; a forged reason is a 400.
func (s *server) PostWeakSignals(ctx context.Context, request api.PostWeakSignalsRequestObject) (api.PostWeakSignalsResponseObject, error) {
	svc, err := s.itemListService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated
	}
	if request.Body == nil {
		return api.PostWeakSignals400JSONResponse{Code: "bad_request", Message: "signals are required"}, nil
	}
	signals := make([]itemlist.ReaderSignal, 0, len(request.Body.Signals))
	for _, sig := range request.Body.Signals {
		signals = append(signals, itemlist.ReaderSignal{
			Item:   itemlist.ItemKey{Kind: string(sig.ItemKind), Ref: sig.ItemRef},
			Reason: string(sig.Reason),
		})
	}
	if err := svc.WriteReaderSignals(ctx, id.ID, signals); err != nil {
		if iErr, is := asItemListError(err); is && iErr.Status == 400 {
			return api.PostWeakSignals400JSONResponse{Code: iErr.Code, Message: iErr.Message}, nil
		}
		return nil, err
	}
	return api.PostWeakSignals204Response{}, nil
}
