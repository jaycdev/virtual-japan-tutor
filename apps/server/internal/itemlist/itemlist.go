// Package itemlist owns the Learner's Item Lists (issue #12): named groups
// of Words, Kanji and Grammar Points the Learner assembles themselves.
// Saving a token from the story reader targets the Default List (Saved to
// start, configurable in settings); lists flagged Boosting mark their
// not-yet-Known items as Stretch Items — reserved recognition slots in
// Practice Sessions — and nudge their Mastery once. An item may sit in
// several lists at once, and one membership per list is all the boost needs.
//
// The built-in Saved list is seeded lazily: the first read or write of the
// feature guarantees it exists without a migration touching new users, and
// the effective default is COALESCE(users.default_item_list_id, Saved).
// Saved itself cannot be renamed or deleted — it is the fallback the whole
// default-resolution rule leans on.
//
// Weak Signals (issue #12's second half) land in the weak_signals table
// exactly as mastery reads it: kind, ref, free-text reason, occurred_at.
// Reader-originated signals (a dictionary lookup held past the threshold,
// an opened token menu, unblurring a Sentence Translation) arrive over the
// API; the service validates every item is the Learner's own Known Item
// before storing it, so a crafted client cannot signal arbitrary keys.
package itemlist

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Item kinds, mirroring mastery.Kind's wire spellings.
const (
	KindKanji      = "kanji"
	KindVocabulary = "vocabulary"
	KindGrammar    = "grammar"
)

// SavedListName is the built-in list every Learner starts with; it is the
// default Save target until the Learner picks another, and a Boosting List
// out of the box. Matched case-insensitively because list names are.
const SavedListName = "Saved"

// ReaderWeakSignal reasons the story reader reports (issue #12). Stored
// verbatim in weak_signals.signal; mastery's cost does not care which.
const (
	SignalLookup            = "lookup"             // a dictionary lookup held past the Learner's threshold
	SignalMenuOpen          = "menu_open"          // the token menu opened — uncertainty, even if brief
	SignalTranslationUnblur = "translation_unblur" // a blurred Sentence Translation revealed
	// SignalBoostingList is server-side: a Known Item saved into a Boosting
	// List is the Learner flagging it as shaky.
	SignalBoostingList = "boosting_list"
)

// MaxSignalsPerRequest caps one weak-signal batch: one reader sentence
// carries a handful of Focus Set items; anything much larger is a client
// bug or an attack, not a reading session.
const MaxSignalsPerRequest = 50

// MaxNameLen bounds list names.
const MaxNameLen = 60

// MaxListItems caps the member read: list management pages through a few
// hundred at most, and the join for labels stays cheap.
const MaxListItems = 500

// Error carries an HTTP status through to the handler; match with errors.As.
type Error struct {
	Status  int
	Code    string
	Message string
}

func (e *Error) Error() string { return fmt.Sprintf("%s: %s", e.Code, e.Message) }

var (
	ErrListNotFound  = &Error{Status: 404, Code: "not_found", Message: "No such item list."}
	ErrDuplicateName = &Error{Status: 409, Code: "duplicate_name", Message: "You already have a list with that name."}
	ErrReservedList  = &Error{Status: 400, Code: "reserved_list", Message: "The Saved list cannot be renamed or deleted."}
	ErrInvalidName   = &Error{Status: 400, Code: "bad_request", Message: "A list name needs 1 to 60 characters."}
	ErrInvalidKind   = &Error{Status: 400, Code: "bad_request", Message: "Item kind must be kanji, vocabulary or grammar."}

	// errUniqueName marks a Postgres unique-violation on (user_id,
	// lower(name)); the Store returns it so callers can map it to
	// ErrDuplicateName without parsing driver errors.
	errUniqueName = errors.New("itemlist: duplicate list name")
)

