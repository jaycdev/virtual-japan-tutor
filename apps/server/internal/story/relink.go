package story

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/ikawaha/kagome/v2/tokenizer"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Stories generated before issue #94 kept NULL links on their non-content
// tokens, and story_tokens stores no part of speech, so the relink run
// re-tokenises each stored sentence to recover what generation saw. It only
// ever fills in missing links: a token that already carries an ent_seq is
// never changed, and neither are the stored gate counts or the flags on the
// Story's existing Vocabulary Items. A run that links nothing writes nothing,
// so re-running it is safe.

// StoryRef names one stored Story and its owner, the two things a relink run
// needs to visit it.
type StoryRef struct{ ID, UserID uuid.UUID }

// TokenLink is one stored token's new dictionary link and Known Item tag.
type TokenLink struct {
	SentenceID uuid.UUID
	Pos        int
	EntSeq     int64
	Dictionary string
	// Reading is the furigana for the linked entry (issue #134).
	Reading  string
	Tag      string
	SRSLevel *int
}

// RelinkReport counts what a relink run did across every Story it visited.
type RelinkReport struct {
	Stories, StoriesChanged, TokensLinked, SentencesSkipped, Failed int
}

// relinkStore is what a relink run reads and writes. *PostgresStore satisfies
// it; the tests substitute an in-memory fake.
type relinkStore interface {
	StoryRefs(ctx context.Context) ([]StoryRef, error)
	Get(ctx context.Context, id, userID uuid.UUID) (*Story, error)
	SaveLinks(ctx context.Context, storyID uuid.UUID, links []TokenLink, vocab []VocabItem) error
}

// Relinker repairs the dictionary links of stored Stories.
type Relinker struct {
	store relinkStore
	// linker is shared by the whole run, so a word that recurs across Stories
	// costs one lookup.
	linker *tokenLinker
	known  KnownSource
	log    *slog.Logger
}

// NewRelinker builds the production relinker over the shared pool. The known
// source needs only the pool (KnownVocab reads marumori_known_items), so the
// Focus Set service is left out.
func NewRelinker(pool *pgxpool.Pool) *Relinker {
	return newRelinker(NewPostgresStore(pool), NewRefdataLookup(pool), NewMasteryFocus(pool, nil))
}

func newRelinker(store relinkStore, lookup VocabLookup, known KnownSource) *Relinker {
	return &Relinker{store: store, linker: newTokenLinker(lookup), known: known, log: slog.Default()}
}

// Run relinks every stored Story. A Story that fails is logged, counted in
// Failed and skipped, so one bad row never stops the rest. Run returns an
// error when the context was cancelled, or when any Story failed, so the
// command exits non-zero and the failures are not silent.
func (r *Relinker) Run(ctx context.Context) (RelinkReport, error) {
	var rep RelinkReport
	refs, err := r.store.StoryRefs(ctx)
	if err != nil {
		return rep, fmt.Errorf("relink stories: listing: %w", err)
	}
	for _, ref := range refs {
		if err := ctx.Err(); err != nil {
			return rep, err
		}
		rep.Stories++
		res, err := r.relinkStory(ctx, ref)
		if err != nil {
			// A cancelled run stops here: the Story did not fail, the run was
			// interrupted, so neither count nor log it as a failure.
			if ctxErr := ctx.Err(); ctxErr != nil {
				return rep, ctxErr
			}
			rep.Failed++
			r.log.Error("relink story failed", "story", ref.ID, "err", err)
			continue
		}
		rep.SentencesSkipped += res.skipped
		if res.linked > 0 {
			rep.StoriesChanged++
			rep.TokensLinked += res.linked
		}
	}
	if err := ctx.Err(); err != nil {
		return rep, err
	}
	if rep.Failed > 0 {
		return rep, fmt.Errorf("relink stories: %d of %d stories failed", rep.Failed, rep.Stories)
	}
	return rep, nil
}

// relinkResult is what one Story's relink did; it is only meaningful when the
// Story saved without error.
type relinkResult struct {
	linked  int
	skipped int
}

// pendingLink is a token that gained a link in this run, with the sentence
// it belongs to, so the Known Item check can run once for the whole Story.
type pendingLink struct {
	sentence uuid.UUID
	tok      Token
}

