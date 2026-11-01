// Package knowngrammar owns the grammar half of the Learner's knowledge state
// (issue #6, docs/adr/0003): the Starting Level declared at onboarding, the
// Seeded Grammar it derives (every Grammar Point at or below that level becomes
// a Known Item at medium Mastery), and the Observed Grammar confirmed by the
// Learner's MaruMori grammar reviews, matched to the Grammar Catalogue by
// normalised pattern and variants. Changing the Starting Level later adds and
// removes Seeded Grammar only; Observed Grammar is kept.
//
// Like internal/marumorisync it never stores item content (ADR-0002): the only
// grammar text it keeps is the pattern itself, which is a Grammar Point's
// identity and the key Catalogue Matching runs on.
package knowngrammar

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// Errors; match with errors.Is.
var (
	ErrLevelRequired       = errors.New("a starting level of N5, N4, N3, N2 or N1 is required")
	ErrPointNotFound       = errors.New("grammar point not found")
	ErrObservationNotFound = errors.New("grammar observation not found")
)

// KnownSource records why a Grammar Point is known, mirroring the
// known_grammar_points.source column: Seeded Grammar or Observed Grammar.
type KnownSource string

const (
	SourceSeeded   KnownSource = "seeded"
	SourceObserved KnownSource = "observed"
)

// Mastery is a Known Item's starting mastery band. Practice (issue #7) later
// rewrites it from the Practice Record; this package only sets the initial band.
type Mastery string

const (
	MasteryLow    Mastery = "low"
	MasteryMedium Mastery = "medium"
	MasteryHigh   Mastery = "high"
)

// Initial Mastery bands per docs/adr/0003: Seeded Grammar starts at medium,
// newly Observed Grammar starts at low so it is targeted straight away.
const (
	SeededMastery   = MasteryMedium
	ObservedMastery = MasteryLow
)

// KnownPoint is one known_grammar_points row.
type KnownPoint struct {
	PointID int64
	Source  KnownSource
	Mastery Mastery
}

// Observation is one known_grammar_observations row: a confirmed MaruMori
// grammar observation and its Catalogue Matching outcome. MatchedPoint 0 means
// unmatched; Flagged marks the entries the "review these" settings list shows.
type Observation struct {
	MaruMoriID   string
	Pattern      string
	JLPTLevel    string // MaruMori's own level for the point, "" when unstated
	MatchedPoint int64
	Flagged      bool
}

// SeededDelta reports what one Starting Level change did (issue #6: it adds and
// removes Seeded Grammar only).
type SeededDelta struct {
	Added   int
	Removed int
	Kept    int
}

// SyncResult reports one Sync's Observed Grammar work.
type SyncResult struct {
	Observed   int // confirmed observations seen
	Matched    int // observations matched to a catalogue point
	Queued     int // no catalogue match: recorded flagged for review
	Flagged    int // matched but flagged (duplicate pattern resolved without MaruMori's level)
	NewlyKnown int // catalogue points that became Known Items
}

// Store persists starting levels, known grammar points and observations. The
// Postgres implementation applies each multi-row change in one transaction.
type Store interface {
	// StartingLevel returns the Learner's declared level and whether they have
	// declared one yet.
	StartingLevel(ctx context.Context, userID uuid.UUID) (refdata.Level, bool, error)
	SetStartingLevel(ctx context.Context, userID uuid.UUID, level refdata.Level) error

	// ApplySeededPoints makes Seeded Grammar exactly pointIDs: points not yet
	// known become Known Items at SeededMastery, and rows whose only source was
	// 'seeded' and are no longer in the set are removed. Observed rows are
	// never touched, whichever way the level moved.
	ApplySeededPoints(ctx context.Context, userID uuid.UUID, pointIDs []int64) (SeededDelta, error)
	SeededPoints(ctx context.Context, userID uuid.UUID) ([]int64, error)

	// UpsertObservedPoint marks a point known by observation. An existing row
	// keeps its Mastery (Practice may already have moved it); only its source
	// is promoted to 'observed'.
	UpsertObservedPoint(ctx context.Context, userID uuid.UUID, pointID int64) error
	KnownPoint(ctx context.Context, userID uuid.UUID, pointID int64) (KnownPoint, bool, error)

	// PutObservation upserts one observation with its matching outcome.
	PutObservation(ctx context.Context, userID uuid.UUID, o Observation) error
	// Observations returns every observation recorded for the Learner, oldest
	// first (observed_at, MaruMori id as tie-break).
	Observations(ctx context.Context, userID uuid.UUID) ([]Observation, error)
	// ResolveObservation re-points an observation at a catalogue point (used
	// when a later Sync finds a match the earlier one missed).
	ResolveObservation(ctx context.Context, userID uuid.UUID, maruMoriID string, pointID int64, flagged bool) error
}

