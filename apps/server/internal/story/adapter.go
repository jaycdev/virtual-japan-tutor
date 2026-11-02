package story

import (
	"context"
	"fmt"
	"strconv"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// RefdataLookup implements VocabLookup over the reference-data store:
// FindVocabulary with the surface as written, then with the dictionary form.
// A miss both ways is ok=false — the token links to no jmdict entry and
// counts as unknown for coverage (issue #10: unlinked vocabulary items
// cannot match Known Items).
type RefdataLookup struct {
	ref *refdata.Store
}

var _ VocabLookup = (*RefdataLookup)(nil)

// NewRefdataLookup builds the lookup over the shared pool.
func NewRefdataLookup(pool *pgxpool.Pool) *RefdataLookup {
	return &RefdataLookup{ref: refdata.NewStore(pool)}
}

func (l *RefdataLookup) Lookup(ctx context.Context, surface, dictionary string) (VocabHit, bool, error) {
	for _, form := range []string{surface, dictionary} {
		if form == "" {
			continue
		}
		hits, err := l.ref.FindVocabulary(ctx, form, "")
		if err != nil {
			return VocabHit{}, false, err
		}
		if len(hits) > 0 {
			return hitOf(hits[0]), true, nil
		}
	}
	return VocabHit{}, false, nil
}

// hitOf picks the entry's headword (first kanji form, else first reading)
// and first gloss for display lists.
func hitOf(v refdata.Vocabulary) VocabHit {
	h := VocabHit{EntSeq: v.EntSeq}
	if len(v.Kanji) > 0 {
		h.JA = v.Kanji[0].Text
	} else if len(v.Readings) > 0 {
		h.JA = v.Readings[0].Text
	}
	for _, s := range v.Senses {
		if len(s.Glosses) > 0 {
			h.EN = s.Glosses[0]
			break
		}
	}
	return h
}

// MasteryFocus implements Focus over the Mastery/Focus Set service plus the
// reference data the prompt needs. The Focus Set decides what a story is
// built around; marumori_known_items decide Known-Item membership.
type MasteryFocus struct {
	pool *pgxpool.Pool
	ms   *mastery.Service
}

var _ Focus = (*MasteryFocus)(nil)

// NewMasteryFocus wires the Focus port to the mastery Service built over the
// same pool.
func NewMasteryFocus(pool *pgxpool.Pool, ms *mastery.Service) *MasteryFocus {
	return &MasteryFocus{pool: pool, ms: ms}
}

// FocusFor resolves mastery's rotating set into prompt-ready content:
// vocabulary through jmdict, grammar through the catalogue's pattern text.
func (f *MasteryFocus) FocusFor(ctx context.Context, userID uuid.UUID) (FocusSet, error) {
	set, err := f.ms.FocusSet(ctx, userID)
	if err != nil {
		return FocusSet{}, err
	}
	var vocabIDs []int64
	var gramIDs []int64
	levelOf := map[int64]int{}
	for _, it := range set.Items {
		switch it.Item.Key.Kind {
		case mastery.KindVocabulary:
			id, err := strconv.ParseInt(it.Item.Key.Ref, 10, 64)
			if err != nil {
				continue // MaruMori-id item with no jmdict link: not usable prose
			}
			vocabIDs = append(vocabIDs, id)
			if it.Item.SRSLevel != nil {
				levelOf[id] = *it.Item.SRSLevel
			}
		case mastery.KindGrammar:
			id, err := strconv.ParseInt(it.Item.Key.Ref, 10, 64)
			if err != nil {
				continue
			}
			gramIDs = append(gramIDs, id)
		}
	}
	out := FocusSet{}
	if len(vocabIDs) > 0 {
		vocab, err := vocabByID(ctx, f.pool, vocabIDs)
		if err != nil {
			return FocusSet{}, err
		}
		for _, v := range vocab {
			v.SRSLevel = levelOf[v.EntSeq]
			out.Vocab = append(out.Vocab, v)
		}
	}
	if len(gramIDs) > 0 {
		rows, err := f.pool.Query(ctx, `SELECT id, pattern FROM grammar_points WHERE id = ANY ($1) ORDER BY id`, gramIDs)
		if err != nil {
			return FocusSet{}, fmt.Errorf("story focus grammar: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var g GrammarFocus
			if err := rows.Scan(&g.PointID, &g.Pattern); err != nil {
				return FocusSet{}, fmt.Errorf("story focus grammar: %w", err)
			}
			out.Grammar = append(out.Grammar, g)
		}
		if err := rows.Err(); err != nil {
			return FocusSet{}, err
		}
	}
	return out, nil
}

// KnownVocab answers the gate's membership question for one candidate.
func (f *MasteryFocus) KnownVocab(ctx context.Context, userID uuid.UUID, entSeqs []int64) (map[int64]KnownView, error) {
	out := map[int64]KnownView{}
	if len(entSeqs) == 0 {
		return out, nil
	}
	rows, err := f.pool.Query(ctx, `
		SELECT jmdict_ent_seq, max(srs_level)
		FROM marumori_known_items
		WHERE user_id = $1 AND kind = 'vocabulary' AND jmdict_ent_seq = ANY ($2)
		GROUP BY jmdict_ent_seq`, userID, entSeqs)
	if err != nil {
		return nil, fmt.Errorf("story known vocab: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var seq int64
		var level int
		if err := rows.Scan(&seq, &level); err != nil {
			return nil, fmt.Errorf("story known vocab: %w", err)
		}
		out[seq] = KnownView{IsKnown: true, SRSLevel: level}
	}
	return out, rows.Err()
}

// KnownWords loads the prompt's Known Items list: common words first, then
// the most secure (highest SRS Level), so a truncated list still covers the
// words the learner is safest with. Truncation is safe — every listed word
// is genuinely Known, so the gate can only accept what it suggests.
func (f *MasteryFocus) KnownWords(ctx context.Context, userID uuid.UUID, limit int) ([]VocabFocus, error) {
	if limit <= 0 {
		limit = DefaultPromptKnownLimit
	}
	rows, err := f.pool.Query(ctx, `
		SELECT k.jmdict_ent_seq, max(k.srs_level) AS lvl
		FROM marumori_known_items k
		JOIN jmdict_entries e ON e.ent_seq = k.jmdict_ent_seq
		WHERE k.user_id = $1 AND k.kind = 'vocabulary'
		GROUP BY k.jmdict_ent_seq, e.is_common
		ORDER BY e.is_common DESC, lvl DESC, k.jmdict_ent_seq
		LIMIT $2`, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("story known words: %w", err)
	}
	var ids []int64
	levels := map[int64]int{}
	for rows.Next() {
		var id int64
		var lvl int
		if err := rows.Scan(&id, &lvl); err != nil {
			rows.Close()
			return nil, fmt.Errorf("story known words: %w", err)
		}
		ids = append(ids, id)
		levels[id] = lvl
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	vocab, err := vocabByID(ctx, f.pool, ids)
	if err != nil {
		return nil, err
	}
	for i := range vocab {
		vocab[i].SRSLevel = levels[vocab[i].EntSeq]
	}
	return vocab, nil
}

// vocabByID fetches headword and gloss for a set of ent_seqs: the first
// kanji form (else the first reading), and the first gloss of the first
// sense that has one.
func vocabByID(ctx context.Context, pool *pgxpool.Pool, ids []int64) ([]VocabFocus, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := pool.Query(ctx, `
		SELECT e.ent_seq,
		       COALESCE((SELECT k.text FROM jmdict_kanji_forms k WHERE k.ent_seq = e.ent_seq ORDER BY k.ord LIMIT 1), ''),
		       COALESCE((SELECT r.text FROM jmdict_readings r WHERE r.ent_seq = e.ent_seq ORDER BY r.ord LIMIT 1), ''),
		       COALESCE((SELECT s.glosses[1] FROM jmdict_senses s WHERE s.ent_seq = e.ent_seq AND cardinality(s.glosses) > 0 ORDER BY s.ord LIMIT 1), '')
		FROM jmdict_entries e
		WHERE e.ent_seq = ANY ($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("story vocab content: %w", err)
	}
	defer rows.Close()
	byID := map[int64]VocabFocus{}
	for rows.Next() {
		var v VocabFocus
		var form, reading, gloss string
		if err := rows.Scan(&v.EntSeq, &form, &reading, &gloss); err != nil {
			return nil, fmt.Errorf("story vocab content: %w", err)
		}
		v.JA, v.EN = form, gloss
		if v.JA == "" {
			v.JA = reading // readings-only entries: keep something readable
		}
		byID[v.EntSeq] = v
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]VocabFocus, 0, len(ids))
	for _, id := range ids {
		if v, ok := byID[id]; ok {
			out = append(out, v)
		}
	}
	return out, nil
}
