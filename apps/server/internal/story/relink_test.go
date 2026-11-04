package story

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
)

// fakeRelinkStore keeps Stories in memory. Get hands out a copy, as the
// Postgres store does, so a relink never mutates what the store holds until
// SaveLinks is called.
type fakeRelinkStore struct {
	refs   []StoryRef
	stored map[uuid.UUID]*Story
	getErr map[uuid.UUID]error
	saves  int
}

func (f *fakeRelinkStore) StoryRefs(context.Context) ([]StoryRef, error) { return f.refs, nil }

func (f *fakeRelinkStore) Get(_ context.Context, id, userID uuid.UUID) (*Story, error) {
	if err := f.getErr[id]; err != nil {
		return nil, err
	}
	s, ok := f.stored[id]
	if !ok || s.UserID != userID {
		return nil, ErrNotFound
	}
	return cloneStory(s), nil
}

// SaveLinks applies the way the SQL does: a token gets its link only while it
// has none, and the Vocabulary Items are replaced.
func (f *fakeRelinkStore) SaveLinks(_ context.Context, storyID uuid.UUID, links []TokenLink, vocab []VocabItem) error {
	f.saves++
	s := f.stored[storyID]
	for _, l := range links {
		for i := range s.Sentences {
			sen := &s.Sentences[i]
			if sen.ID != l.SentenceID {
				continue
			}
			tok := &sen.Tokens[l.Pos]
			if tok.EntSeq != nil {
				continue
			}
			seq := l.EntSeq
			tok.EntSeq, tok.Dictionary, tok.Tag, tok.SRSLevel = &seq, l.Dictionary, l.Tag, l.SRSLevel
		}
	}
	s.VocabItems = append([]VocabItem(nil), vocab...)
	return nil
}

func cloneStory(s *Story) *Story {
	c := *s
	c.Sentences = make([]Sentence, len(s.Sentences))
	for i, sen := range s.Sentences {
		sen.Tokens = append([]Token(nil), sen.Tokens...)
		c.Sentences[i] = sen
	}
	c.VocabItems = append([]VocabItem(nil), s.VocabItems...)
	return &c
}

// storedBeforeFix builds a Story the way generation stored it before issue
// #94: the lookup knows only the content word, so the function words carry no
// link, exactly as an old row does. Sentence and Story ids are assigned as the
// database would.
func storedBeforeFix(t *testing.T, owner uuid.UUID, sentences ...string) *Story {
	t.Helper()
	s := materialiseJA(t, owner, fakeLookup{"暑い": {EntSeq: 9001, JA: "暑い"}}, sentences...)
	s.ID = uuid.New()
	for i := range s.Sentences {
		s.Sentences[i].ID = uuid.New()
	}
	return s
}

// relinkWords is the lookup the relink run uses: every function word it must
// NOT link (は and 。) is in it too, so a link on them would show.
func relinkWords() fakeLookup {
	return fakeLookup{
		"この": {EntSeq: 9101, JA: "この"},
		"頃":  {EntSeq: 9102, JA: "頃"},
		"は":  {EntSeq: 9103, JA: "は"},
		"。":  {EntSeq: 9104, JA: "。"},
		"暑い": {EntSeq: 9999, JA: "暑い"},
	}
}

func newRelinkFake(stories ...*Story) *fakeRelinkStore {
	f := &fakeRelinkStore{stored: map[uuid.UUID]*Story{}, getErr: map[uuid.UUID]error{}}
	for _, s := range stories {
		f.stored[s.ID] = s
		f.refs = append(f.refs, StoryRef{ID: s.ID, UserID: s.UserID})
	}
	return f
}

func findTok(t *testing.T, s *Story, sentence int, surface string) Token {
	t.Helper()
	return tokenNamed(t, s, sentence, surface)
}