// Catalogue is the read-only Grammar Catalogue side of matching.
// *refdata.Store implements it.
type Catalogue interface {
	// GrammarPointIDsAtOrBelow returns every catalogue point at or below level,
	// N5 being the easiest end.
	GrammarPointIDsAtOrBelow(ctx context.Context, level refdata.Level) ([]int64, error)
	// GrammarPointsByNormalisedPattern returns every point whose normalised pattern or
	// normalised variant equals normalised — one per Level and ordinal, so a
	// pattern listed at two levels comes back twice (the だけ case, issue #6).
	GrammarPointsByNormalisedPattern(ctx context.Context, normalised string) ([]refdata.GrammarPoint, error)
}

// Normaliser turns a pattern as MaruMori wrote it into the catalogue's
// normalised form. refdata.NormalisePattern is the implementation the import
// uses, so matching and the catalogue normalise identically.
type Normaliser func(string) string

// Service is the orchestration layer handlers and Sync call.
type Service struct {
	store     Store
	catalogue Catalogue
	normalise Normaliser
}

func NewService(store Store, catalogue Catalogue, normalise Normaliser) *Service {
	return &Service{store: store, catalogue: catalogue, normalise: normalise}
}

// *refdata.Store is the production Catalogue.
var _ Catalogue = (*refdata.Store)(nil)

// StartingLevel reports the Learner's declared Starting Level.
func (s *Service) StartingLevel(ctx context.Context, userID uuid.UUID) (refdata.Level, bool, error) {
	return s.store.StartingLevel(ctx, userID)
}

// Observations returns the Learner's stored grammar observations, for the
// settings "review these" list (issue #6).
func (s *Service) Observations(ctx context.Context, userID uuid.UUID) ([]Observation, error) {
	return s.store.Observations(ctx, userID)
}

// SetStartingLevel records the onboarding choice and applies Seeded Grammar:
// every point at or below the level becomes a Known Item at medium Mastery.
func (s *Service) SetStartingLevel(ctx context.Context, userID uuid.UUID, level refdata.Level) (SeededDelta, error) {
	if !validLevel(level) {
		return SeededDelta{}, ErrLevelRequired
	}
	if err := s.store.SetStartingLevel(ctx, userID, level); err != nil {
		return SeededDelta{}, err
	}
	ids, err := s.catalogue.GrammarPointIDsAtOrBelow(ctx, level)
	if err != nil {
		return SeededDelta{}, err
	}
	return s.store.ApplySeededPoints(ctx, userID, ids)
}

// SyncObserved applies the confirmed MaruMori grammar observations of one Sync
// (issue #6): each is matched to the catalogue and, when matched, becomes a
// Known Item at low Mastery. Unmatched observations are recorded flagged so the
// settings "review these" list can show them and the next Sync can retry them
// once the catalogue has gained the point.
func (s *Service) SyncObserved(ctx context.Context, userID uuid.UUID, observations []marumori.GrammarObservation) (SyncResult, error) {
	var res SyncResult
	for _, obs := range observations {
		res.Observed++
		level := obs.JLPTLevel
		if !validLevel(refdata.Level(level)) {
			level = ""
		}
		match, err := s.match(ctx, obs.Pattern, level)
		if err != nil {
			return res, err
		}
		// No match at all is flagged too: it lands on the "review these" list
		// as the candidate for a new catalogue entry (issue #6).
		flagged := match.flagged || match.pointID == 0
		o := Observation{
			MaruMoriID:   obs.MaruMoriID,
			Pattern:      obs.Pattern,
			JLPTLevel:    level,
			MatchedPoint: match.pointID,
			Flagged:      flagged,
		}
		if err := s.store.PutObservation(ctx, userID, o); err != nil {
			return res, err
		}
		if match.pointID == 0 {
			res.Queued++
			continue
		}
		res.Matched++
		if match.flagged {
			res.Flagged++
		}
		known, err := s.markKnown(ctx, userID, match.pointID)
		if err != nil {
			return res, err
		}
		res.NewlyKnown += known
	}

	rematched, err := s.rematchPending(ctx, userID)
	if err != nil {
		return res, err
	}
	res.Matched += rematched.Matched
	res.Flagged += rematched.Flagged
	res.NewlyKnown += rematched.NewlyKnown
	return res, nil
}

