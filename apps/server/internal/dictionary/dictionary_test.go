package dictionary

import (
	"context"
	"reflect"
	"testing"

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