// relinkStory links the unlinked, linkable tokens of one stored Story, tags
// the new links against the Story's owner's Known Items, and writes the
// result in one save. A Story with nothing newly linked is not written.
func (r *Relinker) relinkStory(ctx context.Context, ref StoryRef) (relinkResult, error) {
	var res relinkResult
	s, err := r.store.Get(ctx, ref.ID, ref.UserID)
	if err != nil {
		return res, err
	}

	var linked []pendingLink
	for si := range s.Sentences {
		sen := &s.Sentences[si]
		toks, err := tokenise(sen.JA)
		if err != nil {
			return res, err
		}
		// A sentence whose stored tokens no longer match kagome's split is
		// left alone entirely: linking by position would attach a link to the
		// wrong word.
		if !tokensMatch(sen.Tokens, toks) {
			res.skipped++
			r.log.Warn("relink: sentence skipped, stored tokens do not match re-tokenisation",
				"story", ref.ID, "sentence", sen.Pos)
			continue
		}
		for i := range sen.Tokens {
			tok := &sen.Tokens[i]
			if tok.EntSeq != nil || !isLinkable(toks[i]) {
				continue
			}
			base, _ := toks[i].BaseForm()
			// The furigana is reconciled from kagome's reading, as generation
			// did it, so the stored reading is not the input.
			tok.kagome = kagomeReading(toks[i])
			tok.Reading = tok.kagome
			ok, err := r.linker.link(ctx, tok, base)
			if err != nil {
				return res, err
			}
			if ok {
				linked = append(linked, pendingLink{sentence: sen.ID, tok: *tok})
			}
		}
	}
	if len(linked) == 0 {
		return res, nil
	}

	// Ask about every newly linked entry and its alternatives in one query,
	// as generation does, so a token of a spelling the Learner knows through
	// another entry is tagged known.
	var seqs []int64
	seen := map[int64]bool{}
	add := func(seq int64) {
		if !seen[seq] {
			seen[seq] = true
			seqs = append(seqs, seq)
		}
	}
	for _, p := range linked {
		add(*p.tok.EntSeq)
		for _, a := range p.tok.alts {
			add(a.EntSeq)
		}
	}
	known, err := r.known.KnownVocab(ctx, s.UserID, seqs)
	if err != nil {
		return res, fmt.Errorf("relink known-item lookup: %w", err)
	}
	// The Focus Set the Story was built around is recorded on its existing
	// Vocabulary Items, so a new link to the same word prefers that entry.
	focusWant := map[int64]bool{}
	for _, v := range s.VocabItems {
		if v.IsFocus {
			focusWant[v.EntSeq] = true
		}
	}

	// The existing Vocabulary Items come first, unchanged; new ones follow in
	// sentence and token order, one per ent_seq.
	vocab := append([]VocabItem(nil), s.VocabItems...)
	inVocab := map[int64]bool{}
	for _, v := range vocab {
		inVocab[v.EntSeq] = true
	}
	links := make([]TokenLink, 0, len(linked))
	for _, p := range linked {
		tok := p.tok
		entSeq, dict := *tok.EntSeq, tok.Dictionary
		tag, level := TagUnknown, (*int)(nil)
		if chosen := knownEntryFor(&tok, known, focusWant); chosen != nil {
			entSeq, dict = chosen.EntSeq, chosen.JA
			tok.Reading = reconcileReading(tok.kagome, chosen.Readings)
			lvl := known[chosen.EntSeq].SRSLevel
			tag, level = TagKnown, &lvl
		}
		links = append(links, TokenLink{
			SentenceID: p.sentence, Pos: tok.Pos, EntSeq: entSeq, Dictionary: dict,
			Reading: tok.Reading, Tag: tag, SRSLevel: level,
		})
		if !inVocab[entSeq] {
			inVocab[entSeq] = true
			vocab = append(vocab, VocabItem{EntSeq: entSeq, JA: dict, IsKnown: known[entSeq].IsKnown})
		}
	}
	if err := r.store.SaveLinks(ctx, ref.ID, links, vocab); err != nil {
		return res, err
	}
	res.linked = len(links)
	return res, nil
}

// tokensMatch reports whether the stored tokens are exactly kagome's split of
// the sentence: the same count, and each position with the same surface and
// offsets. Only then may a stored token be linked from kagome's answer.
func tokensMatch(stored []Token, toks []tokenizer.Token) bool {
	if len(stored) != len(toks) {
		return false
	}
	for i, t := range stored {
		if t.Pos != i || t.Surface != toks[i].Surface || t.Start != toks[i].Start || t.End != toks[i].End {
			return false
		}
	}
	return true
}