func TestRelinkFillsMissingLinksAndAppendsVocabulary(t *testing.T) {
	owner := uuid.New()
	s := storedBeforeFix(t, owner, "この頃は暑い。")
	// The Learner's existing item keeps its flags through the relink.
	s.VocabItems[0].IsFocus = true
	s.VocabItems[0].IsKnown = true
	s.VocabItems[0].EN = "hot"
	f := newRelinkFake(s)

	rep, err := newRelinker(f, relinkWords(), fakeKnown{}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if rep.TokensLinked != 2 || rep.StoriesChanged != 1 || rep.Failed != 0 {
		t.Fatalf("report = %+v, want 2 tokens linked in 1 story", rep)
	}

	got := f.stored[s.ID]
	if tok := findTok(t, got, 0, "この"); tok.EntSeq == nil || *tok.EntSeq != 9101 {
		t.Errorf("この = %+v, want linked to 9101", tok)
	}
	if tok := findTok(t, got, 0, "頃"); tok.EntSeq == nil || *tok.EntSeq != 9102 {
		t.Errorf("頃 = %+v, want linked to 9102", tok)
	}
	for _, surface := range []string{"は", "。"} {
		if tok := findTok(t, got, 0, surface); tok.EntSeq != nil {
			t.Errorf("%q = %+v, want it left unlinked", surface, tok)
		}
	}
	if tok := findTok(t, got, 0, "暑い"); tok.EntSeq == nil || *tok.EntSeq != 9001 {
		t.Errorf("暑い = %+v, want its stored link 9001 untouched", tok)
	}

	if len(got.VocabItems) != 3 {
		t.Fatalf("vocab items = %+v, want the old one plus two new ones", got.VocabItems)
	}
	if v := got.VocabItems[0]; v.EntSeq != 9001 || !v.IsFocus || !v.IsKnown || v.EN != "hot" {
		t.Errorf("existing vocab item changed: %+v", v)
	}
	if got.VocabItems[1].EntSeq != 9101 || got.VocabItems[2].EntSeq != 9102 {
		t.Errorf("new vocab items = %+v, want この then 頃 appended", got.VocabItems[1:])
	}
	for _, v := range got.VocabItems[1:] {
		if v.IsFocus {
			t.Errorf("new vocab item %+v must not be a focus item", v)
		}
	}
}

func TestRelinkTagsNewLinksAgainstKnownItems(t *testing.T) {
	owner := uuid.New()
	s := storedBeforeFix(t, owner, "この頃は暑い。")
	f := newRelinkFake(s)
	known := fakeKnown{9102: {IsKnown: true, SRSLevel: 5}}

	if _, err := newRelinker(f, relinkWords(), known).Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}

	got := f.stored[s.ID]
	kono := findTok(t, got, 0, "この")
	if kono.Tag != TagUnknown || kono.SRSLevel != nil {
		t.Errorf("この = %+v, want unknown with no SRS level", kono)
	}
	koro := findTok(t, got, 0, "頃")
	if koro.Tag != TagKnown || koro.SRSLevel == nil || *koro.SRSLevel != 5 {
		t.Errorf("頃 = %+v, want known at SRS level 5", koro)
	}
	if got.VocabItems[2].EntSeq != 9102 || !got.VocabItems[2].IsKnown {
		t.Errorf("new vocab item for 頃 = %+v, want IsKnown", got.VocabItems[2])
	}
}

func TestRelinkIsIdempotent(t *testing.T) {
	owner := uuid.New()
	s := storedBeforeFix(t, owner, "この頃は暑い。")
	f := newRelinkFake(s)
	r := newRelinker(f, relinkWords(), fakeKnown{})

	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("first Run: %v", err)
	}
	rep, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("second Run: %v", err)
	}
	if rep.TokensLinked != 0 || rep.StoriesChanged != 0 {
		t.Errorf("second run report = %+v, want nothing linked", rep)
	}
	if f.saves != 1 {
		t.Errorf("SaveLinks called %d times across two runs, want exactly 1", f.saves)
	}
}

func TestRelinkNeverChangesAnExistingLink(t *testing.T) {
	owner := uuid.New()
	s := storedBeforeFix(t, owner, "この頃は暑い。")
	f := newRelinkFake(s)
	// The lookup would now link 暑い to a different entry (9999). The stored
	// link (9001) must win, because the relink only ever fills in NULLs.
	if _, err := newRelinker(f, relinkWords(), fakeKnown{}).Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	got := f.stored[s.ID]
	if tok := findTok(t, got, 0, "暑い"); tok.EntSeq == nil || *tok.EntSeq != 9001 {
		t.Errorf("暑い = %+v, want the existing link 9001 kept", tok)
	}
	for _, v := range got.VocabItems {
		if v.EntSeq == 9999 {
			t.Errorf("a vocab item for the conflicting entry was appended: %+v", v)
		}
	}
}

func TestRelinkSkipsASentenceThatDoesNotMatchKagome(t *testing.T) {
	owner := uuid.New()
	s := storedBeforeFix(t, owner, "この頃は暑い。", "この頃は暑い。")
	// The stored tokens of the second sentence no longer line up with kagome.
	s.Sentences[1].Tokens[0].Surface = "違う"
	f := newRelinkFake(s)

	rep, err := newRelinker(f, relinkWords(), fakeKnown{}).Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if rep.SentencesSkipped != 1 {
		t.Errorf("SentencesSkipped = %d, want 1", rep.SentencesSkipped)
	}
	got := f.stored[s.ID]
	if tok := findTok(t, got, 0, "この"); tok.EntSeq == nil {
		t.Error("the matching sentence was not relinked")
	}
	if tok := got.Sentences[1].Tokens[0]; tok.EntSeq != nil {
		t.Errorf("the mismatched sentence was touched: %+v", tok)
	}
}

func TestRelinkCountsAFailedStoryAndContinues(t *testing.T) {
	owner := uuid.New()
	broken := storedBeforeFix(t, owner, "この頃は暑い。")
	fine := storedBeforeFix(t, owner, "この頃は暑い。")
	f := newRelinkFake(broken, fine)
	f.getErr[broken.ID] = errors.New("boom")

	rep, err := newRelinker(f, relinkWords(), fakeKnown{}).Run(context.Background())
	if err == nil {
		t.Fatal("Run returned no error although a story failed")
	}
	if rep.Failed != 1 || rep.Stories != 2 {
		t.Errorf("report = %+v, want 1 failed of 2 stories", rep)
	}
	if rep.TokensLinked != 2 {
		t.Errorf("TokensLinked = %d, want the healthy story still relinked", rep.TokensLinked)
	}
}
