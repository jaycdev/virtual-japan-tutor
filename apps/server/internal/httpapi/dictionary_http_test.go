package httpapi_test

import (
	"context"
	"errors"
	"math"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth/authtest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dictionary"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery/masterytest"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// Dictionary HTTP tests (issue #11): the Lookup row and Dictionary Entry
// window read exactly one endpoint. Reference data and Known-Item state come
// from fakes; Mastery comes from the real scoring service over an in-memory
// store, on a fixed clock, so the expected numbers are exact.

// dictClock keeps decay-free fixtures: SRS-only items score srs/9.
var dictClock = time.Date(2026, 11, 2, 9, 0, 0, 0, time.UTC)

// fakeRefs is a dictionary.RefStore fixture.
type fakeRefs struct {
	byEntSeq map[int64][]refdata.Vocabulary
	accents  map[string][]refdata.PitchAccent
	err      error
}

func (f *fakeRefs) VocabularyByEntSeq(_ context.Context, entSeq int64) ([]refdata.Vocabulary, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.byEntSeq[entSeq], nil
}

func (f *fakeRefs) PitchAccents(_ context.Context, word, reading string) ([]refdata.PitchAccent, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.accents[word+"\x00"+reading], nil
}

// fakeKnown is a dictionary.KnownStore fixture, scoped like the real store:
// only owner's Known Items come back.
type fakeKnown struct {
	owner      uuid.UUID
	vocabSRS   int
	vocabKnown bool
	kanjiSRS   map[string]int
}

func (f *fakeKnown) KnownVocabulary(_ context.Context, userID uuid.UUID, _ int64) (int, bool, error) {
	if userID != f.owner || !f.vocabKnown {
		return 0, false, nil
	}
	return f.vocabSRS, true, nil
}

func (f *fakeKnown) KnownKanji(_ context.Context, userID uuid.UUID, literals []string) (map[string]int, error) {
	out := map[string]int{}
	if userID != f.owner {
		return out, nil
	}
	for _, lit := range literals {
		if lvl, ok := f.kanjiSRS[lit]; ok {
			out[lit] = lvl
		}
	}
	return out, nil
}

// schoolEntry is 学校 as JMdict carries it (ent_seq 1162857), trimmed to the
// fields the reader shows.
func schoolEntry() refdata.Vocabulary {
	return refdata.Vocabulary{
		JMdictEntry: refdata.JMdictEntry{
			EntSeq:   1162857,
			Common:   true,
			Kanji:    []refdata.JMdictKanji{{Text: "学校"}},
			Readings: []refdata.JMdictReading{{Text: "がっこう"}},
			Senses: []refdata.JMdictSense{
				{POS: []string{"noun"}, Glosses: []string{"school", "secondary school"}},
			},
		},
		JLPTLevel: refdata.N5,
	}
}

type dictEnv struct {
	e       env
	refs    *fakeRefs
	known   *fakeKnown
	ms      *masterytest.MemStore
	aliceID uuid.UUID
}

func newDictEnv(t *testing.T) *dictEnv {
	t.Helper()
	clock := authtest.NewFakeClock()
	authSvc := auth.NewService(authtest.NewMemStore(), auth.Options{TTL: time.Hour, Now: clock.Now, PasswordParams: authtest.FastPasswordParams})
	alice, err := authSvc.CreateUser(context.Background(), "alice", password)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authSvc.CreateUser(context.Background(), "bob", password); err != nil {
		t.Fatal(err)
	}

	o := &dictEnv{
		refs: &fakeRefs{
			byEntSeq: map[int64][]refdata.Vocabulary{1162857: {schoolEntry()}},
			accents: map[string][]refdata.PitchAccent{
				"学校\x00がっこう": {{Position: 0, Primary: true}},
			},
		},
		known: &fakeKnown{owner: alice.ID, vocabSRS: 2, vocabKnown: true, kanjiSRS: map[string]int{"学": 8}},
		ms:    masterytest.NewMemStore(),
	}
	// alice's Known Items mirror the fakeKnown fixture; the mastery service
	// is the same scorer the Focus Set uses, on a fixed clock.
	o.ms.AddKnownItem(alice.ID, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "1162857"}, MaruMoriID: "Vocab/1",
		SRSLevel: ptrInt(2), Source: mastery.SourceMaruMori,
	})
	o.ms.AddKnownItem(alice.ID, mastery.KnownItem{
		Key: mastery.ItemKey{Kind: mastery.KindKanji, Ref: "学"}, MaruMoriID: "Kanji/9",
		SRSLevel: ptrInt(8), Source: mastery.SourceMaruMori,
	})
	opts := mastery.DefaultOptions()
	opts.Now = func() time.Time { return dictClock }
	scorer := mastery.NewService(o.ms, opts)

	svc := dictionary.NewService(o.refs, o.known, scorer)
	o.e = env{h: httpapi.New(fakeDB{}, authSvc, httpapi.WithDictionary(svc)), svc: authSvc, clock: clock}
	o.aliceID = alice.ID
	return o
}

