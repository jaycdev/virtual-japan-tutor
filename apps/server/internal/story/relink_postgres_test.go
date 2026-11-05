package story

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dbtest"
)

// The JMdict entries and the Learner's Known Item the relink tests use.
const (
	relinkEntKono  = 9910001 // この
	relinkEntKoro  = 9910002 // 頃
	relinkEntAtsui = 9910003 // 暑い
)

// seedRelinkWords creates a user with the three JMdict entries above, and a
// Known Item for 頃 at SRS Level 5. It returns the user's id.
func seedRelinkWords(t *testing.T, pool *pgxpool.Pool) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	user := uuid.New()
	if _, err := pool.Exec(ctx, `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, 'x')`, user, user.String()); err != nil {
		t.Fatalf("seed user: %v", err)
	}
	for _, q := range []string{
		`INSERT INTO jmdict_entries (ent_seq, is_common) VALUES (9910001, true), (9910002, true), (9910003, true)`,
		`INSERT INTO jmdict_kanji_forms (ent_seq, ord, text) VALUES (9910002, 1, '頃'), (9910003, 1, '暑い')`,
		`INSERT INTO jmdict_readings (ent_seq, ord, text) VALUES (9910001, 1, 'この'), (9910002, 1, 'ころ'), (9910003, 1, 'あつい')`,
		`INSERT INTO jmdict_senses (ent_seq, ord, glosses) VALUES (9910001, 1, ARRAY['this']), (9910002, 1, ARRAY['time, around']), (9910003, 1, ARRAY['hot'])`,
	} {
		if _, err := pool.Exec(ctx, q); err != nil {
			t.Fatalf("seed jmdict: %v\n%s", err, q)
		}
	}
	// The Learner knows 頃 at SRS Level 5, and nothing else of this sentence.
	if _, err := pool.Exec(ctx, `
		INSERT INTO marumori_known_items (user_id, kind, marumori_id, srs_level, jmdict_ent_seq, first_synced_at, last_seen_at)
		VALUES ($1, 'vocabulary', 'VocabularyForms/9910002', 5, $2, now(), now())`, user, relinkEntKoro); err != nil {
		t.Fatalf("seed known item: %v", err)
	}
	return user
}

// saveStoredBeforeFix saves 「この頃は暑い。」 the way it was stored before issue
// #94: only 暑い has a link, and the rest are NULL. It returns the Story as
// saved, with its ids assigned.
func saveStoredBeforeFix(t *testing.T, pool *pgxpool.Pool, user uuid.UUID) *Story {
	t.Helper()
	ctx := context.Background()
	s := materialiseJA(t, user, fakeLookup{"暑い": {EntSeq: relinkEntAtsui, JA: "暑い"}}, "この頃は暑い。")
	// The schema requires an English sentence, which materialise leaves empty
	// here because the test passes no translation.
	s.Sentences[0].EN = "This week is hot."
	s.Validated = true
	s.Attempts = 1
	s.ContentWords, s.KnownWords, s.FocusItems, s.FocusHit = 1, 0, 1, 0
	s.VocabItems[0].IsFocus = true
	if err := NewPostgresStore(pool).Save(ctx, s); err != nil {
		t.Fatalf("save: %v", err)
	}
	return s
}

