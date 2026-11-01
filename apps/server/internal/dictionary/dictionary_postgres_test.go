package dictionary_test

import (
	"context"
	"math"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dictionary"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// The dictionary service over the real Postgres (skipped without
// TEST_DATABASE_URL): VocabularyByEntSeq against the JMdict tables, pitch
// against pitch_accents, and the Known-Item half against
// marumori_known_items — including the weakest-form collapse and the
// disappeared row that must read as unknown.

func TestEntryAgainstPostgres(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	const (
		entSchool = 990201 // 学校 / がっこう — two forms' worth of known-state rows
		entFire   = 990202 // 火 / ひ — no Kanjium row: the nil-pitch path
	)
	seeds := []string{
		`INSERT INTO jmdict_entries (ent_seq, is_common) VALUES
		   (990201, true), (990202, true) ON CONFLICT DO NOTHING`,
		`INSERT INTO jmdict_kanji_forms (ent_seq, ord, text) VALUES
		   (990201, 1, '学校'), (990202, 1, '火') ON CONFLICT DO NOTHING`,
		`INSERT INTO jmdict_readings (ent_seq, ord, text) VALUES
		   (990201, 1, 'がっこう'), (990202, 1, 'ひ') ON CONFLICT DO NOTHING`,
		`INSERT INTO jmdict_senses (ent_seq, ord, pos, glosses) VALUES
		   (990201, 1, ARRAY['n'], ARRAY['school', 'secondary school']),
		   (990201, 2, ARRAY['n', 'cpn'], ARRAY['the school building']),
		   (990202, 1, ARRAY['n'], ARRAY['fire']) ON CONFLICT DO NOTHING`,
		`INSERT INTO jlpt_vocab_entries (jlpt_level, written, reading, meaning, match_method) VALUES
		   ('N5', '学校', 'がっこう', 'school', 'exact') ON CONFLICT DO NOTHING`,
		`INSERT INTO jlpt_vocab_links (jlpt_level, written, reading, ent_seq) VALUES
		   ('N5', '学校', 'がっこう', 990201) ON CONFLICT DO NOTHING`,
		// marumori_known_items.kanji_literal is a FK onto the KANJIDIC2 table.
		`INSERT INTO kanji (literal) VALUES ('学'), ('校') ON CONFLICT DO NOTHING`,
		// Kanjium lists the main pattern first (rank 1); the service takes it.
		`INSERT INTO pitch_accents (word, reading, rank, pattern, tag, is_primary) VALUES
		   ('学校', 'がっこう', 1, 0, '', true),
		   ('学校', 'がっこう', 2, 4, '', false) ON CONFLICT DO NOTHING`,
	}
	for _, q := range seeds {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("seed reference data: %v", err)
		}
	}

	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, user, user.String()); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	now := time.Now().UTC()
	known := []string{
		// Two MaruMori forms linked to one entry: the weakest SRS Level wins,
		// matching mastery's collapse.
		`INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, jmdict_ent_seq, first_synced_at, last_seen_at)
		 VALUES ($1, 'vocabulary', 'Vocab/1', 2, 990201, $2, $2)`,
		`INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, jmdict_ent_seq, first_synced_at, last_seen_at)
		 VALUES ($1, 'vocabulary', 'Vocab/2', 5, 990201, $2, $2)`,
		`INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, kanji_literal, first_synced_at, last_seen_at)
		 VALUES ($1, 'kanji', 'Kanji/9', 8, '学', $2, $2)`,
		// A disappeared kanji row is not a Known Item.
		`INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, kanji_literal, first_synced_at, last_seen_at, disappeared_at)
		 VALUES ($1, 'kanji', 'Kanji/10', 3, '校', $2, $2, $2)`,
	}
	for _, q := range known {
		if _, err := pool.Exec(ctx, q, user, now); err != nil {
			t.Fatalf("seed known items: %v", err)
		}
	}

	opts := mastery.DefaultOptions()
	fixed := time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)
	opts.Now = func() time.Time { return fixed }
	svc := dictionary.NewService(
		refdata.NewStore(pool),
		dictionary.NewPGKnownStore(pool),
		mastery.NewService(mastery.NewPostgresStore(pool), opts),
	)

	e, err := svc.Entry(ctx, user, entSchool, "学校", "がっこう")
	if err != nil {
		t.Fatalf("Entry: %v", err)
	}
	if !e.Found || e.EntSeq != entSchool {
		t.Fatalf("found/entSeq = %v/%d", e.Found, e.EntSeq)
	}
	if e.Headword != "学校" || e.Reading != "がっこう" {
		t.Errorf("headword/reading = %q/%q", e.Headword, e.Reading)
	}
	if e.JLPT != refdata.N5 {
		t.Errorf("JLPT = %q, want N5 from the Waller join", e.JLPT)
	}
	if len(e.Senses) != 2 ||
		len(e.Senses[0].POS) != 1 || e.Senses[0].POS[0] != "n" ||
		len(e.Senses[0].Glosses) != 2 || e.Senses[0].Glosses[0] != "school" ||
		e.Senses[1].Glosses[0] != "the school building" {
		t.Errorf("senses = %+v, want both JMdict senses in ord order", e.Senses)
	}
	if len(e.Kanji) != 1 || e.Kanji[0] != "学校" || len(e.Readings) != 1 || e.Readings[0] != "がっこう" {
		t.Errorf("kanji/readings = %v/%v", e.Kanji, e.Readings)
	}

	// The rank-1 heiban pattern, not the rank-2 accent-4 one. がっこう = 4 morae.
	if e.Pitch == nil {
		t.Fatal("pitch = nil, want the Kanjium heiban pattern")
	}
	if e.Pitch.MoraCount != 4 || e.Pitch.AccentPosition != 0 || !e.Pitch.Heiban || e.Pitch.DownstepAfterMora != 5 || e.Pitch.Tag != "" {
		t.Errorf("pitch = %+v, want the rank-1 heiban pattern over 4 morae", e.Pitch)
	}

	// Known state: min(2,5) = 2 on SRS evidence alone → mastery 2/9.
	if e.SRSLevel == nil || *e.SRSLevel != 2 {
		t.Errorf("SRSLevel = %v, want the weakest linked form's 2", e.SRSLevel)
	}
	if e.Mastery == nil || math.Abs(*e.Mastery-2.0/9.0) > 1e-4 {
		t.Errorf("Mastery = %v, want ~2/9 from the same scorer as the Focus Set", e.Mastery)
	}
	if len(e.Components) != 2 {
		t.Fatalf("components = %+v, want 学 and 校", e.Components)
	}
	学, 校 := e.Components[0], e.Components[1]
	if 学.Literal != "学" || !学.Known || 学.SRSLevel == nil || *学.SRSLevel != 8 {
		t.Errorf("学 = %+v, want known at SRS 8", 学)
	}
	if 学.Mastery == nil || math.Abs(*学.Mastery-8.0/9.0) > 1e-4 {
		t.Errorf("学 mastery = %v, want ~8/9", 学.Mastery)
	}
	if 校.Literal != "校" || 校.Known || 校.SRSLevel != nil || 校.Mastery != nil {
		t.Errorf("校 = %+v, want unknown: the disappeared row must not count", 校)
	}

	// No Kanjium pair: a normal result with no pitch, not an error.
	e, err = svc.Entry(ctx, user, entFire, "火", "ひ")
	if err != nil {
		t.Fatalf("Entry(火): %v", err)
	}
	if !e.Found || e.Pitch != nil {
		t.Errorf("火 = found %v pitch %+v, want found with a nil pitch", e.Found, e.Pitch)
	}
	if e.SRSLevel != nil || e.Mastery != nil || len(e.Components) != 1 || e.Components[0].Known {
		t.Errorf("火 state = %+v, want nothing known", e.Components)
	}

	// Linked-but-missing ent_seq: VocabularyByEntSeq answers no rows, and the
	// service keeps the window openable with the tapped form.
	e, err = svc.Entry(ctx, user, 990299, "nek", "nek")
	if err != nil {
		t.Fatalf("Entry(990299): %v", err)
	}
	if e.Found || e.Headword != "nek" || len(e.Senses) != 0 || len(e.Components) != 0 {
		t.Errorf("missing entry = %+v, want found=false echoing the tapped form", e)
	}
}