func (o *dictEnv) get(t *testing.T, path string, user string) (*http.Response, api.DictionaryEntry) {
	t.Helper()
	rec := o.e.do(t, "GET", path, "Bearer "+o.e.login(t, user), nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET %s = %d (%s)", path, rec.Code, rec.Body)
	}
	var body api.DictionaryEntry
	mustJSON(t, rec, &body)
	return rec.Result(), body
}

func TestGetDictionaryEntryRequiresASession(t *testing.T) {
	o := newDictEnv(t)
	wantError(t, o.e.do(t, "GET", "/dictionary/entries/1162857", "", nil), http.StatusUnauthorized, "unauthorized")
}

func TestGetDictionaryEntryMalformedEntSeqIsNotFound(t *testing.T) {
	o := newDictEnv(t)
	for _, raw := range []string{"abc", "0", "-5", "1x"} {
		wantError(t, o.e.do(t, "GET", "/dictionary/entries/"+raw, "Bearer "+o.e.login(t, "alice"), nil),
			http.StatusNotFound, "not_found")
	}
}

func TestGetDictionaryEntryNotConfiguredIsAServiceError(t *testing.T) {
	e := newEnv(t, fakeDB{})
	rec := e.do(t, "GET", "/dictionary/entries/1162857", "Bearer "+e.login(t, "alice"), nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (%s)", rec.Code, rec.Body)
	}
}

