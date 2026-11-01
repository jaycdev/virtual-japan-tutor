package httpapi

import (
	"context"
	"errors"
	"strconv"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dictionary"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// WithDictionary enables the /dictionary routes (issue #11: the story
// reader's Lookup row and Dictionary Entry window).
func WithDictionary(svc *dictionary.Service) Option { return func(s *server) { s.dictionary = svc } }

func (s *server) dictionaryService() (*dictionary.Service, error) {
	if s.dictionary == nil {
		return nil, errors.New("dictionary service is not configured")
	}
	return s.dictionary, nil
}

// GetDictionaryEntry looks a word up for the reader. The path param is a
// plain string (params bind before auth runs), so a malformed ent_seq reads
// exactly like an unknown one: 404 either way. An ent_seq the tokeniser
// linked but JMdict lacks still answers 200 with found=false — the window
// opens and shows the tapped form.
func (s *server) GetDictionaryEntry(ctx context.Context, request api.GetDictionaryEntryRequestObject) (api.GetDictionaryEntryResponseObject, error) {
	svc, err := s.dictionaryService()
	if err != nil {
		return nil, err
	}
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated // unreachable behind requireSession; fail closed
	}
	entSeq, err := strconv.ParseInt(request.EntSeq, 10, 64)
	if err != nil || entSeq <= 0 {
		return api.GetDictionaryEntry404JSONResponse{NotFoundJSONResponse: notFound("no such dictionary entry")}, nil
	}
	var surface, reading string
	if request.Params.Surface != nil {
		surface = *request.Params.Surface
	}
	if request.Params.Reading != nil {
		reading = *request.Params.Reading
	}
	entry, err := svc.Entry(ctx, id.ID, entSeq, surface, reading)
	if err != nil {
		return nil, err
	}
	return api.GetDictionaryEntry200JSONResponse(dictionaryEntryView(entry)), nil
}

// dictionaryEntryView maps the domain entry onto the API shape. The Lookup
// row and the window are pure views of this one response.
func dictionaryEntryView(e dictionary.Entry) api.DictionaryEntry {
	v := api.DictionaryEntry{
		EntSeq:     e.EntSeq,
		Found:      e.Found,
		Headword:   e.Headword,
		Reading:    e.Reading,
		JlptLevel:  dictJLPTLevel(e.JLPT),
		Senses:     make([]api.DictionarySense, 0, len(e.Senses)),
		KanjiForms: nonNilStrings(e.Kanji),
		Readings:   nonNilStrings(e.Readings),
		SrsLevel:   e.SRSLevel,
		Mastery:    e.Mastery,
		Kanji:      make([]api.DictionaryKanji, 0, len(e.Components)),
	}
	for _, sn := range e.Senses {
		v.Senses = append(v.Senses, api.DictionarySense{
			Glosses:       nonNilStrings(sn.Glosses),
			PartsOfSpeech: nonNilStrings(sn.POS),
		})
	}
	if e.Pitch != nil {
		view := api.PitchPattern{
			Reading:           e.Pitch.Reading,
			MoraCount:         e.Pitch.MoraCount,
			AccentPosition:    e.Pitch.AccentPosition,
			Heiban:            e.Pitch.Heiban,
			DownstepAfterMora: e.Pitch.DownstepAfterMora,
		}
		if e.Pitch.Tag != "" {
			tag := e.Pitch.Tag
			view.Tag = &tag
		}
		v.Pitch = &view
	}
	for _, c := range e.Components {
		v.Kanji = append(v.Kanji, api.DictionaryKanji{
			Literal:  c.Literal,
			Known:    c.Known,
			SrsLevel: c.SRSLevel,
			Mastery:  c.Mastery,
		})
	}
	return v
}

// dictJLPTLevel is the nullable sibling of jlptLevel: an unlisted word has
// no Level, and the window then shows no badge.
func dictJLPTLevel(level refdata.Level) *api.GrammarJLPTLevel {
	if level == "" {
		return nil
	}
	l := api.GrammarJLPTLevel(level)
	return &l
}

func nonNilStrings(ss []string) []string {
	if ss == nil {
		return []string{}
	}
	return ss
}