// rematchPending re-runs matching for observations that had no match when they
// were first seen: the Learner may have added the missing point to the
// catalogue since.
func (s *Service) rematchPending(ctx context.Context, userID uuid.UUID) (SyncResult, error) {
	var res SyncResult
	all, err := s.store.Observations(ctx, userID)
	if err != nil {
		return res, err
	}
	for _, o := range all {
		if o.MatchedPoint != 0 || o.Pattern == "" {
			continue
		}
		match, err := s.match(ctx, o.Pattern, o.JLPTLevel)
		if err != nil {
			return res, err
		}
		if match.pointID == 0 {
			// Still no catalogue entry for it: it stays flagged on the
			// "review these" list for the next Sync, but it must not stop
			// the other pending observations from being re-matched.
			continue
		}
		if err := s.store.ResolveObservation(ctx, userID, o.MaruMoriID, match.pointID, match.flagged); err != nil {
			return res, err
		}
		res.Matched++
		if match.flagged {
			res.Flagged++
		}
		known, err := s.markKnown(ctx, userID, match.pointID)
		if err != nil {
			return res, err
		}
		res.NewlyKnown += known
	}
	return res, nil
}

// markKnown marks a matched point known by observation and reports whether that
// made it newly known.
func (s *Service) markKnown(ctx context.Context, userID uuid.UUID, pointID int64) (int, error) {
	_, existed, err := s.store.KnownPoint(ctx, userID, pointID)
	if err != nil {
		return 0, err
	}
	if err := s.store.UpsertObservedPoint(ctx, userID, pointID); err != nil {
		return 0, err
	}
	if existed {
		return 0, nil
	}
	return 1, nil
}

// matchOutcome is one Catalogue Matching decision.
type matchOutcome struct {
	pointID int64 // 0 = no match
	flagged bool
}

// match implements the issue #6 rules: exact match on the normalised pattern or
// a variant; when the pattern exists at two levels, MaruMori's level wins if
// the catalogue has that level, otherwise the lowest level is used and the
// match is flagged for review; two points sharing a level and pattern (the
// catalogue's ordinal duplicates) resolve to the lowest ordinal, also flagged;
// no match at all leaves pointID 0, and SyncObserved records that flagged.
func (s *Service) match(ctx context.Context, pattern, maruMoriLevel string) (matchOutcome, error) {
	normalised := s.normalise(pattern)
	if normalised == "" {
		return matchOutcome{}, nil
	}
	candidates, err := s.catalogue.GrammarPointsByNormalisedPattern(ctx, normalised)
	if err != nil {
		return matchOutcome{}, err
	}
	if len(candidates) == 0 {
		return matchOutcome{}, nil
	}
	if len(candidates) == 1 {
		return matchOutcome{pointID: candidates[0].ID}, nil
	}
	if maruMoriLevel != "" {
		var atLevel []refdata.GrammarPoint
		for _, c := range candidates {
			if string(c.Level) == maruMoriLevel {
				atLevel = append(atLevel, c)
			}
		}
		if len(atLevel) > 0 {
			pick := lowestOrdinal(atLevel)
			// Same-level duplicates (ordinal 1 and 2) are still a guess.
			return matchOutcome{pointID: pick.ID, flagged: len(atLevel) > 1}, nil
		}
	}
	pick := lowestLevel(candidates)
	return matchOutcome{pointID: pick.ID, flagged: true}, nil
}

func lowestOrdinal(points []refdata.GrammarPoint) refdata.GrammarPoint {
	best := points[0]
	for _, p := range points[1:] {
		if p.Ordinal < best.Ordinal {
			best = p
		}
	}
	return best
}

func lowestLevel(points []refdata.GrammarPoint) refdata.GrammarPoint {
	best, bestRank := points[0], levelRank(points[0].Level)
	for _, p := range points[1:] {
		if r := levelRank(p.Level); r < bestRank {
			best, bestRank = p, r
		}
	}
	return best
}

// levelRank orders JLPT Levels easiest-first; unknown levels sort last.
func levelRank(level refdata.Level) int {
	for i, l := range refdata.Levels {
		if l == level {
			return i
		}
	}
	return len(refdata.Levels)
}

func validLevel(level refdata.Level) bool {
	for _, l := range refdata.Levels {
		if l == level {
			return true
		}
	}
	return false
}
