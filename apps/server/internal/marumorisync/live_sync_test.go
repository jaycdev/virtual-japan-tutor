package marumorisync_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync/liveup"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync/marumoritest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

// The sync Service against the live MaruMori API and the in-memory Store: production
// wiring (a real *marumori.Client as the Upstream, the key sealed in the Store and
// decrypted per run) with no Postgres. Skipped unless MARUMORI_API_KEY is set; the
// httpapi live test adds the Postgres stores on top.

// liveMemRef matches no live item, so this test exercises only the unlinked path:
// kanji keep their single-character text, unlinked vocabulary is counted not stored.
// The Postgres-backed httpapi live test covers real linking against the imported data.
type liveMemRef struct{}

func (liveMemRef) FindKanji(_ context.Context, _ string) (refdata.Kanji, bool, error) {
	return refdata.Kanji{}, false, nil
}

func (liveMemRef) LinkVocabulary(_ context.Context, _ []string) (map[string][]refdata.Vocabulary, error) {
	return nil, nil
}

// liveSync wires the Service over a fresh in-memory Store with the real client as the
// Upstream factory, and returns the recording wrapper the assertions read back.
func liveSync(t *testing.T) (*marumorisync.Service, *marumoritest.MemStore, *liveup.Recorder, context.Context, uuid.UUID) {
	t.Helper()
	rec := liveup.Client(t)
	box, err := secrets.NewFromKey(make([]byte, 32))
	if err != nil {
		t.Fatal(err)
	}
	store := marumoritest.NewMemStore()
	// The Service builds a fresh client per run from the decrypted key; route each
	// one through the Recorder so the assertions read what the live API returned.
	svc := marumorisync.NewService(store, box, liveMemRef{},
		func(baseURL, apiKey string) (marumorisync.Upstream, error) {
			c, err := marumori.New(baseURL, apiKey)
			if err != nil {
				return nil, err
			}
			rec.Upstream = c
			return rec, nil
		})
	uid := uuid.New()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Minute)
	t.Cleanup(cancel)
	ctx = auth.WithIdentity(ctx, auth.Identity{User: auth.User{ID: uid}})
	return svc, store, rec, ctx, uid
}

