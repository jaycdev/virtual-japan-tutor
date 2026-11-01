package knowngrammar_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar/knowngrammartest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// Both Store implementations must behave identically: the unit tests run
// against MemStore, and this contract keeps the Postgres store honest about
// the SQL semantics (source promotion, seeded-only removal, observation
// upserts).

type storeHarness struct {
	store knowngrammar.Store
	ids   []int64 // catalogue point ids, in seedPoints() order
	// seedUser makes the contract's user id exist (Postgres has the FK; Mem does not care).
	seedUser func(*testing.T, uuid.UUID)
}

func TestMemStoreSatisfiesTheContract(t *testing.T) {
	var ids []int64
	for _, p := range seedPoints() {
		ids = append(ids, p.ID)
	}
	testStoreContract(t, storeHarness{store: knowngrammartest.NewMemStore(), ids: ids, seedUser: func(*testing.T, uuid.UUID) {}})
}

func TestPostgresStoreSatisfiesTheContract(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	var ids []int64
	for _, p := range seedPoints() {
		var id int64
		err := pool.QueryRow(ctx, `
			INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning,
			                            variants, normalised_pattern, normalised_variants)
			VALUES ($1, $2, $3, $4, '', '', ARRAY[]::text[], $5, $6) RETURNING id`,
			string(p.Level), int(p.ID), p.Ordinal, p.Pattern, p.NormalisedPattern, p.NormalisedVariants).Scan(&id)
		if err != nil {
			t.Fatalf("seed grammar point: %v", err)
		}
		ids = append(ids, id)
	}
	testStoreContract(t, storeHarness{store: knowngrammar.NewPostgresStore(pool), ids: ids, seedUser: func(t *testing.T, id uuid.UUID) {
		t.Helper()
		if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, 'contract', 'x')`, id); err != nil {
			t.Fatalf("seed user: %v", err)
		}
	}})
}

func testStoreContract(t *testing.T, h storeHarness) {
	t.Helper()
	ctx := context.Background()
	user := uuid.New()
	h.seedUser(t, user)
	// seedPoints ids in order: だけ@N5, だけ@N4, いい@1, いい@2, ちゃ・じゃ, てしまう@N5, ともなると@N1.
	dakeN5, dakeN4, teShimau := h.ids[0], h.ids[1], h.ids[4]

	t.Run("StartingLevel is unset until written", func(t *testing.T) {
		level, ok, err := h.store.StartingLevel(ctx, user)
		if err != nil || ok || level != "" {
			t.Fatalf("got %q ok=%v err=%v, want unset", level, ok, err)
		}
		if err := h.store.SetStartingLevel(ctx, user, refdata.N4); err != nil {
			t.Fatalf("SetStartingLevel: %v", err)
		}
		level, ok, err = h.store.StartingLevel(ctx, user)
		if err != nil || !ok || level != refdata.N4 {
			t.Fatalf("got %q ok=%v err=%v, want N4", level, ok, err)
		}
	})

	t.Run("ApplySeededPoints adds, keeps and removes around observed rows", func(t *testing.T) {
		delta, err := h.store.ApplySeededPoints(ctx, user, []int64{dakeN5, dakeN4})
		if err != nil {
			t.Fatalf("ApplySeededPoints: %v", err)
		}
		if delta.Added != 2 || delta.Removed != 0 || delta.Kept != 0 {
			t.Errorf("delta = %+v, want 2 added", delta)
		}
		p, ok, err := h.store.KnownPoint(ctx, user, dakeN5)
		if err != nil || !ok || p.Source != knowngrammar.SourceSeeded || p.Mastery != knowngrammar.SeededMastery {
			t.Errorf("dakeN5 = %+v ok=%v, want seeded at medium", p, ok)
		}

		// Confirm one point by observation; it survives the next change.
		if err := h.store.UpsertObservedPoint(ctx, user, dakeN5); err != nil {
			t.Fatalf("UpsertObservedPoint: %v", err)
		}
		delta, err = h.store.ApplySeededPoints(ctx, user, nil)
		if err != nil {
			t.Fatalf("ApplySeededPoints shrink: %v", err)
		}
		if delta.Removed != 1 || delta.Kept != 0 || delta.Added != 0 {
			t.Errorf("delta = %+v, want the observed row kept and the seeded-only row removed", delta)
		}
		p, ok, _ = h.store.KnownPoint(ctx, user, dakeN5)
		if !ok || p.Source != knowngrammar.SourceObserved {
			t.Errorf("observed row lost on shrink: %+v ok=%v", p, ok)
		}
		if _, ok, _ := h.store.KnownPoint(ctx, user, dakeN4); ok {
			t.Error("the seeded-only row survived the shrink")
		}
	})

	t.Run("UpsertObservedPoint promotes source but keeps Mastery", func(t *testing.T) {
		if err := h.store.UpsertObservedPoint(ctx, user, teShimau); err != nil {
			t.Fatal(err)
		}
		p, ok, _ := h.store.KnownPoint(ctx, user, teShimau)
		if !ok || p.Source != knowngrammar.SourceObserved || p.Mastery != knowngrammar.ObservedMastery {
			t.Errorf("teShimau = %+v ok=%v, want observed at low", p, ok)
		}
	})

	t.Run("PutObservation upserts and ResolveObservation re-points", func(t *testing.T) {
		id := "Grammar/" + user.String()[:8]
		if err := h.store.PutObservation(ctx, user, knowngrammar.Observation{
			MaruMoriID: id, Pattern: "ものではない", JLPTLevel: "N3", Flagged: true,
		}); err != nil {
			t.Fatalf("PutObservation: %v", err)
		}
		if err := h.store.PutObservation(ctx, user, knowngrammar.Observation{
			MaruMoriID: id, Pattern: "ものではない", JLPTLevel: "N3", MatchedPoint: dakeN4,
		}); err != nil {
			t.Fatalf("PutObservation again: %v", err)
		}
		all, err := h.store.Observations(ctx, user)
		if err != nil {
			t.Fatal(err)
		}
		if len(all) != 1 {
			t.Fatalf("observations = %+v, want one row after upsert", all)
		}
		if all[0].MatchedPoint != dakeN4 || all[0].Flagged {
			t.Errorf("observation = %+v, want the upserted match, flag cleared", all[0])
		}
		if err := h.store.ResolveObservation(ctx, user, id, dakeN5, true); err != nil {
			t.Fatalf("ResolveObservation: %v", err)
		}
		all, _ = h.store.Observations(ctx, user)
		if len(all) != 1 || all[0].MatchedPoint != dakeN5 || !all[0].Flagged {
			t.Errorf("observation after resolve = %+v", all)
		}
		if err := h.store.ResolveObservation(ctx, user, "Grammar/nope", dakeN5, false); err == nil {
			t.Error("ResolveObservation on an unknown observation should fail")
		}
	})
}
