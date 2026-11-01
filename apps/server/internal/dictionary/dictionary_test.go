package dictionary

import (
	"context"
	"reflect"
	"testing"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// Unit tests for the reductions the service applies to reference data:
// mora counting for the pitch graph, Kanjium accent reduction, kanji
// extraction for the component breakdown, and headword/reading choice.

type stubRefs struct {
	accents map[string][]refdata.PitchAccent
}

func (stubRefs) VocabularyByEntSeq(_ context.Context, _ int64) ([]refdata.Vocabulary, error) {
	return nil, nil
}

func (s stubRefs) PitchAccents(_ context.Context, word, reading string) ([]refdata.PitchAccent, error) {
	return s.accents[word+"\x00"+reading], nil
}

func TestCountMoras(t *testing.T) {
	for reading, want := range map[string]int{
		"がっこう":  4, // the geminate っ takes a mora of its own
		"せんせい":  4,
		"とうきょう": 4, // the small ょ folds into き
		"テーブル":  4, // the prolonged-sound mark counts
		"ン":     1,
		"":      0,
		"学校":    0, // kanji are not mora material
	} {
		if got := countMoras(reading); got != want {
			t.Errorf("countMoras(%q) = %d, want %d", reading, got, want)
		}
	}
}

func TestPitchReduction(t *testing.T) {
	s := NewService(stubRefs{accents: map[string][]refdata.PitchAccent{
		"学校\x00がっこう": {{Position: 0, Primary: true}},
		"先生\x00せんせい": {{Position: 3, Tag: "名"}, {Position: 0}},
		"変\x00ぺえ":    {{Position: 9}}, // beyond the word's mora count
	}}, nil, nil)
	ctx := context.Background()

	p, err := s.pitch(ctx, "学校", "がっこう")
	if err != nil {
		t.Fatal(err)
	}
	if p == nil || p.MoraCount != 4 || p.AccentPosition != 0 || !p.Heiban || p.DownstepAfterMora != 5 || p.Tag != "" {
		t.Errorf("heiban = %+v, want 4 morae, heiban, downstep at 5", p)
	}

	p, err = s.pitch(ctx, "先生", "せんせい")
	if err != nil {
		t.Fatal(err)
	}
	if p == nil || p.AccentPosition != 3 || p.Heiban || p.DownstepAfterMora != 3 || p.Tag != "名" {
		t.Errorf("accented = %+v, want the first pattern: accent 3, tag 名", p)
	}

	p, err = s.pitch(ctx, "変", "ぺえ")
	if err != nil {
		t.Fatal(err)
	}
	if p == nil || p.DownstepAfterMora != 2 || p.AccentPosition != 9 {
		t.Errorf("out-of-range accent = %+v, want the downstep clamped to the last mora", p)
	}

	p, err = s.pitch(ctx, "未知", "みち")
	if err != nil {
		t.Fatal(err)
	}
	if p != nil {
		t.Errorf("no Kanjium rows = %+v, want a nil pitch, not an error", p)
	}

	p, err = s.pitch(ctx, "", "みち")
	if err != nil {
		t.Fatal(err)
	}
	if p != nil {
		t.Errorf("empty headword = %+v, want nil", p)
	}
}

func TestKanjiIn(t *testing.T) {
	for s, want := range map[string][]string{
		"学校":     {"学", "校"},
		"勉強する":   {"勉", "強"},
		"数度数数":   {"数", "度"}, // distinct, in order of first appearance
		"ねこ":     nil,
		"行きました。": {"行"},
	} {
		if got := kanjiIn(s); !reflect.DeepEqual(got, want) {
			t.Errorf("kanjiIn(%q) = %v, want %v", s, got, want)
		}
	}
}

func TestChooseHeadwordAndReading(t *testing.T) {
	v := refdata.Vocabulary{JMdictEntry: refdata.JMdictEntry{
		Kanji:    []refdata.JMdictKanji{{Text: "切る"}, {Text: "断つ"}},
		Readings: []refdata.JMdictReading{{Text: "きる"}, {Text: "だつ"}},
	}}
	if got := chooseHeadword(v, "断つ"); got != "断つ" {
		t.Errorf("tapped form present = %q, want 断つ", got)
	}
	if got := chooseHeadword(v, "茶"); got != "切る" {
		t.Errorf("tapped form absent = %q, want the first kanji form", got)
	}
	if got := chooseReading(v, "だつ"); got != "だつ" {
		t.Errorf("tapped reading present = %q, want だつ", got)
	}
	if got := chooseReading(v, ""); got != "きる" {
		t.Errorf("empty reading = %q, want the first reading", got)
	}

	kana := refdata.Vocabulary{JMdictEntry: refdata.JMdictEntry{
		Readings: []refdata.JMdictReading{{Text: "ねこ"}},
	}}
	if got := chooseHeadword(kana, "ねこ"); got != "ねこ" {
		t.Errorf("kana-only headword = %q, want the first reading", got)
	}
}

// --- Entry's scoring gate ---------------------------------------------------
// Score walks the Learner's whole Known Item set (four table queries). Entry
// may only call it when the word itself, or one of the kanji it shows, is a
// Known Item — hovering an unknown word must not re-score the library.

type gateRefs struct{ vocab []refdata.Vocabulary }

func (g gateRefs) VocabularyByEntSeq(_ context.Context, _ int64) ([]refdata.Vocabulary, error) {
	return g.vocab, nil
}

func (gateRefs) PitchAccents(_ context.Context, _, _ string) ([]refdata.PitchAccent, error) {
	return nil, nil
}

type gateKnown struct {
	srs       int
	wordKnown bool
	kanji     map[string]int
}

func (g gateKnown) KnownVocabulary(_ context.Context, _ uuid.UUID, _ int64) (int, bool, error) {
	return g.srs, g.wordKnown, nil
}

func (g gateKnown) KnownKanji(_ context.Context, _ uuid.UUID, _ []string) (map[string]int, error) {
	if g.kanji == nil {
		return map[string]int{}, nil
	}
	return g.kanji, nil
}

type countingScorer struct {
	calls  int
	scores []mastery.ScoredItem
}

func (c *countingScorer) Score(_ context.Context, _ uuid.UUID) ([]mastery.ScoredItem, error) {
	c.calls++
	return c.scores, nil
}

func shopVocab() []refdata.Vocabulary {
	return []refdata.Vocabulary{{JMdictEntry: refdata.JMdictEntry{
		EntSeq:   101,
		Kanji:    []refdata.JMdictKanji{{Text: "店"}},
		Readings: []refdata.JMdictReading{{Text: "みせ"}},
		Senses:   []refdata.JMdictSense{{POS: []string{"noun"}, Glosses: []string{"shop, store"}}},
	}}}
}

func TestEntryDoesNotScoreUnknownWords(t *testing.T) {
	scorer := &countingScorer{}
	svc := NewService(gateRefs{vocab: shopVocab()}, gateKnown{}, scorer)

	e, err := svc.Entry(context.Background(), uuid.New(), 101, "店", "みせ")
	if err != nil {
		t.Fatal(err)
	}
	if scorer.calls != 0 {
		t.Errorf("scorer called %d times for a word and kanji the Learner does not know, want 0", scorer.calls)
	}
	if e.Mastery != nil {
		t.Errorf("Mastery = %v for an unknown word, want nil", *e.Mastery)
	}
	if len(e.Components) != 1 || e.Components[0].Known {
		t.Fatalf("components = %+v, want one unknown 店", e.Components)
	}
}

func TestEntryScoresKnownWordsAndKanji(t *testing.T) {
	scores := []mastery.ScoredItem{
		{Item: mastery.KnownItem{Key: mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: "101"}}, Mastery: 0.8},
		{Item: mastery.KnownItem{Key: mastery.ItemKey{Kind: mastery.KindKanji, Ref: "店"}}, Mastery: 0.5},
	}

	t.Run("known word", func(t *testing.T) {
		scorer := &countingScorer{scores: scores}
		svc := NewService(gateRefs{vocab: shopVocab()}, gateKnown{srs: 3, wordKnown: true}, scorer)
		e, err := svc.Entry(context.Background(), uuid.New(), 101, "店", "みせ")
		if err != nil {
			t.Fatal(err)
		}
		if scorer.calls != 1 {
			t.Errorf("scorer called %d times for a known word, want 1", scorer.calls)
		}
		if e.Mastery == nil || *e.Mastery != 0.8 {
			t.Errorf("Mastery = %v, want 0.8", e.Mastery)
		}
	})

	t.Run("unknown word, known kanji", func(t *testing.T) {
		scorer := &countingScorer{scores: scores}
		svc := NewService(gateRefs{vocab: shopVocab()}, gateKnown{kanji: map[string]int{"店": 2}}, scorer)
		e, err := svc.Entry(context.Background(), uuid.New(), 101, "店", "みせ")
		if err != nil {
			t.Fatal(err)
		}
		if scorer.calls != 1 {
			t.Errorf("scorer called %d times when a constituent kanji is known, want 1", scorer.calls)
		}
		if len(e.Components) != 1 {
			t.Fatalf("components = %+v, want one 店", e.Components)
		}
		c := e.Components[0]
		if !c.Known || c.SRSLevel == nil || *c.SRSLevel != 2 {
			t.Errorf("component 店 = %+v, want known at SRS Level 2", c)
		}
		if c.Mastery == nil || *c.Mastery != 0.5 {
			t.Errorf("component Mastery = %v, want 0.5", c.Mastery)
		}
	})
}