func TestGetDictionaryEntryFullShape(t *testing.T) {
	o := newDictEnv(t)
	_, e := o.get(t, "/dictionary/entries/1162857?surface=%E5%AD%A6%E6%A0%A1&reading=%E3%81%8C%E3%81%A3%E3%81%93%E3%81%86", "alice")

	if e.EntSeq != 1162857 || !e.Found {
		t.Fatalf("entSeq/found = %d/%v, want 1162857/true", e.EntSeq, e.Found)
	}
	if e.Headword != "学校" || e.Reading != "がっこう" {
		t.Errorf("headword/reading = %q/%q, want the tapped forms echoed back", e.Headword, e.Reading)
	}
	if e.JlptLevel == nil || *e.JlptLevel != api.GrammarJLPTLevelN5 {
		t.Errorf("jlptLevel = %v, want N5", e.JlptLevel)
	}
	if len(e.Senses) != 1 {
		t.Fatalf("senses = %+v, want one", e.Senses)
	}
	sense := e.Senses[0]
	if len(sense.PartsOfSpeech) != 1 || sense.PartsOfSpeech[0] != "noun" {
		t.Errorf("sense partsOfSpeech = %v, want [noun]", sense.PartsOfSpeech)
	}
	if len(sense.Glosses) != 2 || sense.Glosses[0] != "school" || sense.Glosses[1] != "secondary school" {
		t.Errorf("sense glosses = %v, want both in JMdict order", sense.Glosses)
	}
	if len(e.KanjiForms) != 1 || e.KanjiForms[0] != "学校" || len(e.Readings) != 1 || e.Readings[0] != "がっこう" {
		t.Errorf("kanjiForms/readings = %v/%v, want [学校]/[がっこう]", e.KanjiForms, e.Readings)
	}

	// Kanjium has 学校/がっこう as heiban; がっこう is four morae.
	if e.Pitch == nil {
		t.Fatal("pitch = nil, want the heiban pattern")
	}
	if e.Pitch.MoraCount != 4 || e.Pitch.AccentPosition != 0 || !e.Pitch.Heiban || e.Pitch.DownstepAfterMora != 5 {
		t.Errorf("pitch = %+v, want 4 morae, heiban with the downstep nowhere (5)", e.Pitch)
	}
	if e.Pitch.Reading != "がっこう" || e.Pitch.Tag != nil {
		t.Errorf("pitch reading/tag = %q/%v, want がっこう and no tag", e.Pitch.Reading, e.Pitch.Tag)
	}

	// Known Item state: the word at SRS 2 (mastery 2/9 on SRS evidence alone),
	// 学 known at SRS 8 (mastery 8/9), 校 unknown.
	if e.SrsLevel == nil || *e.SrsLevel != 2 {
		t.Fatalf("srsLevel = %v, want 2", e.SrsLevel)
	}
	if e.Mastery == nil || math.Abs(*e.Mastery-2.0/9.0) > 1e-4 {
		t.Errorf("mastery = %v, want ~2/9", e.Mastery)
	}
	if len(e.Kanji) != 2 {
		t.Fatalf("kanji = %+v, want the two characters of the headword in order", e.Kanji)
	}
	学, 校 := e.Kanji[0], e.Kanji[1]
	if 学.Literal != "学" || !学.Known || 学.SrsLevel == nil || *学.SrsLevel != 8 {
		t.Errorf("first kanji = %+v, want 学 known at SRS 8", 学)
	}
	if 学.Mastery == nil || math.Abs(*学.Mastery-8.0/9.0) > 1e-4 {
		t.Errorf("学 mastery = %v, want ~8/9", 学.Mastery)
	}
	if 校.Literal != "校" || 校.Known || 校.SrsLevel != nil || 校.Mastery != nil {
		t.Errorf("second kanji = %+v, want 校 unknown with no state", 校)
	}
}

func TestGetDictionaryEntryUnknownToTheLearnerHasNoState(t *testing.T) {
	o := newDictEnv(t)
	o.known.vocabKnown = false
	o.known.kanjiSRS = nil

	_, e := o.get(t, "/dictionary/entries/1162857", "alice")
	if e.Found && e.Headword == "" {
		t.Fatal("entry lost its headword for an unknown word")
	}
	if e.SrsLevel != nil || e.Mastery != nil {
		t.Errorf("srsLevel/mastery = %v/%v, want nil for a word with no Known Item", e.SrsLevel, e.Mastery)
	}
	if len(e.Kanji) != 2 {
		t.Fatalf("kanji = %+v, want the breakdown even when unknown", e.Kanji)
	}
	for _, k := range e.Kanji {
		if k.Known || k.SrsLevel != nil || k.Mastery != nil {
			t.Errorf("kanji %s = %+v, want no known state", k.Literal, k)
		}
	}
}

func TestGetDictionaryEntryScopedToTheTokensUser(t *testing.T) {
	o := newDictEnv(t)
	_, e := o.get(t, "/dictionary/entries/1162857", "bob")
	if e.SrsLevel != nil || e.Mastery != nil {
		t.Errorf("bob sees alice's state: srsLevel/mastery = %v/%v", e.SrsLevel, e.Mastery)
	}
}

