package httpapi_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/itemlist"
)

// memItemListStore is the in-memory stand-in for the item-list persistence
// (the Postgres behaviour is covered in internal/itemlist). Vocabulary ref
// "4026" is the only Known Item.
type memItemListStore struct {
	lists    map[uuid.UUID]*itemlist.List // by id
	owner    map[uuid.UUID]uuid.UUID      // list -> user
	order    []uuid.UUID
	defaults map[uuid.UUID]uuid.UUID // user -> configured default (Nil = unset)
	items    map[uuid.UUID][]itemlist.ItemKey
	signals  []itemlist.ReaderSignal
}

func newMemItemListStore() *memItemListStore {
	return &memItemListStore{
		lists:    map[uuid.UUID]*itemlist.List{},
		owner:    map[uuid.UUID]uuid.UUID{},
		defaults: map[uuid.UUID]uuid.UUID{},
		items:    map[uuid.UUID][]itemlist.ItemKey{},
	}
}

func (m *memItemListStore) userLists(userID uuid.UUID) []*itemlist.List {
	var out []*itemlist.List
	for _, id := range m.order {
		if l := m.lists[id]; l != nil && m.owner[id] == userID {
			out = append(out, l)
		}
	}
	return out
}

func (m *memItemListStore) EnsureSaved(_ context.Context, userID uuid.UUID) (uuid.UUID, error) {
	for _, l := range m.userLists(userID) {
		if strings.EqualFold(l.Name, itemlist.SavedListName) {
			return l.ID, nil
		}
	}
	id := uuid.New()
	m.lists[id] = &itemlist.List{ID: id, Name: itemlist.SavedListName, Boosting: true}
	m.owner[id] = userID
	m.order = append(m.order, id)
	return id, nil
}

func (m *memItemListStore) DefaultID(_ context.Context, userID uuid.UUID) (uuid.UUID, bool, error) {
	id, ok := m.defaults[userID]
	return id, ok && id != uuid.Nil, nil
}

func (m *memItemListStore) SetDefaultID(_ context.Context, userID, listID uuid.UUID) error {
	m.defaults[userID] = listID
	return nil
}

func (m *memItemListStore) Lists(_ context.Context, userID uuid.UUID) ([]itemlist.List, error) {
	var out []itemlist.List
	for _, l := range m.userLists(userID) {
		cp := *l
		cp.ItemCount = len(m.items[l.ID])
		out = append(out, cp)
	}
	return out, nil
}

func (m *memItemListStore) Insert(_ context.Context, userID uuid.UUID, name string, boosting bool) (uuid.UUID, error) {
	id := uuid.New()
	m.lists[id] = &itemlist.List{ID: id, Name: name, Boosting: boosting}
	m.owner[id] = userID
	m.order = append(m.order, id)
	return id, nil
}

func (m *memItemListStore) Update(_ context.Context, userID, listID uuid.UUID, name string, boosting bool) error {
	l := m.lists[listID]
	if l == nil {
		return itemlist.ErrListNotFound
	}
	l.Name, l.Boosting = name, boosting
	return nil
}

func (m *memItemListStore) Delete(_ context.Context, userID, listID uuid.UUID) error {
	if m.lists[listID] == nil {
		return itemlist.ErrListNotFound
	}
	delete(m.lists, listID)
	delete(m.items, listID)
	if m.defaults[userID] == listID {
		delete(m.defaults, userID)
	}
	return nil
}

func (m *memItemListStore) ByName(_ context.Context, userID uuid.UUID, name string) (itemlist.List, bool, error) {
	for _, l := range m.userLists(userID) {
		if strings.EqualFold(l.Name, name) {
			cp := *l
			return cp, true, nil
		}
	}
	return itemlist.List{}, false, nil
}

func (m *memItemListStore) ByID(_ context.Context, userID, listID uuid.UUID) (itemlist.List, bool, error) {
	for _, l := range m.userLists(userID) {
		if l.ID == listID {
			cp := *l
			cp.ItemCount = len(m.items[l.ID])
			return cp, true, nil
		}
	}
	return itemlist.List{}, false, nil
}

func (m *memItemListStore) AddItem(_ context.Context, userID, listID uuid.UUID, item itemlist.ItemKey) error {
	for _, it := range m.items[listID] {
		if it == item {
			return nil
		}
	}
	m.items[listID] = append(m.items[listID], item)
	return nil
}

func (m *memItemListStore) RemoveItem(_ context.Context, userID, listID uuid.UUID, item itemlist.ItemKey) error {
	kept := m.items[listID][:0]
	for _, it := range m.items[listID] {
		if it != item {
			kept = append(kept, it)
		}
	}
	m.items[listID] = kept
	return nil
}

func (m *memItemListStore) IsKnownItem(_ context.Context, userID uuid.UUID, item itemlist.ItemKey) (bool, error) {
	return item.Kind == itemlist.KindVocabulary && item.Ref == "4026", nil
}

