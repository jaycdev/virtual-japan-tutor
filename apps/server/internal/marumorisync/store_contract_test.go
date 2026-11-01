package marumorisync_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync/marumoritest"
)

// fixture is a Store under test plus the per-implementation way to read the rows that
// the Store interface itself does not expose (history, grammar, home), so the same
// behavioural contract runs against the in-memory fake and the Postgres store.
type fixture struct {
	store   marumorisync.Store
	mkUser  func(string) uuid.UUID
	history func(*testing.T, uuid.UUID) []marumorisync.HistoryEntry
	grammar func(*testing.T, uuid.UUID) []marumori.GrammarObservation
	home    func(*testing.T, uuid.UUID) marumori.Home
}

// The same behavioural contract runs against the in-memory fake and the Postgres store.
func TestMemStoreContract(t *testing.T) {
	storeContract(t, func(t *testing.T) fixture {
		m := marumoritest.NewMemStore()
		return fixture{
			store:   m,
			mkUser:  func(string) uuid.UUID { return uuid.New() },
			history: func(*testing.T, uuid.UUID) []marumorisync.HistoryEntry { return m.HistoryRows() },
			grammar: func(*testing.T, uuid.UUID) []marumori.GrammarObservation { return m.GrammarRows() },
			home:    func(*testing.T, uuid.UUID) marumori.Home { return m.HomeRow() },
		}
	})
}

func TestPostgresStoreContract(t *testing.T) {
	storeContract(t, func(t *testing.T) fixture {
		pool := dbtest.New(t)
		// The contract links a few items to reference data; the FKs need those rows.
		seedReferenceData(t, pool)
		return fixture{
			store:  marumorisync.NewPostgresStore(pool),
			mkUser: func(name string) uuid.UUID { return insertUser(t, pool, name) },
			history: func(t *testing.T, u uuid.UUID) []marumorisync.HistoryEntry {
				rows, err := pool.Query(context.Background(),
					`SELECT kind, marumori_id, change, old_level, new_level FROM marumori_known_item_history WHERE user_id = $1 ORDER BY id`, u)
				if err != nil {
					t.Fatal(err)
				}
				defer rows.Close()
				var out []marumorisync.HistoryEntry
				for rows.Next() {
					var h marumorisync.HistoryEntry
					var kind, change string
					if err := rows.Scan(&kind, &h.MaruMoriID, &change, &h.OldLevel, &h.NewLevel); err != nil {
						t.Fatal(err)
					}
					h.Kind, h.Change = marumorisync.Kind(kind), marumorisync.Change(change)
					out = append(out, h)
				}
				return out
			},
			grammar: func(t *testing.T, u uuid.UUID) []marumori.GrammarObservation {
				rows, err := pool.Query(context.Background(),
					`SELECT marumori_id, srs_level, suspended FROM marumori_grammar_observations WHERE user_id = $1 ORDER BY marumori_id`, u)
				if err != nil {
					t.Fatal(err)
				}
				defer rows.Close()
				var out []marumori.GrammarObservation
				for rows.Next() {
					var g marumori.GrammarObservation
					if err := rows.Scan(&g.MaruMoriID, &g.Level, &g.Suspended); err != nil {
						t.Fatal(err)
					}
					out = append(out, g)
				}
				return out
			},
			home: func(t *testing.T, u uuid.UUID) marumori.Home {
				var h marumori.Home
				err := pool.QueryRow(context.Background(),
					`SELECT total_learned, kanji_learned, vocabulary_learned, grammar_lessons_done,
					        pending_lessons, pending_reviews, grammar_total,
					        pending_grammar_lessons, pending_grammar_reviews,
					        accuracy, grammar_accuracy
					 FROM marumori_home_stats WHERE user_id = $1`, u).
					Scan(&h.TotalLearned, &h.KanjiLearned, &h.VocabularyLearned, &h.TotalGrammarDone,
						&h.PendingLessons, &h.PendingReviews, &h.TotalGrammarLearned,
						&h.PendingGrammarLessons, &h.PendingGrammarReviews, &h.Accuracy, &h.GrammarAccuracy)
				if err != nil {
					t.Fatal(err)
				}
				return h
			},
		}
	})
}