func TestGetDictionaryEntryHeadwordAndReadingFallbacks(t *testing.T) {
	// 切る: two kanji forms and two readings — the tapped form wins when the
	// entry has it, the first form/reading otherwise.
	o := newDictEnv(t)
	o.refs.byEntSeq[1558430] = []refdata.Vocabulary{{
		JMdictEntry: refdata.JMdictEntry{
			EntSeq:   1558430,
			Kanji:    []refdata.JMdictKanji{{Text: "切る"}, {Text: "断つ"}},
			Readings: []refdata.JMdictReading{{Text: "きる"}, {Text: "だつ"}},
			Senses:   []refdata.JMdictSense{{POS: []string{"verb"}, Glosses: []string{"to cut"}}},
		},
	}}

	_, e := o.get(t, "/dictionary/entries/1558430?surface=%E6%96%AD%E3%81%A4&reading=%E3%81%A0%E3%81%A4", "alice")
	if e.Headword != "断つ" || e.Reading != "だつ" {
		t.Errorf("headword/reading = %q/%q, want the tapped less-common forms", e.Headword, e.Reading)
	}

	_, e = o.get(t, "/dictionary/entries/1558430", "alice")
	if e.Headword != "切る" || e.Reading != "きる" {
		t.Errorf("headword/reading = %q/%q, want the entry's first forms without params", e.Headword, e.Reading)
	}

	_, e = o.get(t, "/dictionary/entries/1558430?surface=%E8%8C%B6&reading=%E3%81%8A%E3%81%A1%E3%82%83", "alice")
	if e.Headword != "切る" || e.Reading != "きる" {
		t.Errorf("headword/reading = %q/%q, want fallbacks for forms the entry lacks", e.Headword, e.Reading)
	}
	if e.Pitch != nil {
		t.Errorf("pitch = %+v, want nil: Kanjium has no row in this fixture", e.Pitch)
	}
}

func TestGetDictionaryEntryLinkedButNotInJMDict(t *testing.T) {
	// The tokeniser linked a token to an ent_seq JMdict lacks: the window
	// must still open, showing the tapped form, with empty arrays.
	o := newDictEnv(t)
	_, e := o.get(t, "/dictionary/entries/9999999?surface=%E3%81%AD%E3%81%8F&reading=%E3%81%AD%E3%81%8F", "alice")
	if e.EntSeq != 9999999 || e.Found {
		t.Fatalf("entSeq/found = %d/%v, want 9999999/false", e.EntSeq, e.Found)
	}
	if e.Headword != "ねく" || e.Reading != "ねく" {
		t.Errorf("headword/reading = %q/%q, want the tapped form echoed", e.Headword, e.Reading)
	}
	if len(e.Senses) != 0 || len(e.KanjiForms) != 0 || len(e.Readings) != 0 || len(e.Kanji) != 0 {
		t.Errorf("arrays = %+v, want all empty", e)
	}
	if e.Pitch != nil || e.JlptLevel != nil || e.SrsLevel != nil || e.Mastery != nil {
		t.Errorf("optional fields = %+v, want all nil", e)
	}
}

func TestGetDictionaryEntryPitchWithNonZeroAccentAndTag(t *testing.T) {
	o := newDictEnv(t)
	o.refs.byEntSeq[1558430] = []refdata.Vocabulary{{
		JMdictEntry: refdata.JMdictEntry{
			EntSeq:   1558430,
			Kanji:    []refdata.JMdictKanji{{Text: "先生"}},
			Readings: []refdata.JMdictReading{{Text: "せんせい"}},
			Senses:   []refdata.JMdictSense{{POS: []string{"noun"}, Glosses: []string{"teacher"}}},
		},
	}}
	// Kanjium lists the main pattern first; extras are ignored.
	o.refs.accents["先生\x00せんせい"] = []refdata.PitchAccent{{Position: 3, Tag: "名"}, {Position: 0}}

	_, e := o.get(t, "/dictionary/entries/1558430", "alice")
	if e.Pitch == nil {
		t.Fatal("pitch = nil, want the accent-3 pattern")
	}
	if e.Pitch.MoraCount != 4 || e.Pitch.AccentPosition != 3 || e.Pitch.Heiban || e.Pitch.DownstepAfterMora != 3 {
		t.Errorf("pitch = %+v, want 4 morae, accent 3, downstep after mora 3", e.Pitch)
	}
	if e.Pitch.Tag == nil || *e.Pitch.Tag != "名" {
		t.Errorf("pitch tag = %v, want the Kanjium tag 名", e.Pitch.Tag)
	}
}

func TestGetDictionaryEntryReferenceFailureIsAServiceError(t *testing.T) {
	o := newDictEnv(t)
	o.refs.err = errors.New("reference database unreachable")
	rec := o.e.do(t, "GET", "/dictionary/entries/1162857", "Bearer "+o.e.login(t, "alice"), nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 (%s)", rec.Code, rec.Body)
	}
}