// ItemKey addresses one item, as everywhere else in the app: the kind plus
// a ref (ent_seq for vocabulary, the literal for kanji, the catalogue point
// id for grammar).
type ItemKey struct {
	Kind string
	Ref  string
}

// ValidKind reports whether k is one of the three item kinds.
func ValidKind(k string) bool {
	switch k {
	case KindKanji, KindVocabulary, KindGrammar:
		return true
	}
	return false
}

// List is one Item List with its live item count.
type List struct {
	ID        uuid.UUID
	Name      string
	Boosting  bool
	IsDefault bool
	ItemCount int
}

// Member is one list member with a display label: kind and ref exactly as
// writes address them, plus surface and gloss joined from the reference
// data (empty gloss when there is no reference row).
type Member struct {
	Kind    string
	Ref     string
	Surface string
	Gloss   string
}

// ReaderSignal is one reader Weak Signal: the item it is about, and why.
type ReaderSignal struct {
	Item   ItemKey
	Reason string
}

// Store is the persistence side; PostgresStore implements it and tests can
// too. Every method is scoped to userID.
type Store interface {
	// EnsureSaved creates the built-in Saved list (boosting) when the user
	// has none by that name, and returns its id.
	EnsureSaved(ctx context.Context, userID uuid.UUID) (uuid.UUID, error)
	DefaultID(ctx context.Context, userID uuid.UUID) (uuid.UUID, bool, error) // false = unset (resolve to Saved)
	SetDefaultID(ctx context.Context, userID, listID uuid.UUID) error
	Lists(ctx context.Context, userID uuid.UUID) ([]List, error)
	Insert(ctx context.Context, userID uuid.UUID, name string, boosting bool) (uuid.UUID, error)
	Update(ctx context.Context, userID, listID uuid.UUID, name string, boosting bool) error
	Delete(ctx context.Context, userID, listID uuid.UUID) error
	ByName(ctx context.Context, userID uuid.UUID, name string) (List, bool, error) // case-insensitive
	ByID(ctx context.Context, userID, listID uuid.UUID) (List, bool, error)

	AddItem(ctx context.Context, userID, listID uuid.UUID, item ItemKey) error
	RemoveItem(ctx context.Context, userID, listID uuid.UUID, item ItemKey) error
	ListItems(ctx context.Context, userID, listID uuid.UUID, limit int) ([]Member, error)

	// IsKnownItem answers the mastery question: is this the Learner's Known
	// Item (present Synced item or known grammar point)?
	IsKnownItem(ctx context.Context, userID uuid.UUID, item ItemKey) (bool, error)
	// AppendWeakSignal writes one weak_signals row.
	AppendWeakSignal(ctx context.Context, userID uuid.UUID, item ItemKey, reason string) error
}

// Service validates and orchestrates over a Store.
type Service struct{ store Store }

func NewService(store Store) *Service { return &Service{store: store} }

// normalizedName trims and enforces the length bound; "" is invalid.
func normalizedName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if n == "" || len([]rune(n)) > MaxNameLen {
		return "", ErrInvalidName
	}
	return n, nil
}

func isSaved(name string) bool { return strings.EqualFold(name, SavedListName) }

func validItem(item ItemKey) error {
	if !ValidKind(item.Kind) || strings.TrimSpace(item.Ref) == "" {
		return ErrInvalidKind
	}
	return nil
}

// isReaderReason accepts only the three reader reasons — boosting_list is
// written server-side by AddItem, never accepted from a client.
func isReaderReason(r string) bool {
	switch r {
	case SignalLookup, SignalMenuOpen, SignalTranslationUnblur:
		return true
	}
	return false
}