// The relink run over the real schema (skipped without TEST_DATABASE_URL): a
// Story saved the way it was before issue #94 gets its missing links, the
// Known tags, and the appended Vocabulary Items from JMdict and marumori
// Known Items, while its gate counts and existing flags stay put.
func TestRelinkStoriesAgainstPostgres(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	user := seedRelinkWords(t, pool)
	s := saveStoredBeforeFix(t, pool, user)
	st := NewPostgresStore(pool)

	rep, err := NewRelinker(pool).Run(ctx)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if rep.Stories != 1 || rep.TokensLinked != 2 || rep.StoriesChanged != 1 || rep.Failed != 0 {
		t.Fatalf("report = %+v, want 2 tokens linked in the one story", rep)
	}

	got, err := st.Get(ctx, s.ID, user)
	if err != nil {
		t.Fatalf("get: %v", err)
	}
	toks := got.Sentences[0].Tokens
	byPos := map[string]Token{}
	for _, tok := range toks {
		byPos[tok.Surface] = tok
	}
	if kono := byPos["この"]; kono.EntSeq == nil || *kono.EntSeq != relinkEntKono || kono.Tag != TagUnknown || kono.SRSLevel != nil {
		t.Errorf("この = %+v, want linked, unknown", kono)
	}
	if koro := byPos["頃"]; koro.EntSeq == nil || *koro.EntSeq != relinkEntKoro || koro.Tag != TagKnown || koro.SRSLevel == nil || *koro.SRSLevel != 5 {
		t.Errorf("頃 = %+v, want linked, known at level 5", koro)
	}
	if ha := byPos["は"]; ha.EntSeq != nil {
		t.Errorf("は = %+v, want it left unlinked", ha)
	}
	// The pre-existing link is untouched.
	if atsui := byPos["暑い"]; atsui.EntSeq == nil || *atsui.EntSeq != relinkEntAtsui {
		t.Errorf("暑い = %+v, want its stored link kept", atsui)
	}

	// The gate counts were recorded at generation time and stay as they were.
	if got.ContentWords != 1 || got.KnownWords != 0 || got.FocusItems != 1 || got.FocusHit != 0 {
		t.Errorf("gate counts moved: content=%d known=%d focus=%d hit=%d",
			got.ContentWords, got.KnownWords, got.FocusItems, got.FocusHit)
	}
	// Vocabulary Items: the old one first with its flag, then the new ones.
	if len(got.VocabItems) != 3 {
		t.Fatalf("vocab items = %+v, want 3", got.VocabItems)
	}
	if v := got.VocabItems[0]; v.EntSeq != relinkEntAtsui || !v.IsFocus {
		t.Errorf("existing vocab item changed: %+v", v)
	}
	if got.VocabItems[1].EntSeq != relinkEntKono || got.VocabItems[1].IsKnown {
		t.Errorf("この vocab item = %+v", got.VocabItems[1])
	}
	if got.VocabItems[2].EntSeq != relinkEntKoro || !got.VocabItems[2].IsKnown {
		t.Errorf("頃 vocab item = %+v, want IsKnown", got.VocabItems[2])
	}

	// A second run finds nothing new to link and writes nothing.
	again, err := NewRelinker(pool).Run(ctx)
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if again.TokensLinked != 0 || again.StoriesChanged != 0 {
		t.Fatalf("second report = %+v, want nothing linked", again)
	}
}

// SaveLinks must never overwrite a link that is already there, and a failed
// link must roll back the whole save: the NULL token in the same call stays
// unlinked and vocab_items is unchanged.
func TestSaveLinksNeverOverwritesAnExistingLink(t *testing.T) {
	pool := dbtest.New(t)
	ctx := context.Background()
	user := seedRelinkWords(t, pool)
	s := saveStoredBeforeFix(t, pool, user)
	st := NewPostgresStore(pool)

	before, err := st.Get(ctx, s.ID, user)
	if err != nil {
		t.Fatalf("get before: %v", err)
	}
	var konoPos, atsuiPos = -1, -1
	for _, tok := range before.Sentences[0].Tokens {
		switch tok.Surface {
		case "この":
			konoPos = tok.Pos
		case "暑い":
			atsuiPos = tok.Pos
		}
	}
	if konoPos < 0 || atsuiPos < 0 {
		t.Fatal("stored sentence lacks この or 暑い")
	}
	sentenceID := before.Sentences[0].ID

	// A valid link for the NULL この, then a conflicting link aimed at the
	// already-linked 暑い with a different ent_seq, and a changed vocab list.
	links := []TokenLink{
		{SentenceID: sentenceID, Pos: konoPos, EntSeq: relinkEntKono, Dictionary: "この", Tag: TagUnknown},
		{SentenceID: sentenceID, Pos: atsuiPos, EntSeq: relinkEntKoro, Dictionary: "頃", Tag: TagKnown, SRSLevel: ptr(5)},
	}
	changed := append(append([]VocabItem(nil), before.VocabItems...), VocabItem{EntSeq: relinkEntKono, JA: "この"})

	if err := st.SaveLinks(ctx, s.ID, links, changed); err == nil {
		t.Fatal("SaveLinks over an already-linked token succeeded, want an error")
	}

	after, err := st.Get(ctx, s.ID, user)
	if err != nil {
		t.Fatalf("get after: %v", err)
	}
	var atsuiBefore, atsuiAfter Token
	for _, tok := range before.Sentences[0].Tokens {
		if tok.Pos == atsuiPos {
			atsuiBefore = tok
		}
	}
	for _, tok := range after.Sentences[0].Tokens {
		switch tok.Pos {
		case atsuiPos:
			atsuiAfter = tok
		case konoPos:
			if tok.EntSeq != nil {
				t.Errorf("この was linked to %d although the save failed; the rollback must be all-or-nothing", *tok.EntSeq)
			}
		}
	}
	if atsuiAfter.EntSeq == nil || *atsuiAfter.EntSeq != *atsuiBefore.EntSeq ||
		atsuiAfter.Dictionary != atsuiBefore.Dictionary || atsuiAfter.Tag != atsuiBefore.Tag {
		t.Errorf("暑い = %+v, want unchanged from %+v", atsuiAfter, atsuiBefore)
	}
	if len(after.VocabItems) != len(before.VocabItems) {
		t.Errorf("vocab items = %+v, want unchanged from %+v", after.VocabItems, before.VocabItems)
	}
}