func TestLiveSyncRecordsWhatTheClientRead(t *testing.T) {
	svc, store, rec, ctx, uid := liveSync(t)

	if err := svc.SetAPIKey(ctx, liveup.Key(t)); err != nil {
		t.Fatal(err)
	}
	run, err := svc.Sync(ctx)
	if err != nil {
		t.Fatalf("Sync: %v", err)
	}
	if run.Status != marumorisync.RunOK || run.Counts == nil {
		t.Fatalf("run = %+v, want ok with counts", run)
	}
	liveup.CheckDrift(t, "live upstream", rec)

	c := *run.Counts
	t.Logf("live sync: %+v", c)
	if want := liveup.LevelZero(rec.Kanji) + liveup.LevelZero(rec.Vocabulary); c.SkippedLevelZero != want {
		t.Errorf("SkippedLevelZero = %d, want %d from the live lists", c.SkippedLevelZero, want)
	}

	// The stored rows match the run's counts, and the counts match the rows. (An
	// unlinked single-character kanji is both stored and counted in Unlinked, so the
	// counts only reconcile against the store, not against each other.)
	known, err := store.KnownLevels(ctx, uid)
	if err != nil {
		t.Fatal(err)
	}
	storedKanji, storedVocabulary, linkedStored := 0, 0, 0
	for _, k := range known {
		_, entSeq, literal, text, ok := store.KnownItemLink(uid, k.Kind, k.MaruMoriID)
		if !ok {
			t.Fatalf("KnownLevels returned %v/%s but KnownItemLink does not know it", k.Kind, k.MaruMoriID)
		}
		linked := entSeq != nil || literal != nil
		if linked && text != nil {
			t.Errorf("linked %v %s keeps text %q: content must not survive a link", k.Kind, k.MaruMoriID, *text)
		}
		switch k.Kind {
		case marumorisync.KindKanji:
			storedKanji++
			if linked {
				linkedStored++
			}
		case marumorisync.KindVocabulary:
			storedVocabulary++
			if !linked {
				t.Errorf("stored vocabulary %s is unlinked: MaruMori-only words must never be kept", k.MaruMoriID)
			} else {
				linkedStored++
			}
		}
	}
	if storedKanji != c.Kanji || storedVocabulary != c.Vocabulary {
		t.Errorf("store holds %d kanji / %d vocabulary, run counted %d / %d",
			storedKanji, storedVocabulary, c.Kanji, c.Vocabulary)
	}
	if linkedStored != c.Linked {
		t.Errorf("store holds %d linked items, run counted Linked = %d", linkedStored, c.Linked)
	}
	// Every live Known item is stored or counted, exactly once each: collect() puts a
	// passing item in Linked (stored) or in Unlinked (single-character kanji also get
	// stored), so Unlinked = every Known item minus the linked ones. This also catches
	// upstream pagination overlap or a dropped page.
	if want := liveup.KnownFilter(rec.Kanji) + liveup.KnownFilter(rec.Vocabulary) - c.Linked; c.Unlinked != want {
		t.Errorf("Unlinked = %d, want %d (all live Known items minus Linked)", c.Unlinked, want)
	}
	if c.Disappeared != 0 || c.LevelChanges != 0 {
		t.Errorf("first run reported %d disappeared / %d level changes, want 0 on an empty store", c.Disappeared, c.LevelChanges)
	}
	// collect() stores every grammar observation with an id, merged across the two
	// endpoints: the rows must equal the live set, not merely fit inside it.
	if merged := len(liveup.UniqueIDs(rec.Lessons, rec.Reviews)); len(store.GrammarRows()) != merged {
		t.Errorf("stored %d grammar observations, want exactly %d merged live ones",
			len(store.GrammarRows()), merged)
	}
	if home := store.HomeRow(); home != rec.HomeState {
		t.Errorf("home row = %+v, want exactly the /home counters %+v", home, rec.HomeState)
	}
	for _, row := range store.HistoryRows() {
		if row.Change != marumorisync.ChangeAppeared {
			t.Errorf("first run wrote change %q, want appeared", row.Change)
		}
	}

	// Syncing again against the same account changes nothing. (If the learner were to
	// review new items between the two reads, New could legitimately be non-zero; in
	// practice the two reads are seconds apart.)
	second, err := svc.Sync(ctx)
	if err != nil {
		t.Fatalf("second Sync: %v", err)
	}
	if second.Status != marumorisync.RunOK || second.Counts == nil {
		t.Fatalf("second run = %+v, want ok", second)
	}
	if n := *second.Counts; n.New != 0 || n.Disappeared != 0 {
		t.Errorf("second run counts = %+v, want no new or disappeared items between two live reads", n)
	}

	// The run history is recorded.
	runs, err := svc.RecentSyncs(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 2 || runs[0].Status != marumorisync.RunOK || runs[0].FinishedAt == nil {
		t.Errorf("recent runs = %+v, want two closed ok runs, newest first", runs)
	}
}

func TestLiveSyncWithAnInvalidKeyFailsTheRun(t *testing.T) {
	svc, _, _, ctx, _ := liveSync(t)
	wrong := liveup.BadKey

	if err := svc.SetAPIKey(ctx, wrong); err != nil {
		t.Fatal(err)
	}
	run, err := svc.Sync(ctx)
	if err != nil {
		t.Fatalf("Sync with a bad key: %v", err)
	}
	if run.Status != marumorisync.RunFailed || run.Error == nil {
		t.Fatalf("run = %+v, want a failed run with an error", run)
	}
	t.Logf("failed run error: %s", *run.Error)
	liveup.NoLeak(t, "run error", wrong, *run.Error)
}