// Lists returns the Learner's lists (Saved always present), with IsDefault
// marking the effective default — the configured pick, or Saved when unset.
func (s *Service) Lists(ctx context.Context, userID uuid.UUID) ([]List, uuid.UUID, error) {
	savedID, err := s.store.EnsureSaved(ctx, userID)
	if err != nil {
		return nil, uuid.Nil, err
	}
	defID, ok, err := s.store.DefaultID(ctx, userID)
	if err != nil {
		return nil, uuid.Nil, err
	}
	if !ok {
		defID = savedID
	}
	lists, err := s.store.Lists(ctx, userID)
	if err != nil {
		return nil, uuid.Nil, err
	}
	for i := range lists {
		lists[i].IsDefault = lists[i].ID == defID
	}
	return lists, defID, nil
}

// DefaultListID resolves the effective Save target (issue #12: the Default
// List, Saved until configured otherwise).
func (s *Service) DefaultListID(ctx context.Context, userID uuid.UUID) (uuid.UUID, error) {
	if id, ok, err := s.store.DefaultID(ctx, userID); err != nil {
		return uuid.Nil, err
	} else if ok {
		return id, nil
	}
	return s.store.EnsureSaved(ctx, userID)
}

// Current fetches one list by id for the caller's user, so a partial update
// can keep the values the request omitted.
func (s *Service) Current(ctx context.Context, userID, listID uuid.UUID) (List, bool, error) {
	return s.store.ByID(ctx, userID, listID)
}

// Create adds a new list. Names are unique per Learner case-insensitively.
func (s *Service) Create(ctx context.Context, userID uuid.UUID, name string, boosting bool) (List, error) {
	n, err := normalizedName(name)
	if err != nil {
		return List{}, err
	}
	if _, found, err := s.store.ByName(ctx, userID, n); err != nil {
		return List{}, err
	} else if found {
		return List{}, ErrDuplicateName
	}
	id, err := s.store.Insert(ctx, userID, n, boosting)
	if err != nil {
		// Close the check-insert race onto the same answer.
		if errors.Is(err, errUniqueName) || errors.Is(err, ErrDuplicateName) {
			return List{}, ErrDuplicateName
		}
		return List{}, err
	}
	return List{ID: id, Name: n, Boosting: boosting}, nil
}

// Update renames and/or re-flags a list. Saved keeps its name forever (it is
// the fallback default); its boosting flag is the Learner's to change.
func (s *Service) Update(ctx context.Context, userID, listID uuid.UUID, name string, boosting bool) (List, error) {
	cur, found, err := s.store.ByID(ctx, userID, listID)
	if err != nil {
		return List{}, err
	}
	if !found {
		return List{}, ErrListNotFound
	}
	n := cur.Name
	if name != "" {
		n, err = normalizedName(name)
		if err != nil {
			return List{}, err
		}
	}
	if isSaved(cur.Name) && !isSaved(n) {
		return List{}, ErrReservedList
	}
	if !strings.EqualFold(n, cur.Name) {
		if _, taken, err := s.store.ByName(ctx, userID, n); err != nil {
			return List{}, err
		} else if taken {
			return List{}, ErrDuplicateName
		}
	}
	if err := s.store.Update(ctx, userID, listID, n, boosting); err != nil {
		// A race past the ByName pre-check still answers duplicate_name.
		if errors.Is(err, errUniqueName) || errors.Is(err, ErrDuplicateName) {
			return List{}, ErrDuplicateName
		}
		return List{}, err
	}
	return List{ID: listID, Name: n, Boosting: boosting, IsDefault: cur.IsDefault}, nil
}

// Delete drops a list and its memberships. Saved survives: it is the
// fallback every default resolution returns to.
func (s *Service) Delete(ctx context.Context, userID, listID uuid.UUID) error {
	cur, found, err := s.store.ByID(ctx, userID, listID)
	if err != nil {
		return err
	}
	if !found {
		return ErrListNotFound
	}
	if isSaved(cur.Name) {
		return ErrReservedList
	}
	return s.store.Delete(ctx, userID, listID)
}