func (m *memItemListStore) AppendWeakSignal(_ context.Context, userID uuid.UUID, item itemlist.ItemKey, reason string) error {
	m.signals = append(m.signals, itemlist.ReaderSignal{Item: item, Reason: reason})
	return nil
}

func newServerWithLists(t *testing.T) (*httptest.Server, *memItemListStore) {
	t.Helper()
	tok, err := authtoken.New(secret, 2*time.Hour)
	if err != nil {
		t.Fatalf("authtoken.New: %v", err)
	}
	svc := auth.NewService(newMemStore(), tok, auth.Config{BcryptCost: 4, BootstrapEmail: "learner@example.com"})
	store := newMemItemListStore()
	srv := httpapi.New(fakeDB{}, svc, httpapi.WithItemLists(itemlist.NewService(store)))
	return httptest.NewServer(srv.Handler()), store
}

func listsOf(t *testing.T, body []byte) []map[string]any {
	t.Helper()
	var v struct {
		Lists []map[string]any `json:"lists"`
	}
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("decode lists: %v", err)
	}
	return v.Lists
}

func TestItemListCRUDRoundTrip(t *testing.T) {
	srv, _ := newServerWithLists(t)
	auth := registerAndVerify(t, srv)

	// The first read seeds Saved: boosting, and the effective default.
	_, body := req(t, srv, http.MethodGet, "/item-lists", "", auth)
	lists := listsOf(t, body)
	if len(lists) != 1 {
		t.Fatalf("want 1 seeded list, got %d: %s", len(lists), body)
	}
	savedID := lists[0]["listId"].(string)
	if lists[0]["name"] != "Saved" || lists[0]["boosting"] != true || lists[0]["isDefault"] != true {
		t.Errorf("Saved seed wrong: %v", lists[0])
	}

	// Create a second list and make it the default.
	_, body = req(t, srv, http.MethodPost, "/item-lists", `{"name":"Shaky verbs","boosting":true}`, auth)
	var created struct {
		List map[string]any `json:"list"`
	}
	if err := json.Unmarshal(body, &created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	shakyID := created.List["listId"].(string)

	code, _ := req(t, srv, http.MethodPost, "/item-lists", `{"name":"shaky verbs"}`, auth)
	if code != http.StatusConflict {
		t.Errorf("case-insensitive duplicate: got %d, want 409", code)
	}

	code, _ = req(t, srv, http.MethodPut, "/item-lists/default", `{"listId":"`+shakyID+`"}`, auth)
	if code != http.StatusOK {
		t.Fatalf("set default: got %d, want 200", code)
	}
	_, body = req(t, srv, http.MethodGet, "/item-lists", "", auth)
	for _, l := range listsOf(t, body) {
		switch l["listId"] {
		case shakyID:
			if l["isDefault"] != true {
				t.Errorf("new default not flagged: %v", l)
			}
		case savedID:
			if l["isDefault"] != false {
				t.Errorf("Saved still default: %v", l)
			}
		}
	}

	// Saved cannot be renamed or deleted; other lists can be updated and deleted.
	code, _ = req(t, srv, http.MethodPut, "/item-lists/"+savedID, `{"name":"Archive"}`, auth)
	if code != http.StatusBadRequest {
		t.Errorf("rename Saved: got %d, want 400", code)
	}
	code, _ = req(t, srv, http.MethodDelete, "/item-lists/"+savedID, "", auth)
	if code != http.StatusBadRequest {
		t.Errorf("delete Saved: got %d, want 400", code)
	}
	code, _ = req(t, srv, http.MethodPut, "/item-lists/"+shakyID, `{"name":"Shaky verbs","boosting":false}`, auth)
	if code != http.StatusOK {
		t.Fatalf("update list: got %d, want 200", code)
	}
	code, _ = req(t, srv, http.MethodDelete, "/item-lists/"+shakyID, "", auth)
	if code != http.StatusOK {
		t.Fatalf("delete list: got %d, want 200", code)
	}
	code, _ = req(t, srv, http.MethodDelete, "/item-lists/"+uuid.NewString(), "", auth)
	if code != http.StatusNotFound {
		t.Errorf("delete unknown: got %d, want 404", code)
	}
	code, _ = req(t, srv, http.MethodDelete, "/item-lists/not-a-uuid", "", auth)
	if code != http.StatusNotFound {
		t.Errorf("malformed list id: got %d, want 404", code)
	}
}

func TestItemListItemsAndSignals(t *testing.T) {
	srv, store := newServerWithLists(t)
	auth := registerAndVerify(t, srv)

	_, body := req(t, srv, http.MethodGet, "/item-lists", "", auth)
	savedID := listsOf(t, body)[0]["listId"].(string)

	// Saving a Known item into the (boosting) Saved list records the
	// server-side boosting_list Weak Signal.
	code, _ := req(t, srv, http.MethodPost, "/item-lists/"+savedID+"/items",
		`{"itemKind":"vocabulary","itemRef":"4026"}`, auth)
	if code != http.StatusOK {
		t.Fatalf("add item: got %d, want 200", code)
	}
	if len(store.signals) != 1 || store.signals[0].Reason != itemlist.SignalBoostingList {
		t.Errorf("boosting signal not recorded: %+v", store.signals)
	}
	_, body = req(t, srv, http.MethodGet, "/item-lists", "", auth)
	if got := listsOf(t, body)[0]["itemCount"]; got != float64(1) {
		t.Errorf("itemCount after add: %v, want 1", got)
	}

	// A non-Known item saves without the signal (it becomes a Stretch Item).
	code, _ = req(t, srv, http.MethodPost, "/item-lists/"+savedID+"/items",
		`{"itemKind":"kanji","itemRef":"食"}`, auth)
	if code != http.StatusOK {
		t.Fatalf("add unknown item: got %d, want 200", code)
	}
	if len(store.signals) != 1 {
		t.Errorf("unknown item triggered a signal: %+v", store.signals)
	}

	code, _ = req(t, srv, http.MethodPost, "/item-lists/"+savedID+"/items",
		`{"itemKind":"sentence","itemRef":"4026"}`, auth)
	if code != http.StatusBadRequest {
		t.Errorf("bad kind: got %d, want 400", code)
	}

	// Remove: DELETE carries the item as query params.
	code, _ = req(t, srv, http.MethodDelete,
		"/item-lists/"+savedID+"/items?itemKind=kanji&itemRef="+"%E9%A3%9F", "", auth)
	if code != http.StatusOK {
		t.Fatalf("remove item: got %d, want 200", code)
	}
	_, body = req(t, srv, http.MethodGet, "/item-lists", "", auth)
	if got := listsOf(t, body)[0]["itemCount"]; got != float64(1) {
		t.Errorf("itemCount after remove: %v, want 1", got)
	}
}

func TestWeakSignalsEndpoint(t *testing.T) {
	srv, store := newServerWithLists(t)
	auth := registerAndVerify(t, srv)

	// One Known item lands, the unknown one is skipped silently.
	code, body := req(t, srv, http.MethodPost, "/weak-signals",
		`{"signals":[{"itemKind":"vocabulary","itemRef":"4026","reason":"lookup"},`+
			`{"itemKind":"vocabulary","itemRef":"9999","reason":"lookup"}]}`, auth)
	if code != http.StatusOK {
		t.Fatalf("weak-signals: got %d, want 200: %s", code, body)
	}
	var out struct {
		Accepted int `json:"accepted"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Accepted != 1 || len(store.signals) != 1 {
		t.Fatalf("accepted %d, stored %+v; want 1 known only", out.Accepted, store.signals)
	}
	if store.signals[0].Reason != "lookup" {
		t.Errorf("reason stored as %q", store.signals[0].Reason)
	}

	// Client-forged boosting_list and unknown reasons are rejected.
	code, _ = req(t, srv, http.MethodPost, "/weak-signals",
		`{"signals":[{"itemKind":"vocabulary","itemRef":"4026","reason":"boosting_list"}]}`, auth)
	if code != http.StatusBadRequest {
		t.Errorf("forged reason: got %d, want 400", code)
	}
	code, _ = req(t, srv, http.MethodPost, "/weak-signals",
		`{"signals":[{"itemKind":"vocabulary","itemRef":"4026","reason":"vibes"}]}`, auth)
	if code != http.StatusBadRequest {
		t.Errorf("unknown reason: got %d, want 400", code)
	}
}

func TestReadingSettingsLookupHold(t *testing.T) {
	srv, _ := newServerWithLists(t)
	auth := registerAndVerify(t, srv)

	_, body := req(t, srv, http.MethodGet, "/reading/settings", "", auth)
	if !strings.Contains(string(body), `"lookupHoldMs":800`) {
		t.Errorf("default lookupHoldMs not 800: %s", body)
	}
	code, body := req(t, srv, http.MethodPut, "/reading/settings",
		`{"blurTranslation":false,"lookupHoldMs":1500}`, auth)
	if code != http.StatusOK || !strings.Contains(string(body), `"lookupHoldMs":1500`) {
		t.Fatalf("put round-trip: %d %s", code, body)
	}
	code, _ = req(t, srv, http.MethodPut, "/reading/settings",
		`{"blurTranslation":true,"lookupHoldMs":99999}`, auth)
	if code != http.StatusBadRequest {
		t.Errorf("out-of-range hold: got %d, want 400", code)
	}
	_, body = req(t, srv, http.MethodGet, "/reading/settings", "", auth)
	if !strings.Contains(string(body), `"lookupHoldMs":1500`) {
		t.Errorf("rejected write must not change settings: %s", body)
	}
}
