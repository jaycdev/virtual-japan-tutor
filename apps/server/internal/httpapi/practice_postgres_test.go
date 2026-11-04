package httpapi_test

import (
	"context"
	"net/http"
	"reflect"
	"strconv"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
)

// The whole Practice feature over the real Postgres stores (skipped without
// TEST_DATABASE_URL): exercises built from the real reference-data and grammar
// tables, answers appended to practice_records exactly as mastery.PostgresStore
// reads them back, and a Focus Set whose Mastery visibly moves. This is the
// schema-drift guard the in-memory doubles cannot provide.
func TestPracticeAgainstPostgres(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()

	const (
		vocabSeq = 990001 // 学校 / がっこう — school (N5); 990002–990004 are N5 distractors
	)
	seeds := []string{
		`INSERT INTO jmdict_entries (ent_seq, is_common) VALUES
		   (990001, true), (990002, true), (990003, true), (990004, true) ON CONFLICT DO NOTHING`,
		`INSERT INTO jmdict_kanji_forms (ent_seq, ord, text) VALUES
		   (990001, 1, '学校'), (990002, 1, '火'), (990003, 1, '山'), (990004, 1, '本') ON CONFLICT DO NOTHING`,
		`INSERT INTO jmdict_readings (ent_seq, ord, text) VALUES
		   (990001, 1, 'がっこう'), (990002, 1, 'ひ'), (990003, 1, 'やま'), (990004, 1, 'ほん') ON CONFLICT DO NOTHING`,
		`INSERT INTO jmdict_senses (ent_seq, ord, glosses) VALUES
		   (990001, 1, ARRAY['school']), (990002, 1, ARRAY['fire']),
		   (990003, 1, ARRAY['mountain']), (990004, 1, ARRAY['book']) ON CONFLICT DO NOTHING`,
		`INSERT INTO jlpt_vocab_entries (jlpt_level, written, reading, meaning, match_method) VALUES
		   ('N5', '学校', 'がっこう', 'school', 'exact'),
		   ('N5', '火', 'ひ', 'fire', 'exact'),
		   ('N5', '山', 'やま', 'mountain', 'exact'),
		   ('N5', '本', 'ほん', 'book', 'exact') ON CONFLICT DO NOTHING`,
		`INSERT INTO jlpt_vocab_links (jlpt_level, written, reading, ent_seq) VALUES
		   ('N5', '学校', 'がっこう', 990001), ('N5', '火', 'ひ', 990002),
		   ('N5', '山', 'やま', 990003), ('N5', '本', 'ほん', 990004) ON CONFLICT DO NOTHING`,
		`INSERT INTO kanji (literal) VALUES ('水'), ('火'), ('山') ON CONFLICT DO NOTHING`,
		`INSERT INTO kanji_meanings (literal, ord, meaning) VALUES
		   ('水', 1, 'water'), ('火', 1, 'fire'), ('山', 1, 'mountain') ON CONFLICT DO NOTHING`,
		`INSERT INTO jlpt_kanji (literal, jlpt_level) VALUES
		   ('水', 'N5'), ('火', 'N5'), ('山', 'N5') ON CONFLICT DO NOTHING`,
	}
	for _, q := range seeds {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("seed reference data: %v", err)
		}
	}

	// Grammar Points with examples (ids come from the bigserial; re-runs reuse
	// the same schema, so pick them back up with ON CONFLICT).
	if _, err := pool.Exec(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning, variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 990001, 1, '～ました', 'mashita', 'past tense (polite)', ARRAY['ました'], 'ました', ARRAY['ました'])
		ON CONFLICT (jlpt_level, normalised_pattern, ordinal) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO grammar_points (jlpt_level, catalogue_number, ordinal, pattern, romaji, meaning, variants, normalised_pattern, normalised_variants)
		VALUES ('N5', 990002, 1, '～ください', 'kudasai', 'please', ARRAY['ください'], 'ください', ARRAY['ください'])
		ON CONFLICT (jlpt_level, normalised_pattern, ordinal) DO NOTHING`); err != nil {
		t.Fatal(err)
	}
	var pastPoint, politePoint int64
	if err := pool.QueryRow(ctx, `SELECT id FROM grammar_points WHERE normalised_pattern = 'ました'`).Scan(&pastPoint); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT id FROM grammar_points WHERE normalised_pattern = 'ください'`).Scan(&politePoint); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO grammar_examples (grammar_point_id, sentence_ja, translation_en, span_start, span_end, span_text, source)
		VALUES ($1, '昨日、学校へ行きました。', 'I went to school yesterday.', 6, 11, '行きました', 'manual')
		ON CONFLICT (grammar_point_id, sentence_ja) DO NOTHING`, pastPoint); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO grammar_examples (grammar_point_id, sentence_ja, translation_en, span_start, span_end, span_text, source)
		VALUES ($1, '水をください。', 'Please give me water.', 2, 6, 'ください', 'manual')
		ON CONFLICT (grammar_point_id, sentence_ja) DO NOTHING`, politePoint); err != nil {
		t.Fatal(err)
	}

	// The Learner: auth over Postgres, then Known Items written the way the
	// Sync and onboarding features write them.
	authSvc := auth.NewService(auth.NewPostgresStore(pool), auth.Options{TTL: time.Hour, PasswordParams: authtest.FastPasswordParams})
	alice, err := authSvc.CreateUser(ctx, "alice", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authSvc.CreateUser(ctx, "bob", password); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, jmdict_ent_seq, first_synced_at, last_seen_at)
		VALUES ($1, 'vocabulary', 'Vocab/1', 2, $2, $3, $3) ON CONFLICT DO NOTHING`,
		alice.ID, vocabSeq, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, kanji_literal, first_synced_at, last_seen_at)
		VALUES ($1, 'kanji', 'Kanji/2', 3, '水', $2, $2) ON CONFLICT DO NOTHING`,
		alice.ID, now); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		INSERT INTO known_grammar_points (user_id, grammar_point_id, source, mastery)
		VALUES ($1, $2, 'seeded', 'medium') ON CONFLICT DO NOTHING`,
		alice.ID, pastPoint); err != nil {
		t.Fatal(err)
	}

	masterySvc := mastery.NewService(mastery.NewPostgresStore(pool), mastery.DefaultOptions())
	practiceSvc := practice.NewService(masterySvc,
		practice.NewPostgresContent(pool),
		practice.NewMemStore(time.Hour),
		practice.NewPostgresResults(pool),
		practice.Options{SessionSize: 10})
	e := env{h: httpapi.New(pool, authSvc, httpapi.WithFocusSet(masterySvc), httpapi.WithPractice(practiceSvc)), svc: authSvc}
	token := e.login(t, "alice")

	// Focus Set order before practice: vocab (SRS 2), kanji (SRS 3), seeded
	// grammar (no SRS → no-evidence mark).
	sessRec := e.do(t, "POST", "/practice/sessions", "Bearer "+token, map[string]any{"seed": 7})
	if sessRec.Code != http.StatusOK {
		t.Fatalf("start = %d (%s)", sessRec.Code, sessRec.Body)
	}
	var sess api.PracticeSession
	mustJSON(t, sessRec, &sess)
	// alice knows only three buildable items, so the 10-item session tops up
	// by cycling them in order.
	if len(sess.Exercises) != 10 {
		t.Fatalf("exercises = %d, want the 10-item target topped up from the three known items", len(sess.Exercises))
	}
	wantKinds := []api.PracticeExerciseKind{api.Recognition, api.Recognition, api.GrammarCloze}
	wantRefs := []string{"990001", "水", strconv.FormatInt(pastPoint, 10)}
	for i, ex := range sess.Exercises {
		if ex.Kind != wantKinds[i%3] || ex.ItemRef != wantRefs[i%3] {
			t.Errorf("exercise %d = %s/%s, want %s/%s", i, ex.Kind, ex.ItemRef, wantKinds[i%3], wantRefs[i%3])
		}
		if ex.Options == nil || len(*ex.Options) < 2 || len(*ex.Options) > 4 {
			t.Errorf("exercise %s options = %v, want 2..4 built from the reference data", ex.Id, ex.Options)
		}
	}
	cloze := sess.Exercises[2]
	if !containsStr(cloze.Prompt, "＿＿＿") || containsStr(cloze.Prompt, "行きました") {
		t.Errorf("cloze prompt %q, want the span blanked", cloze.Prompt)
	}

	// Distractors really come from Postgres: the vocab options are glosses of
	// seeded N5 entries.
	if sess.Exercises[0].Options != nil {
		texts := map[string]bool{}
		for _, o := range *sess.Exercises[0].Options {
			texts[o.Text] = true
		}
		for _, want := range []string{"school", "fire", "mountain", "book"} {
			if !texts[want] {
				t.Errorf("vocab options %v, want the N5 gloss %q in there", texts, want)
			}
		}
	}

	// Same seed, same session — md5-ordered distractor sampling is stable.
	againRec := e.do(t, "POST", "/practice/sessions", "Bearer "+token, map[string]any{"seed": 7})
	var again api.PracticeSession
	mustJSON(t, againRec, &again)
	if !reflect.DeepEqual(again.Exercises, sess.Exercises) {
		t.Errorf("seed 7 built different exercises on the second start:\n first=%+v\n again=%+v", sess.Exercises, again.Exercises)
	}

	// Answer everything correctly.
	wantText := map[string]string{"990001": "school", "水": "water", strconv.FormatInt(pastPoint, 10): "行きました"}
	for _, ex := range sess.Exercises {
		pick := ""
		for _, o := range *ex.Options {
			if o.Text == wantText[ex.ItemRef] {
				pick = o.Id
			}
		}
		if pick == "" {
			t.Fatalf("no correct-looking option for %s: %+v", ex.ItemRef, *ex.Options)
		}
		rec := e.do(t, "POST", "/practice/sessions/"+sess.Id+"/answers", "Bearer "+token,
			map[string]string{"exerciseId": ex.Id, "optionId": pick})
		var res api.PracticeAnswerResult
		mustJSON(t, rec, &res)
		if rec.Code != http.StatusOK || !res.Correct {
			t.Fatalf("answer %s = %d %s, want correct", ex.Id, rec.Code, rec.Body)
		}
	}

	// practice_records holds exactly what mastery.PostgresStore reads back.
	rows, err := mastery.NewPostgresStore(pool).PracticeResults(ctx, alice.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 10 {
		t.Fatalf("practice_records = %d rows, want 10 (the topped-up session)", len(rows))
	}
	for _, r := range rows {
		if !r.Correct {
			t.Errorf("record %+v, want correct=true", r)
		}
	}
	// Each repeated exercise wrote its own row: the cycle [vocab, kanji,
	// grammar] three times plus one more vocab.
	var rawRefs []string
	raw, err := pool.Query(ctx, `
		SELECT item_kind || ':' || item_ref || '=' || COUNT(*)::text
		FROM practice_records
		GROUP BY item_kind || ':' || item_ref
		ORDER BY item_kind || ':' || item_ref`)
	if err != nil {
		t.Fatal(err)
	}
	for raw.Next() {
		var s string
		if err := raw.Scan(&s); err != nil {
			t.Fatal(err)
		}
		rawRefs = append(rawRefs, s)
	}
	raw.Close()
	want := []string{
		"grammar:" + strconv.FormatInt(pastPoint, 10) + "=3",
		"kanji:水=3",
		"vocabulary:990001=4",
	}
	if !reflect.DeepEqual(rawRefs, want) {
		t.Errorf("practice_records rows = %v, want %v", rawRefs, want)
	}

	// The done-when through real SQL: Mastery moved in the Focus Set.
	beforeRec := e.do(t, "GET", "/focus-set", "Bearer "+e.login(t, "bob"), nil) // bob's empty set proves isolation
	if beforeRec.Code != http.StatusOK {
		t.Fatal(beforeRec.Body)
	}
	var bobBody api.FocusSet
	mustJSON(t, beforeRec, &bobBody)
	if len(bobBody.Items) != 0 {
		t.Errorf("bob's focus set = %+v, want empty", bobBody.Items)
	}
	aliceSet := getFocusSet(t, e, token)
	if len(aliceSet) != 3 {
		t.Fatalf("alice's focus set = %+v, want 3 items", aliceSet)
	}
	for _, item := range aliceSet {
		if item.Mastery <= 0 {
			t.Errorf("mastery of %s = %v, want a positive score after practice", item.ItemRef, item.Mastery)
		}
	}
	if item, ok := findRef(aliceSet, "990001"); !ok || float64(item.Mastery) <= 2.0/9.0 {
		t.Errorf("vocab mastery = %+v, want above the SRS-only 2/9 after a correct answer", item)
	}
}

func findRef(items []api.FocusSetItem, ref string) (api.FocusSetItem, bool) {
	for _, it := range items {
		if it.ItemRef == ref {
			return it, true
		}
	}
	return api.FocusSetItem{}, false
}