// seedReferenceData inserts the minimal kanji and JMdict rows the contract's linked
// items point at (marumori_known_items has FKs to both tables).
func seedReferenceData(t *testing.T, pool *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for _, literal := range []string{"水", "火"} {
		if _, err := pool.Exec(ctx, `INSERT INTO kanji (literal) VALUES ($1) ON CONFLICT DO NOTHING`, literal); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := pool.Exec(ctx, `INSERT INTO jmdict_entries (ent_seq, is_common) VALUES (1234, true) ON CONFLICT DO NOTHING`); err != nil {
		t.Fatal(err)
	}
}

func insertUser(t *testing.T, pool *pgxpool.Pool, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(),
		`INSERT INTO users (username, password_hash) VALUES ($1, 'x') RETURNING id`, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func str(s string) *string { return &s }
func i(n int) *int         { return &n }
func i64(n int64) *int64   { return &n }
func b(v bool) *bool       { return &v }

func item(kind marumorisync.Kind, id string, level int) marumorisync.AppliedItem {
	return marumorisync.AppliedItem{Kind: kind, MaruMoriID: id, Level: level}
}

func linkedKanji(id, literal string, level int) marumorisync.AppliedItem {
	it := item(marumorisync.KindKanji, id, level)
	it.KanjiLiteral = str(literal)
	return it
}

func unlinkedVocab(id, text string, level int) marumorisync.AppliedItem {
	it := item(marumorisync.KindVocabulary, id, level)
	it.Text = str(text)
	return it
}

func linkedVocab(id string, entSeq int64, level int) marumorisync.AppliedItem {
	it := item(marumorisync.KindVocabulary, id, level)
	it.EntSeq = i64(entSeq)
	return it
}

func batch(items ...marumorisync.AppliedItem) marumorisync.SyncBatch {
	return marumorisync.SyncBatch{Items: items, SyncedAt: time.Now()}
}

func storeContract(t *testing.T, newFixture func(*testing.T) fixture) {
	ctx := context.Background()

	t.Run("settings: connect, replace key, disconnect; a row exists exactly while connected", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		if _, err := s.GetSettings(ctx, u); !errors.Is(err, marumorisync.ErrNoKey) {
			t.Fatalf("fresh GetSettings err = %v, want ErrNoKey", err)
		}
		first := time.Now().Add(-time.Hour)
		set, err := s.SetAPIKey(ctx, u, "v1:cipher-one", first)
		// Postgres timestamps have microsecond precision; compare with a millisecond tolerance.
		if err != nil || set.APIKeyEncrypted != "v1:cipher-one" || set.ConnectedAt.Sub(first).Abs() > time.Millisecond {
			t.Fatalf("SetAPIKey = %+v, %v", set, err)
		}
		// Replacing the key keeps the original ConnectedAt.
		set2, err := s.SetAPIKey(ctx, u, "v1:cipher-two", time.Now())
		if err != nil || set2.APIKeyEncrypted != "v1:cipher-two" || !set2.ConnectedAt.Equal(set.ConnectedAt) {
			t.Fatalf("replace = %+v, %v; ConnectedAt moved", set2, err)
		}
		if err := s.DeleteAPIKey(ctx, u); err != nil {
			t.Fatal(err)
		}
		if _, err := s.GetSettings(ctx, u); !errors.Is(err, marumorisync.ErrNoKey) {
			t.Fatalf("after delete err = %v, want ErrNoKey", err)
		}
		if err := s.DeleteAPIKey(ctx, u); err != nil { // idempotent
			t.Fatalf("second delete: %v", err)
		}
	})

	t.Run("users are isolated; other users never see each other's key or data", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		alice, bob := mkUser("alice"), mkUser("bob")
		if _, err := s.SetAPIKey(ctx, alice, "v1:cipher-a", time.Now()); err != nil {
			t.Fatal(err)
		}
		if _, err := s.GetSettings(ctx, bob); !errors.Is(err, marumorisync.ErrNoKey) {
			t.Errorf("bob sees alice's connection: %v", err)
		}
		run := uuid.New()
		if err := s.StartRun(ctx, bob, run, time.Now()); err != nil {
			t.Fatal(err)
		}
		if err := s.ApplySync(ctx, bob, run, batch(linkedKanji("Kanji/1", "水", 2))); err != nil {
			t.Fatal(err)
		}
		if kl, _ := s.KnownLevels(ctx, alice); len(kl) != 0 {
			t.Errorf("alice inherited bob's item: %+v", kl)
		}
		if users, _ := s.UsersWithKeys(ctx); len(users) != 1 || users[0] != alice {
			t.Errorf("UsersWithKeys = %v, want only alice", users)
		}
	})

	t.Run("run lifecycle: one running run per user; runs listed newest first", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		r1 := uuid.New()
		if err := s.StartRun(ctx, u, r1, time.Now()); err != nil {
			t.Fatal(err)
		}
		if err := s.StartRun(ctx, u, uuid.New(), time.Now()); !errors.Is(err, marumorisync.ErrSyncRunning) {
			t.Fatalf("second StartRun err = %v, want ErrSyncRunning", err)
		}
		// Another user may run concurrently.
		v := mkUser("bob")
		if err := s.StartRun(ctx, v, uuid.New(), time.Now()); err != nil {
			t.Fatalf("concurrent other-user run: %v", err)
		}
		end := time.Now()
		counts := marumorisync.Counts{Kanji: 1}
		if err := s.FinishRun(ctx, u, r1, end, nil, &counts); err != nil {
			t.Fatal(err)
		}
		if err := s.StartRun(ctx, u, uuid.New(), time.Now()); err != nil { // free again
			t.Fatalf("StartRun after finish: %v", err)
		}
		runs, err := s.RecentRuns(ctx, u, 10)
		if err != nil || len(runs) != 2 {
			t.Fatalf("RecentRuns = %+v, %v", runs, err)
		}
		if runs[0].Status != marumorisync.RunRunning || runs[1].ID != r1 || runs[1].Status != marumorisync.RunOK {
			t.Fatalf("RecentRuns order/status wrong: %+v", runs)
		}
		if runs[1].Counts == nil || runs[1].Counts.Kanji != 1 {
			t.Errorf("finished run lost its counts: %+v", runs[1])
		}
		if runs[1].FinishedAt == nil || runs[1].FinishedAt.IsZero() {
			t.Errorf("finished run has no FinishedAt: %+v", runs[1])
		}
		last, ok, err := s.LastSuccessfulRun(ctx, u)
		if err != nil || !ok || last.ID != r1 {
			t.Fatalf("LastSuccessfulRun = %+v %v %v", last, ok, err)
		}
	})

	t.Run("failed runs are recorded with their Learner-facing error", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		r := uuid.New()
		_ = s.StartRun(ctx, u, r, time.Now())
		if err := s.FinishRun(ctx, u, r, time.Now(), str("MaruMori rejected the API key"), nil); err != nil {
			t.Fatal(err)
		}
		runs, _ := s.RecentRuns(ctx, u, 10)
		if len(runs) != 1 || runs[0].Status != marumorisync.RunFailed || runs[0].Error == nil ||
			*runs[0].Error != "MaruMori rejected the API key" || runs[0].Counts != nil {
			t.Fatalf("failed run = %+v", runs[0])
		}
		if _, ok, _ := s.LastSuccessfulRun(ctx, u); ok {
			t.Error("a failed run counted as successful")
		}
	})

	t.Run("a run abandoned mid-flight is reaped so it cannot block the next one", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		abandoned := uuid.New()
		// Started before the window and never finished: the process died, or the request
		// was cancelled and no one came back to close the run.
		if err := s.StartRun(ctx, u, abandoned, time.Now().Add(-2*marumorisync.StaleRunAfter)); err != nil {
			t.Fatal(err)
		}
		if err := s.StartRun(ctx, u, uuid.New(), time.Now()); err != nil {
			t.Fatalf("a stale run blocked a new one: %v", err)
		}
		// It stays in the history, closed as a failure rather than deleted.
		runs, err := s.RecentRuns(ctx, u, 10)
		if err != nil || len(runs) != 2 {
			t.Fatalf("RecentRuns = %+v, %v", runs, err)
		}
		var reaped marumorisync.SyncRun
		for _, r := range runs {
			if r.ID == abandoned {
				reaped = r
			}
		}
		if reaped.ID != abandoned {
			t.Fatalf("the abandoned run vanished from history: %+v", runs)
		}
		if reaped.Status != marumorisync.RunFailed || reaped.FinishedAt == nil {
			t.Errorf("abandoned run = %+v, want failed with an end time", reaped)
		}
		if reaped.Error == nil || *reaped.Error != marumorisync.StaleRunMessage {
			t.Errorf("abandoned run error = %v, want %q", reaped.Error, marumorisync.StaleRunMessage)
		}
		// A run inside the window is another worker's business, not stale.
		v := mkUser("bob")
		if err := s.StartRun(ctx, v, uuid.New(), time.Now()); err != nil {
			t.Fatal(err)
		}
		if err := s.StartRun(ctx, v, uuid.New(), time.Now()); !errors.Is(err, marumorisync.ErrSyncRunning) {
			t.Errorf("a fresh run was reaped: %v", err)
		}
	})

	t.Run("RecentRuns honours the limit and stays scoped to the user", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u, v := mkUser("alice"), mkUser("bob")
		for k := 0; k < 3; k++ {
			r := uuid.New()
			at := time.Now().Add(time.Duration(k) * time.Second)
			_ = s.StartRun(ctx, u, r, at)
			_ = s.FinishRun(ctx, u, r, at.Add(time.Millisecond), nil, nil)
		}
		rr := uuid.New()
		_ = s.StartRun(ctx, v, rr, time.Now())
		runs, err := s.RecentRuns(ctx, u, 2)
		if err != nil || len(runs) != 2 {
			t.Fatalf("limit not honoured: %+v, %v", runs, err)
		}
		if runs, _ := s.RecentRuns(ctx, v, 10); len(runs) != 1 || runs[0].ID != rr {
			t.Fatalf("bob's runs leak: %+v", runs)
		}
	})

	t.Run("ApplySync upserts items, keeps first_synced_at, and refreshes level", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		r := uuid.New()
		_ = s.StartRun(ctx, u, r, time.Now())
		b := batch(linkedKanji("Kanji/1", "水", 2))
		b.SyncedAt = time.Now().Add(-2 * time.Hour)
		if err := s.ApplySync(ctx, u, r, b); err != nil {
			t.Fatal(err)
		}
		r2 := uuid.New()
		_ = s.StartRun(ctx, u, r2, time.Now())
		if err := s.ApplySync(ctx, u, r2, batch(linkedKanji("Kanji/1", "水", 4))); err != nil {
			t.Fatal(err)
		}
		kl, err := s.KnownLevels(ctx, u)
		if err != nil || len(kl) != 1 || kl[0].Level != 4 {
			t.Fatalf("KnownLevels = %+v, %v; want the refreshed level", kl, err)
		}
		tot, err := s.KnowledgeTotals(ctx, u)
		if err != nil || tot.Kanji != 1 || tot.Vocabulary != 0 {
			t.Fatalf("Totals = %+v, %v", tot, err)
		}
	})

	t.Run("disappeared items are marked, not deleted, and vanish from Known views", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		r := uuid.New()
		_ = s.StartRun(ctx, u, r, time.Now())
		if err := s.ApplySync(ctx, u, r, batch(
			linkedKanji("Kanji/1", "水", 2),
			unlinkedVocab("VocabularyForms/9", "日本语", 1))); err != nil {
			t.Fatal(err)
		}
		r2 := uuid.New()
		_ = s.StartRun(ctx, u, r2, time.Now())
		b := batch(linkedKanji("Kanji/1", "水", 2))
		b.Disappeared = []marumorisync.DisappearedRef{{Kind: marumorisync.KindVocabulary, MaruMoriID: "VocabularyForms/9"}}
		if err := s.ApplySync(ctx, u, r2, b); err != nil {
			t.Fatal(err)
		}
		kl, _ := s.KnownLevels(ctx, u)
		if len(kl) != 1 || kl[0].MaruMoriID != "Kanji/1" {
			t.Fatalf("KnownLevels = %+v, want the disappeared item gone", kl)
		}
		tot, _ := s.KnowledgeTotals(ctx, u)
		if tot.Vocabulary != 0 {
			t.Fatalf("Totals counted the disappeared item: %+v", tot)
		}
		// It may come back: re-appearing clears the mark.
		r3 := uuid.New()
		_ = s.StartRun(ctx, u, r3, time.Now())
		if err := s.ApplySync(ctx, u, r3, batch(
			linkedKanji("Kanji/1", "水", 2),
			unlinkedVocab("VocabularyForms/9", "日本语", 3))); err != nil {
			t.Fatal(err)
		}
		kl, _ = s.KnownLevels(ctx, u)
		if len(kl) != 2 {
			t.Fatalf("after return KnownLevels = %+v, want 2", kl)
		}
	})

	t.Run("history rows attach to the run and the user", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		r := uuid.New()
		_ = s.StartRun(ctx, u, r, time.Now())
		b := batch(linkedKanji("Kanji/1", "水", 2))
		b.History = []marumorisync.HistoryEntry{
			{Kind: marumorisync.KindKanji, MaruMoriID: "Kanji/1", Change: marumorisync.ChangeAppeared, NewLevel: i(2)},
		}
		if err := s.ApplySync(ctx, u, r, b); err != nil {
			t.Fatal(err)
		}
		h := f.history(t, u)
		if len(h) != 1 || h[0].Change != marumorisync.ChangeAppeared || h[0].NewLevel == nil || *h[0].NewLevel != 2 {
			t.Fatalf("history = %+v", h)
		}
	})

	t.Run("grammar observations upsert progress without duplicating", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		r := uuid.New()
		_ = s.StartRun(ctx, u, r, time.Now())
		gb := batch()
		gb.Grammar = []marumori.GrammarObservation{
			{MaruMoriID: "Grammar/101"},              // lesson-only: no progress yet
			{MaruMoriID: "Grammar/202", Level: i(3)}, // suspended unknown upstream
			{MaruMoriID: "Grammar/203", Level: i(5), Suspended: b(true)},
		}
		if err := s.ApplySync(ctx, u, r, gb); err != nil {
			t.Fatal(err)
		}
		r2 := uuid.New()
		_ = s.StartRun(ctx, u, r2, time.Now())
		gb2 := batch()
		gb2.Grammar = []marumori.GrammarObservation{{MaruMoriID: "Grammar/202", Level: i(4), Suspended: b(false)}}
		if err := s.ApplySync(ctx, u, r2, gb2); err != nil {
			t.Fatal(err)
		}
		obs := f.grammar(t, u)
		if len(obs) != 3 {
			t.Fatalf("grammar rows = %d, want 3 (upserted, not duplicated)", len(obs))
		}
		for _, o := range obs {
			if o.MaruMoriID == "Grammar/202" && (o.Level == nil || *o.Level != 4 || o.Suspended == nil || *o.Suspended) {
				t.Fatalf("Grammar/202 not refreshed: %+v", o)
			}
		}
	})

	t.Run("home stats replace the previous snapshot", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		r := uuid.New()
		_ = s.StartRun(ctx, u, r, time.Now())
		b := batch()
		b.Home = &marumori.Home{KanjiLearned: 12, VocabularyLearned: 30}
		if err := s.ApplySync(ctx, u, r, b); err != nil {
			t.Fatal(err)
		}
		r2 := uuid.New()
		_ = s.StartRun(ctx, u, r2, time.Now())
		b2 := batch()
		b2.Home = &marumori.Home{KanjiLearned: 14, VocabularyLearned: 30}
		if err := s.ApplySync(ctx, u, r2, b2); err != nil {
			t.Fatal(err)
		}
		if h := f.home(t, u); h.KanjiLearned != 14 {
			t.Fatalf("home = %+v, want the replaced snapshot", h)
		}
	})

	t.Run("KnowledgeTotals counts only present items and linked vocabulary", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		r := uuid.New()
		_ = s.StartRun(ctx, u, r, time.Now())
		if err := s.ApplySync(ctx, u, r, batch(
			linkedKanji("Kanji/1", "水", 2),
			linkedKanji("Kanji/2", "火", 1),
			linkedVocab("VocabularyForms/1", 1234, 2),
			unlinkedVocab("VocabularyForms/2", "hira gana word", 1))); err != nil {
			t.Fatal(err)
		}
		tot, err := s.KnowledgeTotals(ctx, u)
		if err != nil {
			t.Fatal(err)
		}
		if tot.Kanji != 2 || tot.Vocabulary != 2 || tot.VocabularyLinked != 1 || tot.LastSyncAt == nil {
			t.Fatalf("Totals = %+v, want 2 kanji, 2 vocab, 1 linked, sync time set", tot)
		}
	})

	t.Run("key changes do not disturb stored knowledge", func(t *testing.T) {
		f := newFixture(t)
		s, mkUser := f.store, f.mkUser
		u := mkUser("alice")
		r := uuid.New()
		_ = s.StartRun(ctx, u, r, time.Now())
		if err := s.ApplySync(ctx, u, r, batch(linkedKanji("Kanji/1", "水", 2))); err != nil {
			t.Fatal(err)
		}
		if _, err := s.SetAPIKey(ctx, u, "v1:another", time.Now()); err != nil {
			t.Fatal(err)
		}
		if err := s.DeleteAPIKey(ctx, u); err != nil {
			t.Fatal(err)
		}
		kl, _ := s.KnownLevels(ctx, u)
		if len(kl) != 1 {
			t.Fatalf("knowledge lost after key changes: %+v", kl)
		}
	})
}
