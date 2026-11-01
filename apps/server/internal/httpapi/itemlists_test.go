package httpapi_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/itemlist"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story/storytest"
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

// listsEnv serves the real handler with the item-list feature wired over an
// in-memory itemlist.Store and the real auth.Service over authtest's store.
type listsEnv struct {
	h     http.Handler
	store *memItemListStore
	token string
}

func newListsEnv(t *testing.T) *listsEnv {
	t.Helper()
	clock := authtest.NewFakeClock()
	authn := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour, Now: clock.Now})
	if _, err := authn.CreateUser(context.Background(), "alice", password); err != nil {
		t.Fatal(err)
	}
	store := newMemItemListStore()
	storySvc := story.NewService(storytest.New(), nil, nil, nil, nil, story.Settings{}, nil)
	e := &listsEnv{h: httpapi.New(fakeDB{}, authn,
		httpapi.WithItemLists(itemlist.NewService(store)),
		httpapi.WithStory(storySvc)), store: store}
	rec := e.call(http.MethodPost, "/auth/login", `{"username":"alice","password":"`+password+`"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("login: %d %s", rec.Code, rec.Body)
	}
	var out struct {
		Token string `json:"token"`
	}
	mustJSON(t, rec, &out)
	e.token = out.Token
	return e
}

func (e *listsEnv) call(method, path, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	req.Header.Set("Authorization", "Bearer "+e.token)
	rec := httptest.NewRecorder()
	e.h.ServeHTTP(rec, req)
	return rec
}

func listsOf(t *testing.T, rec *httptest.ResponseRecorder) []map[string]any {
	t.Helper()
	var v struct {
		Items []map[string]any `json:"items"`
	}
	mustJSON(t, rec, &v)
	return v.Items
}

func TestItemListCRUDRoundTrip(t *testing.T) {
	e := newListsEnv(t)

	// The first read seeds Saved: boosting, and the effective default.
	rec := e.call(http.MethodGet, "/item-lists", "")
	lists := listsOf(t, rec)
	if len(lists) != 1 {
		t.Fatalf("want 1 seeded list, got %d: %s", len(lists), rec.Body)
	}
	savedID := lists[0]["id"].(string)
	if lists[0]["name"] != "Saved" || lists[0]["boosting"] != true || lists[0]["isDefault"] != true {
		t.Errorf("Saved seed wrong: %v", lists[0])
	}

	// Create a second list and make it the default.
	rec = e.call(http.MethodPost, "/item-lists", `{"name":"Shaky verbs","boosting":true}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var created struct {
		ID string `json:"id"`
	}
	mustJSON(t, rec, &created)
	shakyID := created.ID

	if rec = e.call(http.MethodPost, "/item-lists", `{"name":"shaky verbs"}`); rec.Code != http.StatusConflict {
		t.Errorf("case-insensitive duplicate: %d, want 409", rec.Code)
	}

	if rec = e.call(http.MethodPut, "/item-lists/default", `{"listId":"`+shakyID+`"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("set default: %d %s", rec.Code, rec.Body)
	}
	for _, l := range listsOf(t, e.call(http.MethodGet, "/item-lists", "")) {
		switch l["id"] {
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
	if rec = e.call(http.MethodPut, "/item-lists/"+savedID, `{"name":"Archive"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("rename Saved: %d, want 400", rec.Code)
	}
	if rec = e.call(http.MethodDelete, "/item-lists/"+savedID, ""); rec.Code != http.StatusBadRequest {
		t.Errorf("delete Saved: %d, want 400", rec.Code)
	}
	if rec = e.call(http.MethodPut, "/item-lists/"+shakyID, `{"name":"Shaky verbs","boosting":false}`); rec.Code != http.StatusOK {
		t.Fatalf("update list: %d %s", rec.Code, rec.Body)
	}
	if rec = e.call(http.MethodDelete, "/item-lists/"+shakyID, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete list: %d %s", rec.Code, rec.Body)
	}
	if rec = e.call(http.MethodDelete, "/item-lists/"+uuid.NewString(), ""); rec.Code != http.StatusNotFound {
		t.Errorf("delete unknown: %d, want 404", rec.Code)
	}
	if rec = e.call(http.MethodDelete, "/item-lists/not-a-uuid", ""); rec.Code != http.StatusNotFound {
		t.Errorf("malformed list id: %d, want 404", rec.Code)
	}
}

func TestItemListItemsAndSignals(t *testing.T) {
	e := newListsEnv(t)

	savedID := listsOf(t, e.call(http.MethodGet, "/item-lists", ""))[0]["id"].(string)

	// Saving a Known item into the (boosting) Saved list records the
	// server-side boosting_list Weak Signal.
	if rec := e.call(http.MethodPost, "/item-lists/"+savedID+"/items",
		`{"itemKind":"vocabulary","itemRef":"4026"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("add item: %d %s", rec.Code, rec.Body)
	}
	if len(e.store.signals) != 1 || e.store.signals[0].Reason != itemlist.SignalBoostingList {
		t.Errorf("boosting signal not recorded: %+v", e.store.signals)
	}
	if got := listsOf(t, e.call(http.MethodGet, "/item-lists", ""))[0]["itemCount"]; got != float64(1) {
		t.Errorf("itemCount after add: %v, want 1", got)
	}

	// A non-Known item saves without the signal (it becomes a Stretch Item).
	if rec := e.call(http.MethodPost, "/item-lists/"+savedID+"/items",
		`{"itemKind":"kanji","itemRef":"食"}`); rec.Code != http.StatusNoContent {
		t.Fatalf("add unknown item: %d %s", rec.Code, rec.Body)
	}
	if len(e.store.signals) != 1 {
		t.Errorf("unknown item triggered a signal: %+v", e.store.signals)
	}

	if rec := e.call(http.MethodPost, "/item-lists/"+savedID+"/items",
		`{"itemKind":"sentence","itemRef":"4026"}`); rec.Code != http.StatusBadRequest {
		t.Errorf("bad kind: %d, want 400", rec.Code)
	}

	// Remove: DELETE carries the item as query params.
	if rec := e.call(http.MethodDelete,
		"/item-lists/"+savedID+"/items?itemKind=kanji&itemRef="+"%E9%A3%9F", ""); rec.Code != http.StatusNoContent {
		t.Fatalf("remove item: %d %s", rec.Code, rec.Body)
	}
	if got := listsOf(t, e.call(http.MethodGet, "/item-lists", ""))[0]["itemCount"]; got != float64(1) {
		t.Errorf("itemCount after remove: %v, want 1", got)
	}
}

func TestWeakSignalsEndpoint(t *testing.T) {
	e := newListsEnv(t)

	// One Known item lands, the unknown one is skipped silently.
	rec := e.call(http.MethodPost, "/weak-signals",
		`{"signals":[{"itemKind":"vocabulary","itemRef":"4026","reason":"lookup"},`+
			`{"itemKind":"vocabulary","itemRef":"9999","reason":"lookup"}]}`)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("weak-signals: %d, want 204: %s", rec.Code, rec.Body)
	}
	if len(e.store.signals) != 1 {
		t.Fatalf("stored %+v; want the known item's signal only", e.store.signals)
	}
	if e.store.signals[0].Reason != "lookup" {
		t.Errorf("reason stored as %q", e.store.signals[0].Reason)
	}

	// Client-forged boosting_list and unknown reasons are rejected.
	if rec = e.call(http.MethodPost, "/weak-signals",
		`{"signals":[{"itemKind":"vocabulary","itemRef":"4026","reason":"boosting_list"}]}`); rec.Code != http.StatusBadRequest {
		t.Errorf("forged reason: %d, want 400", rec.Code)
	}
	if rec = e.call(http.MethodPost, "/weak-signals",
		`{"signals":[{"itemKind":"vocabulary","itemRef":"4026","reason":"vibes"}]}`); rec.Code != http.StatusBadRequest {
		t.Errorf("unknown reason: %d, want 400", rec.Code)
	}
}

func TestReadingSettingsLookupHold(t *testing.T) {
	e := newListsEnv(t)

	rec := e.call(http.MethodGet, "/reading-settings", "")
	if !strings.Contains(rec.Body.String(), `"lookupHoldMs":800`) {
		t.Errorf("default lookupHoldMs not 800: %s", rec.Body)
	}
	rec = e.call(http.MethodPut, "/reading-settings", `{"blurTranslation":false,"lookupHoldMs":1500}`)
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"lookupHoldMs":1500`) {
		t.Fatalf("put round-trip: %d %s", rec.Code, rec.Body)
	}
	if rec = e.call(http.MethodPut, "/reading-settings", `{"blurTranslation":true,"lookupHoldMs":99999}`); rec.Code != http.StatusBadRequest {
		t.Errorf("out-of-range hold: %d, want 400", rec.Code)
	}
	rec = e.call(http.MethodGet, "/reading-settings", "")
	if !strings.Contains(rec.Body.String(), `"lookupHoldMs":1500`) {
		t.Errorf("rejected write must not change settings: %s", rec.Body)
	}
}
