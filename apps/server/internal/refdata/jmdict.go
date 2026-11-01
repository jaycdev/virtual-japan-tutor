package refdata

import (
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

// JMdictHeader is what the document says about itself.
type JMdictHeader struct {
	// Created is the date from the "JMdict created: YYYY-MM-DD" comment.
	Created string
	// Tags maps the short codes used for parts of speech, misc, field,
	// dialect and info (e.g. "uk") to their descriptions from the DTD.
	Tags map[string]string
}

// JMdictEntry is one dictionary entry. EntSeq is JMdict's stable id.
type JMdictEntry struct {
	EntSeq   int64
	Kanji    []JMdictKanji
	Readings []JMdictReading
	Senses   []JMdictSense
	// Common is true when any form carries one of JMdict's common-use
	// priority tags (ichi1, news1, spec1, spec2, gai1).
	Common bool
}

type JMdictKanji struct {
	Text     string
	Info     []string
	Priority []string
}

type JMdictReading struct {
	Text string
	// NoKanji marks a reading that is not a reading of any kanji form.
	NoKanji bool
	// RestrictTo, when non-empty, lists the only kanji forms this reading applies to.
	RestrictTo []string
	Info       []string
	Priority   []string
}

type JMdictSense struct {
	POS     []string
	Field   []string
	Misc    []string
	Dialect []string
	Info    []string
	StagK   []string // applies only to these kanji forms
	StagR   []string // applies only to these readings
	Xref    []string
	Antonym []string
	Glosses []string
}

var (
	entityDecl   = regexp.MustCompile(`<!ENTITY\s+(\S+)\s+"([^"]*)"\s*>`)
	createdRe    = regexp.MustCompile(`JMdict created:\s*(\S+)`)
	commonPriTag = map[string]bool{"ichi1": true, "news1": true, "spec1": true, "spec2": true, "gai1": true}
)

// xml shapes, decoded one <entry> at a time so the whole file never sits in memory.
type xmlEntry struct {
	EntSeq int64      `xml:"ent_seq"`
	K      []xmlK     `xml:"k_ele"`
	R      []xmlR     `xml:"r_ele"`
	S      []xmlSense `xml:"sense"`
}

type xmlK struct {
	Keb string   `xml:"keb"`
	Inf []string `xml:"ke_inf"`
	Pri []string `xml:"ke_pri"`
}

type xmlR struct {
	Reb      string    `xml:"reb"`
	NoKanji  *struct{} `xml:"re_nokanji"`
	Restrict []string  `xml:"re_restr"`
	Inf      []string  `xml:"re_inf"`
	Pri      []string  `xml:"re_pri"`
}

type xmlSense struct {
	StagK []string   `xml:"stagk"`
	StagR []string   `xml:"stagr"`
	Pos   []string   `xml:"pos"`
	Xref  []string   `xml:"xref"`
	Ant   []string   `xml:"ant"`
	Field []string   `xml:"field"`
	Misc  []string   `xml:"misc"`
	Inf   []string   `xml:"s_inf"`
	Dial  []string   `xml:"dial"`
	Gloss []xmlGloss `xml:"gloss"`
}

type xmlGloss struct {
	Lang string `xml:"http://www.w3.org/XML/1998/namespace lang,attr"`
	Text string `xml:",chardata"`
}

// ParseJMdict streams a JMdict XML document (JMdict_e, ungzipped), calling fn
// for each entry in document order. Entity references such as &uk; are kept
// as their short code ("uk"). Only English glosses are kept. If fn returns an
// error, parsing stops and that error is returned unchanged.
func ParseJMdict(r io.Reader, fn func(JMdictEntry) error) (JMdictHeader, error) {
	hdr := JMdictHeader{Tags: map[string]string{}}
	dec := xml.NewDecoder(r)
	dec.Entity = map[string]string{}
	dec.Strict = true

	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			return hdr, nil
		}
		if err != nil {
			return hdr, fmt.Errorf("jmdict xml: %w", err)
		}
		switch t := tok.(type) {
		case xml.Directive:
			// <!DOCTYPE ... [ <!ENTITY n "noun (common)"> ... ]>
			for _, m := range entityDecl.FindAllStringSubmatch(string(t), -1) {
				hdr.Tags[m[1]] = m[2]
				dec.Entity[m[1]] = m[1]
			}
		case xml.Comment:
			if m := createdRe.FindStringSubmatch(string(t)); m != nil {
				hdr.Created = m[1]
			}
		case xml.StartElement:
			if t.Name.Local != "entry" {
				continue
			}
			var x xmlEntry
			if err := dec.DecodeElement(&x, &t); err != nil {
				return hdr, fmt.Errorf("jmdict entry: %w", err)
			}
			if err := fn(convertEntry(x)); err != nil {
				return hdr, err
			}
		}
	}
}

func convertEntry(x xmlEntry) JMdictEntry {
	e := JMdictEntry{EntSeq: x.EntSeq}
	common := func(tags []string) {
		for _, p := range tags {
			if commonPriTag[p] {
				e.Common = true
			}
		}
	}
	for _, k := range x.K {
		e.Kanji = append(e.Kanji, JMdictKanji{Text: k.Keb, Info: trimAll(k.Inf), Priority: trimAll(k.Pri)})
		common(k.Pri)
	}
	for _, r := range x.R {
		e.Readings = append(e.Readings, JMdictReading{
			Text: r.Reb, NoKanji: r.NoKanji != nil,
			RestrictTo: trimAll(r.Restrict), Info: trimAll(r.Inf), Priority: trimAll(r.Pri),
		})
		common(r.Pri)
	}
	var lastPOS []string
	for _, s := range x.S {
		sense := JMdictSense{
			POS: trimAll(s.Pos), Field: trimAll(s.Field), Misc: trimAll(s.Misc), Dialect: trimAll(s.Dial),
			Info: trimAll(s.Inf), StagK: trimAll(s.StagK), StagR: trimAll(s.StagR),
			Xref: trimAll(s.Xref), Antonym: trimAll(s.Ant),
		}
		// A sense without <pos> shares the previous sense's parts of speech.
		if len(sense.POS) == 0 {
			sense.POS = lastPOS
		} else {
			lastPOS = sense.POS
		}
		for _, g := range s.Gloss {
			if g.Lang != "" && g.Lang != "eng" {
				continue
			}
			if text := strings.TrimSpace(g.Text); text != "" {
				sense.Glosses = append(sense.Glosses, text)
			}
		}
		e.Senses = append(e.Senses, sense)
	}
	return e
}

func trimAll(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}
