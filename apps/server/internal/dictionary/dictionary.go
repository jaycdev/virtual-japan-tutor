// Package dictionary answers the story reader's word lookups (issue #11).
// One lookup per JMdict ent_seq feeds both halves of the reader: the Lookup
// row's hover preview (first senses, JLPT Level, pitch) and the Dictionary
// Entry window (every sense, form and reading, plus the Learner's Known Item
// state for the word and each kanji in the shown headword). Pitch data comes
// from the Kanjium tables (docs/adr/0006); a pair with no rows there is a
// normal result, not an error — the reader then shows no pitch graph.
package dictionary

import (
	"context"
	"fmt"
	"strconv"
	"unicode"

	"github.com/google/uuid"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// RefStore is the reference data an entry is built from. *refdata.Store
// satisfies it. The JLPT Levels ride along on Vocabulary, so no separate
// level queries are needed.
type RefStore interface {
	VocabularyByEntSeq(ctx context.Context, entSeq int64) ([]refdata.Vocabulary, error)
	PitchAccents(ctx context.Context, word, reading string) ([]refdata.PitchAccent, error)
}

// KnownStore reports which halves of an entry the Learner has as Known
// Items. Kanji and vocabulary rows come from marumori_known_items; the SRS
// Level kept for an item is the weakest of its MaruMori rows, matching the
// Mastery store's view of duplicated linked forms.
type KnownStore interface {
	// KnownVocabulary returns the word's SRS Level and whether it is known.
	KnownVocabulary(ctx context.Context, userID uuid.UUID, entSeq int64) (srsLevel int, known bool, err error)
	// KnownKanji maps each known literal among literals to its SRS Level.
	// Literals that are not Known Items are absent from the map.
	KnownKanji(ctx context.Context, userID uuid.UUID, literals []string) (map[string]int, error)
}

// Scorer scores the Learner's Known Items. *mastery.Service satisfies it;
// the window reads Mastery from the same scoring as the Focus Set, so the
// two never disagree.
type Scorer interface {
	Score(ctx context.Context, userID uuid.UUID) ([]mastery.ScoredItem, error)
}

// Entry is one looked-up word: everything the Lookup row and the Dictionary
// Entry window show. Found is false when JMdict has no row for the ent_seq
// the tokeniser stored (rare); the window then shows the tapped form alone.
type Entry struct {
	EntSeq   int64
	Found    bool
	Headword string // the tapped surface when the entry has it, else the first kanji form, else the first reading
	Reading  string // the tapped reading when the entry has it, else the first reading

	JLPT     refdata.Level // "" when the word is on no JLPT list
	Senses   []Sense
	Kanji    []string // the entry's kanji forms, in JMdict order
	Readings []string

	Pitch    *Pitch // nil when Kanjium has no pattern for Headword+Reading
	SRSLevel *int
	Mastery  *float64

	// Components are the kanji making up Headword, in order, each with the
	// Learner's state for it. Kana headwords have none.
	Components []Component
}

// Sense is one JMdict sense: its parts of speech and English glosses.
type Sense struct {
	POS     []string
	Glosses []string
}

// Pitch is the primary Kanjium pattern for the shown reading, reduced to
// what the mora graph needs.
type Pitch struct {
	Reading           string
	MoraCount         int
	AccentPosition    int // Kanjium's number: 0 heiban, N drops after mora N
	Heiban            bool
	DownstepAfterMora int // moraCount+1 when heiban (the drop is nowhere)
	Tag               string
}

// Component is one kanji of the shown headword with the Learner's state.
type Component struct {
	Literal  string
	Known    bool
	SRSLevel *int
	Mastery  *float64
}

// Service builds dictionary entries from reference data and the Learner's
// knowledge state. It is read-only and safe for concurrent use.
type Service struct {
	refs   RefStore
	known  KnownStore
	scorer Scorer
}

func NewService(refs RefStore, known KnownStore, scorer Scorer) *Service {
	return &Service{refs: refs, known: known, scorer: scorer}
}

// Entry looks up entSeq for the tapped token. surface and reading are the
// token's form as it appeared in the story; they choose which of the entry's
// forms and readings to show, and empty values fall back to the entry's
// first form and reading.
func (s *Service) Entry(ctx context.Context, userID uuid.UUID, entSeq int64, surface, reading string) (Entry, error) {
	vocab, err := s.refs.VocabularyByEntSeq(ctx, entSeq)
	if err != nil {
		return Entry{}, fmt.Errorf("dictionary entry %d: %w", entSeq, err)
	}
	if len(vocab) == 0 {
		// Tokeniser-linked but not in JMdict: keep the window openable.
		return Entry{EntSeq: entSeq, Headword: surface, Reading: reading,
			Senses: []Sense{}, Kanji: []string{}, Readings: []string{}, Components: []Component{}}, nil
	}
	v := vocab[0]

	e := Entry{
		EntSeq:   entSeq,
		Found:    true,
		Headword: chooseHeadword(v, surface),
		Reading:  chooseReading(v, reading),
		JLPT:     v.JLPTLevel,
	}
	for _, k := range v.Kanji {
		e.Kanji = append(e.Kanji, k.Text)
	}
	for _, r := range v.Readings {
		e.Readings = append(e.Readings, r.Text)
	}
	for _, sn := range v.Senses {
		e.Senses = append(e.Senses, Sense{POS: nonEmpty(sn.POS), Glosses: nonEmpty(sn.Glosses)})
	}

	if e.Pitch, err = s.pitch(ctx, e.Headword, e.Reading); err != nil {
		return Entry{}, err
	}

	srs, known, err := s.known.KnownVocabulary(ctx, userID, entSeq)
	if err != nil {
		return Entry{}, err
	}
	if known {
		e.SRSLevel = &srs
	}

	literals := kanjiIn(e.Headword)
	knownKanji, err := s.known.KnownKanji(ctx, userID, literals)
	if err != nil {
		return Entry{}, err
	}

	// Score only when something in this entry is a Known Item. Score walks
	// the Learner's whole Known Item set (four table queries); for a word
	// and kanji the Learner has never touched, every Mastery it could fill
	// is absent anyway, so hovering an unknown word costs no scoring.
	var masteryBy map[mastery.ItemKey]float64
	if known || len(knownKanji) > 0 {
		scores, err := s.scorer.Score(ctx, userID)
		if err != nil {
			return Entry{}, err
		}
		masteryBy = make(map[mastery.ItemKey]float64, len(scores))
		for _, sc := range scores {
			masteryBy[sc.Key()] = sc.Mastery
		}
	}
	if known {
		if m, ok := masteryBy[mastery.ItemKey{Kind: mastery.KindVocabulary, Ref: strconv.FormatInt(entSeq, 10)}]; ok {
			e.Mastery = &m
		}
	}

	for _, lit := range literals {
		c := Component{Literal: lit}
		if lvl, ok := knownKanji[lit]; ok {
			c.Known = true
			c.SRSLevel = &lvl
			if m, ok := masteryBy[mastery.ItemKey{Kind: mastery.KindKanji, Ref: lit}]; ok {
				c.Mastery = &m
			}
		}
		e.Components = append(e.Components, c)
	}

	sliceDefaults(&e)
	return e, nil
}

// pitch takes Kanjium's primary pattern for the pair. No rows is a nil
// pitch, not an error: ADR-0006 kept only the pairs Kanjium covers.
func (s *Service) pitch(ctx context.Context, headword, reading string) (*Pitch, error) {
	if headword == "" || reading == "" {
		return nil, nil
	}
	accents, err := s.refs.PitchAccents(ctx, headword, reading)
	if err != nil {
		return nil, err
	}
	if len(accents) == 0 {
		return nil, nil
	}
	a := accents[0] // Kanjium lists the most common pattern first
	moras := countMoras(reading)
	p := &Pitch{
		Reading:        reading,
		MoraCount:      moras,
		AccentPosition: a.Position,
		Heiban:         a.Position == 0,
		Tag:            a.Tag,
	}
	switch {
	case a.Position == 0:
		p.DownstepAfterMora = moras + 1
	case a.Position >= moras:
		p.DownstepAfterMora = moras // data says the drop is past the last mora
	default:
		p.DownstepAfterMora = a.Position
	}
	return p, nil
}

func chooseHeadword(v refdata.Vocabulary, surface string) string {
	for _, k := range v.Kanji {
		if k.Text == surface {
			return surface
		}
	}
	if len(v.Kanji) > 0 {
		return v.Kanji[0].Text
	}
	if len(v.Readings) > 0 {
		return v.Readings[0].Text
	}
	return surface
}

func chooseReading(v refdata.Vocabulary, reading string) string {
	for _, r := range v.Readings {
		if r.Text == reading {
			return reading
		}
	}
	if len(v.Readings) > 0 {
		return v.Readings[0].Text
	}
	return reading
}

// kanjiIn returns the distinct kanji literals in s, in order of appearance.
// Kana, punctuation and the prolonged-sound mark are not kanji.
func kanjiIn(s string) []string {
	var out []string
	done := map[rune]bool{}
	for _, r := range s {
		if !isKanji(r) || done[r] {
			continue
		}
		done[r] = true
		out = append(out, string(r))
	}
	return out
}

func isKanji(r rune) bool {
	return unicode.Is(unicode.Han, r)
}

// smallKana are the kana that never carry a mora of their own; the geminate
// っ is NOT among them because a doubled consonant takes a mora of its own
// (がっこう is four morae).
const smallKana = "ぁぃぅぇぉゃゅょゎァィゥェォャュョヮヵヶ"

// countMoras approximates the mora count of a kana reading: one per full-size
// kana, including ン and the prolonged-sound marks. Sound changes such as
// とうきょう's long vowel are not split — an approximation the mora graph
// renders proportionally anyway (docs/adr/0006 kept Kanjium's numbers, not
// mora segmentation).
func countMoras(reading string) int {
	n := 0
	for _, r := range reading {
		if r == 'ー' || r == '〜' {
			n++
			continue
		}
		if !unicode.Is(unicode.Hiragana, r) && !unicode.Is(unicode.Katakana, r) {
			continue
		}
		if !isSmallKana(r) {
			n++
		}
	}
	return n
}

func isSmallKana(r rune) bool {
	for _, s := range smallKana {
		if r == s {
			return true
		}
	}
	return false
}

func nonEmpty(ss []string) []string {
	if ss == nil {
		return []string{}
	}
	return ss
}

// sliceDefaults keeps required arrays non-nil so the API always serialises
// [] rather than null.
func sliceDefaults(e *Entry) {
	if e.Senses == nil {
		e.Senses = []Sense{}
	}
	if e.Kanji == nil {
		e.Kanji = []string{}
	}
	if e.Readings == nil {
		e.Readings = []string{}
	}
	if e.Components == nil {
		e.Components = []Component{}
	}
}