// SetDefault points the Learner's Save target at another list.
func (s *Service) SetDefault(ctx context.Context, userID, listID uuid.UUID) error {
	if _, found, err := s.store.ByID(ctx, userID, listID); err != nil {
		return err
	} else if !found {
		return ErrListNotFound
	}
	return s.store.SetDefaultID(ctx, userID, listID)
}

// AddItem places an item in one list (it may already sit in others). When
// the list is a Boosting List and the item is already Known, the save also
// records a Weak Signal: putting a Known item on a boosting list is the
// Learner saying "this one still feels shaky" — the same uncertainty as a
// held lookup, and it counts once per save.
func (s *Service) AddItem(ctx context.Context, userID, listID uuid.UUID, item ItemKey) error {
	list, found, err := s.store.ByID(ctx, userID, listID)
	if err != nil {
		return err
	}
	if !found {
		return ErrListNotFound
	}
	if err := validItem(item); err != nil {
		return err
	}
	if err := s.store.AddItem(ctx, userID, listID, item); err != nil {
		return err
	}
	// The boosting flag is the row's, not the name's: Saved starts boosting
	// but the Learner may have turned it off.
	if list.Boosting {
		known, err := s.store.IsKnownItem(ctx, userID, item)
		if err != nil {
			return err
		}
		if known {
			return s.store.AppendWeakSignal(ctx, userID, item, "boosting_list")
		}
	}
	return nil
}

// RemoveItem drops one membership; other lists holding the item are
// untouched.
func (s *Service) RemoveItem(ctx context.Context, userID, listID uuid.UUID, item ItemKey) error {
	if _, found, err := s.store.ByID(ctx, userID, listID); err != nil {
		return err
	} else if !found {
		return ErrListNotFound
	}
	if err := validItem(item); err != nil {
		return err
	}
	return s.store.RemoveItem(ctx, userID, listID, item)
}

// Members reads a list's members with display labels (issue #12 list
// management). The list must belong to the caller; reads are capped at
// MaxListItems, ordered by kind then ref.
func (s *Service) Members(ctx context.Context, userID, listID uuid.UUID) ([]Member, error) {
	if _, found, err := s.store.ByID(ctx, userID, listID); err != nil {
		return nil, err
	} else if !found {
		return nil, ErrListNotFound
	}
	return s.store.ListItems(ctx, userID, listID, MaxListItems)
}

// WriteReaderSignals stores Weak Signals the story reader reported (issue
// #12): a lookup held past the Learner's threshold, an opened token menu, or
// an unblurred Sentence Translation. Trust decision (documented for the
// ticket): these arrive from the client, which knows only what the server
// already showed it — but a malicious client could invent keys. The gate is
// therefore server-side: every item must be one of this Learner's Known
// Items (the same question mastery asks), and unknown keys are dropped
// silently. That is exactly the population Weak Signals may legitimately
// mark — signals about items with no dictionary history — and the score
// cost is bounded by mastery's clamps, so even a compliant client spamming
// within the batch cap cannot zero an item beyond 0.
func (s *Service) WriteReaderSignals(ctx context.Context, userID uuid.UUID, signals []ReaderSignal) error {
	if len(signals) > MaxSignalsPerRequest {
		return &Error{Status: 400, Code: "bad_request",
			Message: fmt.Sprintf("At most %d signals per request.", MaxSignalsPerRequest)}
	}
	for _, sig := range signals {
		if err := validItem(sig.Item); err != nil {
			return err
		}
		if !isReaderReason(sig.Reason) {
			return &Error{Status: 400, Code: "bad_request",
				Message: "Signal reason must be lookup, menu_open or translation_unblur."}
		}
	}
	for _, sig := range signals {
		known, err := s.store.IsKnownItem(ctx, userID, sig.Item)
		if err != nil {
			return err
		}
		if !known {
			continue // not a Known Item: no dictionary state to be uncertain about
		}
		if err := s.store.AppendWeakSignal(ctx, userID, sig.Item, sig.Reason); err != nil {
			return err
		}
	}
	return nil
}
