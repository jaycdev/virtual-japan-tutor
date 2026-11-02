// Package storytest provides an in-memory story.Store for tests of the
// packages that consume the story service — the httpapi story and reader
// routes in particular. It mirrors PostgresStore's observable behaviour
// (ownership scoping, validated-only listings, one ready Story per user,
// default preferences) without needing a database; story's own package
// tests keep the richer fake beside the generation code it exercises.
package storytest

import (
	"context"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
)

type MemStore struct {
	mu        sync.Mutex
	stories   map[uuid.UUID]*story.Story
	users     map[uuid.UUID]bool
	threshold map[uuid.UUID]int
	blur      map[uuid.UUID]bool      // missing = default true, like the users column
	lookupMs  map[uuid.UUID]int       // missing = default 800, like the users column
	prefs     map[uuid.UUID][2]string // genre, theme ("" = surprise-me / no theme)
	snapshots map[uuid.UUID][]string
	now       time.Time
}

func New() *MemStore {
	return &MemStore{
		stories:   map[uuid.UUID]*story.Story{},
		users:     map[uuid.UUID]bool{},
		threshold: map[uuid.UUID]int{},
		blur:      map[uuid.UUID]bool{},
		lookupMs:  map[uuid.UUID]int{},
		prefs:     map[uuid.UUID][2]string{},
		snapshots: map[uuid.UUID][]string{},
		now:       time.Unix(1700000000, 0).UTC(),
	}
}

// AddUser registers a user so UserIDs reports them (the background
// generator's clock).
func (s *MemStore) AddUser(userID uuid.UUID) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.users[userID] = true
}

func (s *MemStore) Save(_ context.Context, st *story.Story) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st.ID == uuid.Nil {
		st.ID = uuid.New()
	}
	if st.Origin == "" {
		st.Origin = story.OriginAutomatic // the stories.origin column default
	}
	s.now = s.now.Add(time.Second)
	st.CreatedAt = s.now
	s.stories[st.ID] = st
	s.users[st.UserID] = true
	return nil
}

func (s *MemStore) Get(_ context.Context, id, userID uuid.UUID) (*story.Story, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.get(id, userID)
}

func (s *MemStore) get(id, userID uuid.UUID) (*story.Story, error) {
	st, ok := s.stories[id]
	if !ok || st.UserID != userID {
		return nil, story.ErrNotFound
	}
	return st, nil
}

func (s *MemStore) List(_ context.Context, userID uuid.UUID, limit, offset int) ([]*story.Story, int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var mine []*story.Story
	for _, st := range s.stories {
		if st.UserID == userID && st.Validated {
			mine = append(mine, st)
		}
	}
	sort.Slice(mine, func(i, j int) bool { return mine[i].CreatedAt.After(mine[j].CreatedAt) })
	total := len(mine)
	if offset >= total {
		return nil, total, nil
	}
	end := min(offset+limit, total)
	return mine[offset:end], total, nil
}

func (s *MemStore) Rate(_ context.Context, id, userID uuid.UUID, r story.Rating) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.get(id, userID)
	if err != nil {
		return err
	}
	st.Rating = &r
	return nil
}

func (s *MemStore) RatingCounts(_ context.Context, userID uuid.UUID) (map[string]map[story.Rating]int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := map[string]map[story.Rating]int{}
	for _, st := range s.stories {
		if st.UserID != userID || st.Rating == nil {
			continue
		}
		if out[st.Genre] == nil {
			out[st.Genre] = map[story.Rating]int{}
		}
		out[st.Genre][*st.Rating]++
	}
	return out, nil
}

func (s *MemStore) ReadyStoryID(_ context.Context, userID uuid.UUID) (uuid.UUID, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, st := range s.stories {
		if st.UserID == userID && st.ReadyAt != nil {
			return st.ID, true, nil
		}
	}
	return uuid.Nil, false, nil
}

func (s *MemStore) SetReady(_ context.Context, id, userID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.get(id, userID)
	if err != nil {
		return err
	}
	now := s.now
	for _, other := range s.stories {
		if other.UserID == userID {
			other.ReadyAt = nil
		}
	}
	st.ReadyAt = &now
	return nil
}

