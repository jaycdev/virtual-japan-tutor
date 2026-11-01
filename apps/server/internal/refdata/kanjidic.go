package refdata

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"strings"
)

// KanjidicHeader is the <header> block of KANJIDIC2.
type KanjidicHeader struct {
	DatabaseVersion string
	Created         string
}

// KanjidicEntry is one <character>. The optional numeric fields are nil when
// KANJIDIC2 does not give them.
type KanjidicEntry struct {
	Literal     string
	Grade       *int // 1-6 kyouiku, 8 remaining jouyou, 9-10 jinmeiyou
	StrokeCount int  // the first (accepted) count
	Frequency   *int // 1 = most frequent of the 2,500 most used in newspapers
	// LegacyJLPT is KANJIDIC2's <jlpt> value. It uses the pre-2010 four-level
	// scale (4 = easiest, 1 = hardest), which does not map onto N5-N1, so it is
	// stored for reference only and never used as a JLPT Level.
	LegacyJLPT *int
	On         []string
	Kun        []string
	Meanings   []string // English only
	Nanori     []string
}

type xmlKanjidicHeader struct {
	Version string `xml:"database_version"`
	Created string `xml:"date_of_creation"`
}

type xmlCharacter struct {
	Literal string `xml:"literal"`
	Misc    struct {
		Grade   []int `xml:"grade"`
		Strokes []int `xml:"stroke_count"`
		Freq    []int `xml:"freq"`
		JLPT    []int `xml:"jlpt"`
	} `xml:"misc"`
	RM struct {
		Groups []struct {
			Readings []struct {
				Type string `xml:"r_type,attr"`
				Text string `xml:",chardata"`
			} `xml:"reading"`
			Meanings []struct {
				Lang string `xml:"m_lang,attr"`
				Text string `xml:",chardata"`
			} `xml:"meaning"`
		} `xml:"rmgroup"`
		Nanori []string `xml:"nanori"`
	} `xml:"reading_meaning"`
}

// ParseKanjidic streams a KANJIDIC2 XML document (ungzipped), calling fn for
// each character in document order.
func ParseKanjidic(r io.Reader, fn func(KanjidicEntry) error) (KanjidicHeader, error) {
	var hdr KanjidicHeader
	dec := xml.NewDecoder(r)
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			return hdr, nil
		}
		if err != nil {
			return hdr, fmt.Errorf("kanjidic2 xml: %w", err)
		}
		start, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "header":
			var h xmlKanjidicHeader
			if err := dec.DecodeElement(&h, &start); err != nil {
				return hdr, fmt.Errorf("kanjidic2 header: %w", err)
			}
			hdr = KanjidicHeader{DatabaseVersion: strings.TrimSpace(h.Version), Created: strings.TrimSpace(h.Created)}
		case "character":
			var c xmlCharacter
			if err := dec.DecodeElement(&c, &start); err != nil {
				return hdr, fmt.Errorf("kanjidic2 character: %w", err)
			}
			if err := fn(convertCharacter(c)); err != nil {
				return hdr, err
			}
		}
	}
}

func convertCharacter(c xmlCharacter) KanjidicEntry {
	k := KanjidicEntry{Literal: strings.TrimSpace(c.Literal), Nanori: trimAll(c.RM.Nanori)}
	first := func(v []int) *int {
		if len(v) == 0 {
			return nil
		}
		x := v[0]
		return &x
	}
	k.Grade = first(c.Misc.Grade)
	k.Frequency = first(c.Misc.Freq)
	k.LegacyJLPT = first(c.Misc.JLPT)
	if len(c.Misc.Strokes) > 0 {
		k.StrokeCount = c.Misc.Strokes[0]
	}
	for _, g := range c.RM.Groups {
		for _, r := range g.Readings {
			switch r.Type {
			case "ja_on":
				k.On = append(k.On, strings.TrimSpace(r.Text))
			case "ja_kun":
				k.Kun = append(k.Kun, strings.TrimSpace(r.Text))
			}
		}
		for _, m := range g.Meanings {
			if m.Lang != "" && m.Lang != "en" {
				continue
			}
			if text := strings.TrimSpace(m.Text); text != "" {
				k.Meanings = append(k.Meanings, text)
			}
		}
	}
	return k
}