func (s *MemStore) ClearReady(_ context.Context, id uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if st, ok := s.stories[id]; ok {
		st.ReadyAt = nil
	}
	return nil
}

func (s *MemStore) LastFailedAt(_ context.Context, userID uuid.UUID) (time.Time, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var newest *story.Story
	for _, st := range s.stories {
		if st.UserID != userID {
			continue
		}
		if newest == nil || st.CreatedAt.After(newest.CreatedAt) {
			newest = st
		}
	}
	if newest == nil || newest.Validated {
		return time.Time{}, false, nil
	}
	return newest.CreatedAt, true, nil
}

func (s *MemStore) GenresByLastActivity(_ context.Context, userID uuid.UUID, limit int) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var mine []*story.Story
	for _, st := range s.stories {
		if st.UserID == userID {
			mine = append(mine, st)
		}
	}
	sort.Slice(mine, func(i, j int) bool { return mine[i].CreatedAt.After(mine[j].CreatedAt) })
	var out []string
	for _, st := range mine {
		if len(out) >= limit {
			break
		}
		out = append(out, st.Genre)
	}
	return out, nil
}

func (s *MemStore) FuriganaThreshold(_ context.Context, userID uuid.UUID) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if v, ok := s.threshold[userID]; ok {
		return v, nil
	}
	return 3, nil // the users column default
}

func (s *MemStore) SetFuriganaThreshold(_ context.Context, userID uuid.UUID, level int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.threshold[userID] = level
	return nil
}

func (s *MemStore) BlurTranslation(_ context.Context, userID uuid.UUID) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.blur[userID]
	if !ok {
		return true, nil // the users column default
	}
	return v, nil
}

func (s *MemStore) SetBlurTranslation(_ context.Context, userID uuid.UUID, blur bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.blur[userID] = blur
	return nil
}

func (s *MemStore) LookupHoldMs(_ context.Context, userID uuid.UUID) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.lookupMs[userID]
	if !ok {
		return story.DefaultLookupHoldMs, nil // the users column default
	}
	return v, nil
}

func (s *MemStore) SetLookupHoldMs(_ context.Context, userID uuid.UUID, holdMs int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lookupMs[userID] = holdMs
	return nil
}

func (s *MemStore) StoryPrefs(_ context.Context, userID uuid.UUID) (string, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.prefs[userID]
	return p[0], p[1], nil
}

func (s *MemStore) SetStoryPrefs(_ context.Context, userID uuid.UUID, genre, theme string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.prefs[userID] = [2]string{genre, theme}
	return nil
}

func (s *MemStore) FocusSnapshot(_ context.Context, userID uuid.UUID) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshots[userID], nil
}

func (s *MemStore) SetFocusSnapshot(_ context.Context, userID uuid.UUID, keys []string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.snapshots[userID] = keys
	return nil
}

func (s *MemStore) MarkPracticed(_ context.Context, id uuid.UUID, at time.Time) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.stories[id]
	if !ok {
		return false, story.ErrNotFound
	}
	if st.PracticedAt != nil {
		return false, nil
	}
	st.PracticedAt = &at
	return true, nil
}

func (s *MemStore) ResetPracticed(_ context.Context, id uuid.UUID, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, ok := s.stories[id]
	if !ok {
		return story.ErrNotFound
	}
	if st.PracticedAt != nil && st.PracticedAt.Equal(at) {
		st.PracticedAt = nil
	}
	return nil
}

func (s *MemStore) MarkRead(_ context.Context, id, userID uuid.UUID, at time.Time) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.get(id, userID)
	if err != nil {
		return err
	}
	st.ReadAt = &at
	return nil
}

func (s *MemStore) ClearRead(_ context.Context, id, userID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	st, err := s.get(id, userID)
	if err != nil {
		return err
	}
	st.ReadAt = nil
	return nil
}

func (s *MemStore) Delete(_ context.Context, id, userID uuid.UUID) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.get(id, userID); err != nil {
		return err
	}
	delete(s.stories, id)
	return nil
}

func (s *MemStore) UserIDs(_ context.Context) ([]uuid.UUID, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []uuid.UUID
	for u := range s.users {
		out = append(out, u)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].String() < out[j].String() })
	return out, nil
}

// Compile-time proof the MemStore is a drop-in story.Store.
var _ story.Store = (*MemStore)(nil)
