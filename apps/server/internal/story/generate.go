package story

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/ikawaha/kagome-dict/ipa"
	"github.com/ikawaha/kagome/v2/tokenizer"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

// The morphological tokeniser is kagome (github.com/ikawaha/kagome): pure Go,
// already the repo's tokeniser (internal/grammar), so coverage, token tags,
// and span checks behave identically everywhere. Dictionary loading is lazy
// and once per process; kagome tokenisers are not goroutine-safe, hence the
// mutex.
var analyser = struct {
	once sync.Once
	tok  *tokenizer.Tokenizer
	err  error
	mu   sync.Mutex
}{}

func tokenise(s string) ([]tokenizer.Token, error) {
	analyser.once.Do(func() {
		analyser.tok, analyser.err = tokenizer.New(ipa.Dict(), tokenizer.OmitBosEos())
	})
	if analyser.err != nil {
		return nil, fmt.Errorf("story tokeniser: %w", analyser.err)
	}
	analyser.mu.Lock()
	defer analyser.mu.Unlock()
	return analyser.tok.Tokenize(s), nil
}

// posCategory returns the outermost POS element of a token, "" when absent.
func posCategory(t tokenizer.Token) string {
	pos := t.POS()
	if len(pos) == 0 {
		return ""
	}
	return pos[0]
}

// posSubCategory returns the second POS element, "" when absent.
func posSubCategory(t tokenizer.Token) string {
	pos := t.POS()
	if len(pos) < 2 {
		return ""
	}
	return pos[1]
}

// isContent reports whether a token is a content word for coverage purposes
// only: whether a token may be looked up is isLinkable's question, which is
// wider. It is nouns, verbs, adjectives and adverbs, minus
//   - bare numerals (名詞,数 — JMdict is not a number list), and
//   - grammatical suffixes and dependent words (接尾, 非自立): れる, さん, たち,
//     こと, の, はず, ている's いる. They are grammar, not vocabulary, so a
//     Learner never "knows" them as words and a model cannot replace them; live,
//     れる alone held coverage at 94% against the 95% bar.
//
// internal/grammar has its own, different rule (it checks that words exist in
// JMdict, and takes no adverbs), so the two need not agree.
func isContent(t tokenizer.Token) bool {
	switch posCategory(t) {
	case "名詞", "動詞", "形容詞", "副詞":
		switch posSubCategory(t) {
		case "数", "接尾", "非自立":
			return false
		}
		return true
	default:
		return false
	}
}

// isLinkable reports whether a token gets a dictionary link (ent_seq), which
// is what makes it hoverable: the reader opens a Lookup in the Reading Panel
// only for a linked token. Every token is linkable except particles (助詞),
// auxiliaries (助動詞), symbols (記号) and tokens with no part of speech. A
// Lookup on those shows nothing useful. A particle is hoverable without a link:
// the store attaches a Grammar Catalogue hint to it on load (see GrammarHint,
// issue #98), which keeps the dictionary out of particles. isContent implies
// isLinkable, so the coverage gate never counts a token that cannot be linked.
func isLinkable(t tokenizer.Token) bool {
	switch posCategory(t) {
	case "", "助詞", "助動詞", "記号":
		return false
	}
	return true
}

// tokenLinker links tokens to jmdict entries through a VocabLookup and caches
// each answer for its own lifetime, so a repeated word costs one query, hit
// or miss. The key is the surface and the dictionary form together, because
// the lookup answers for that pair. Keying on the surface alone would be
// unsafe once one linker serves a whole relink run, where the same spelling
// can come with different forms.
type tokenLinker struct {
	lookup VocabLookup
	looked map[string]VocabHit
	missed map[string]bool
}

func newTokenLinker(l VocabLookup) *tokenLinker {
	return &tokenLinker{lookup: l, looked: map[string]VocabHit{}, missed: map[string]bool{}}
}

// link sets the token's dictionary link when the lookup finds one and reports
// whether it did. A miss leaves the token as it was: unlinked, so it counts as
// an unknown Vocabulary Item, and the caller decides what that means.
func (l *tokenLinker) link(ctx context.Context, tok *Token, base string) (bool, error) {
	key := tok.Surface + "\x00" + base
	hit, ok := l.looked[key]
	if !ok && !l.missed[key] {
		var err error
		hit, ok, err = l.lookup.Lookup(ctx, tok.Surface, base)
		if err != nil {
			return false, err
		}
		if ok {
			l.looked[key] = hit
		} else {
			l.missed[key] = true
		}
	}
	if !ok {
		return false, nil
	}
	seq := hit.EntSeq
	tok.EntSeq = &seq
	tok.Dictionary = hit.JA
	tok.alts = hit.Alts
	return true, nil
}

// ChatClient is the structured-output call generation needs; *llm.Client
// satisfies it exactly, and tests substitute a fake (no live AI in tests).
type ChatClient interface {
	ChatJSON(ctx context.Context, msgs []llm.Message, schema llm.Schema, opts llm.Options) (llm.JSONResult, error)
}

// Generator turns a Focus Set into a validated Story. Nothing the model
// returns is trusted: the shape check runs first, then the deterministic
// gate (Known-word coverage, Focus Set inclusion, Grammar Span alignment),
// and failures drive retries — up to Settings.MaxAttempts total attempts —
// with the gate's complaints fed back.
type Generator struct {
	lookup VocabLookup
}

func NewGenerator(lookup VocabLookup) *Generator { return &Generator{lookup: lookup} }

// Request is one generation: the user, gate settings, their Focus Set and
// Known Items, and the genre/theme chosen for them ("" asks the model to
// surprise us).
type Request struct {
	UserID   uuid.UUID
	Settings Settings
	Focus    FocusSet
	// Known answers membership questions for the gate (usually the Focus
	// port itself); KnownWords is the prompt's Known Items list.
	Known      KnownSource
	KnownWords []VocabFocus
	Genre      string
	// Theme is the Learner's free-text preference (prompt-only, like Genre).
	Theme string
	// Origin says how this generation came about — background Automatic or
	// an On-demand request — and is stamped onto the stored Story. A Story
	// the generator produced is always Automatic (issue #31).
	Origin StoryOrigin
	// DislikedGenres are the genres the Learner rated net down: the prompt
	// names them as "avoid", and PickGenre already dropped them from its
	// fallback.
	DislikedGenres []string
	// AvoidRecentGenres names the genres of the Learner's most recent
	// Stories as "avoid too" in the prompt. Issue #33's Surprise mode sets
	// it — with the preferences off, the recent genres are the only variety
	// signal left. Automatic sets it too whenever no genre was picked.
	AvoidRecentGenres []string
	// ReportStage, when set, receives the generation's stage transitions —
	// writing before each model call, checking once the answer is in hand
	// and the gate is judging it — for the On-demand progress bar
	// (issue #33). It is called on the generating goroutine and must not
	// block meaningfully.
	ReportStage func(stage GenerationStage, attempt int)
}

// Generate produces one Story for the request. It returns the final candidate
// even when every attempt failed the gate — Validated false, that attempt's
// coverage stored — together with an error describing the last rejection;
// the caller decides what to keep (the background path stores it but does
// not make it ready). A provider failure before any candidate returns no
// Story.
func (g *Generator) Generate(ctx context.Context, client ChatClient, req Request) (*Story, error) {
	if client == nil {
		return nil, errors.New("story: no provider resolved for the story task")
	}
	if req.Known == nil {
		return nil, errors.New("story: no known-item source for the gate")
	}
	settings := req.Settings.WithDefaults()

	msgs := []llm.Message{
		{Role: llm.RoleSystem, Content: systemPrompt},
		{Role: llm.RoleUser, Content: userPrompt(req, settings)},
	}
	// The base brief, kept verbatim so the stored Story can show what was
	// asked of the model (retry feedback is conversation history, not the
	// brief).
	brief := msgs[1].Content
	var last *Story
	// styleOnly is the newest candidate that passed every hard check but
	// failed the soft style check. A later failure must not discard it.
	var styleOnly *Story
	var lastErr error
	// attemptsUsed counts every attempt that reached the model, parse and
	// materialise failures included, so the stored candidate's Attempts says
	// what it cost even when the final attempt never produced a candidate.
	attemptsUsed := 0
	var history []string
	report := func(stage GenerationStage, attempt int) {
		if req.ReportStage != nil {
			req.ReportStage(stage, attempt)
		}
	}
	for attempt := 1; attempt <= settings.MaxAttempts; attempt++ {
		report(StageWriting, attempt)
		res, err := client.ChatJSON(ctx, msgs, Schema(), llm.Options{MaxTokens: 4000 + llm.ReasoningHeadroom, Timeout: DefaultGenerationTimeout})
		if err != nil {
			// Provider-level failure: gate feedback cannot fix it. Report
			// the last candidate if a previous attempt got that far.
			if styleOnly != nil {
				return acceptStyleOnly(styleOnly, attemptsUsed), nil
			}
			if last != nil {
				return last, lastErr
			}
			return nil, fmt.Errorf("story generation: %w", err)
		}
		report(StageChecking, attempt)
		attemptsUsed++
		var raw storyJSON
		if err := json.Unmarshal(res.JSON, &raw); err != nil {
			lastErr = fmt.Errorf("story generation: parsing model output: %w", err)
			msgs = append(msgs,
				llm.Message{Role: llm.RoleAssistant, Content: string(res.JSON)},
				llm.Message{Role: llm.RoleUser, Content: "That was not valid JSON for the schema. Return the complete corrected JSON only."},
			)
			continue
		}
		story, err := g.materialise(ctx, &raw, req)
		if err != nil {
			lastErr = err
			msgs = append(msgs,
				llm.Message{Role: llm.RoleAssistant, Content: string(res.JSON)},
				llm.Message{Role: llm.RoleUser, Content: "The passage could not be processed: " + err.Error() + " Rewrite it staying closer to the known words, and return the complete corrected JSON."},
			)
			continue
		}
		story.Prompt = brief
		story.Attempts = attempt

		// Tag tokens against the user's Known Items: unlinked vocabulary
		// items cannot match and simply count as unknown (issue #10).
		if err := g.tagKnown(ctx, story, req); err != nil {
			return nil, err
		}
		problems := g.gate(story, settings, req.Focus)
		style := styleProblems(story)
		if len(problems) == 0 && len(style) == 0 {
			story.Validated = true
			return story, nil
		}
		if len(problems) == 0 {
			// Style is soft: a choppy passage that clears every hard check is
			// still a Story once the attempts run out.
			if attempt == settings.MaxAttempts {
				return acceptStyleOnly(story, attemptsUsed), nil
			}
			styleOnly = story
		}
		problems = append(problems, style...)
		story.Validated = false
		last = story
		// Keep every attempt's complaints, not just the last: a final
		// attempt that failed for a new reason hides why the earlier ones did.
		history = append(history, fmt.Sprintf("attempt %d: %s", attempt, strings.Join(problems, "; ")))
		lastErr = fmt.Errorf("story rejected by the validation gate: %s", strings.Join(history, " | "))
		if attempt < settings.MaxAttempts {
			msgs = append(msgs,
				llm.Message{Role: llm.RoleAssistant, Content: string(res.JSON)},
				llm.Message{Role: llm.RoleUser, Content: retryPrompt(problems, raw)},
			)
		}
	}
	if styleOnly != nil {
		return acceptStyleOnly(styleOnly, attemptsUsed), nil
	}
	if last != nil {
		last.Attempts = attemptsUsed
	}
	return last, lastErr
}

// acceptStyleOnly validates a candidate that cleared the hard gate and failed
// only the soft style check.
func acceptStyleOnly(s *Story, attempts int) *Story {
	s.Validated = true
	s.Attempts = attempts
	return s
}

// materialise converts the model's JSON into a Story: tokenising every
// sentence with kagome and linking every linkable token (see isLinkable) to
// jmdict entries through the lookup. Known/unknown tagging happens afterwards
// in tagKnown, once the linked entries are known. Spans arriving here are
// copied verbatim; the
// gate judges them. The request's Title/Theme/Origin stamping happens here
// too, so every candidate — validated or not — carries its library fields.
func (g *Generator) materialise(ctx context.Context, raw *storyJSON, req Request) (*Story, error) {
	s := &Story{UserID: req.UserID, Genre: req.Genre, Origin: req.Origin}
	if s.Origin == "" {
		s.Origin = OriginAutomatic
	}
	if s.Genre == "" {
		// The model names its own genre: a free-text label it can fill with
		// anything, so it goes through the same sanitizer the user's stored
		// preferences do before it is stored or shown.
		s.Genre = sanitizeLabel(raw.Genre, maxLabelRunes)
	}
	if s.Genre == "" {
		s.Genre = "free"
	}
	var texts []string
	// One linker for the whole candidate: a word repeated across sentences
	// costs one lookup, hit or miss.
	linker := newTokenLinker(g.lookup)
	for i, in := range raw.Sentences {
		sen := Sentence{Pos: i, JA: stripNulls(in.JA), EN: stripNulls(in.EN)}
		toks, err := tokenise(sen.JA)
		if err != nil {
			return nil, err
		}
		for j, kt := range toks {
			base, _ := kt.BaseForm()
			reading, _ := kt.Reading()
			tok := Token{Pos: j, Surface: kt.Surface, Start: kt.Start, End: kt.End, Reading: toHiragana(reading), Dictionary: base, Tag: TagUnknown}
			// The coverage gate counts only content words, but the reader can
			// look up every word that isLinkable, so the two rules are kept
			// apart: content is set for every token, the link for linkable ones.
			tok.content = isContent(kt)
			tok.conjunction = posCategory(kt) == "接続詞"
			if isLinkable(kt) {
				if _, err := linker.link(ctx, &tok, base); err != nil {
					return nil, err
				}
			}
			sen.Tokens = append(sen.Tokens, tok)
		}
		for _, sp := range in.GrammarSpans {
			span := Span{
				Start:          sp.Start,
				End:            sp.End,
				GrammarPointID: sp.GrammarPointID,
				IsFocus:        req.Focus.hasGrammar(sp.GrammarPointID),
			}
			if text := strings.TrimSpace(sp.Text); text != "" {
				start, end, ok := locateSpan(sen.JA, text)
				if !ok {
					// The model claims a pattern the sentence does not
					// contain. A span we cannot place is never stored or
					// shown, and never counts towards the Focus Set; whether
					// enough grammar genuinely appears is the focus
					// fraction's call, with feedback the model can act on.
					// Rejecting the whole passage over it failed every attempt.
					continue
				}
				span.Start, span.End = start, end
			}
			sen.Spans = append(sen.Spans, span)
		}
		s.Sentences = append(s.Sentences, sen)
		texts = append(texts, sen.JA)
	}
	for i, q := range raw.Questions {
		opts := make([]string, len(q.OptionsJA))
		for j, o := range q.OptionsJA {
			opts[j] = stripNulls(o)
		}
		s.Questions = append(s.Questions, Question{Pos: i, PromptJA: stripNulls(q.PromptJA), OptionsJA: opts, AnswerIndex: q.AnswerIdx})
	}
	s.Text = strings.Join(texts, "")

	// Library fields (issue #31): the title the model wrote — a shortened
	// first sentence when it wrote none — its translation, and the theme
	// the story was actually written on (the request's stored preference
	// beats the model's self-named theme).
	s.Title = sanitizeLabel(raw.Title, maxLabelRunes)
	if s.Title == "" {
		s.Title = fallbackTitle(s.Text)
	}
	s.TitleEN = sanitizeLabel(raw.TitleEN, maxLabelRunes)
	s.Theme = sanitizeLabel(req.Theme, maxPreferredThemeLen)
	if s.Theme == "" {
		s.Theme = sanitizeLabel(raw.Theme, maxPreferredThemeLen)
	}

	s.rebuildVocabItems()
	return s, nil
}

// rebuildVocabItems lists the vocabulary the Story covers: every linked
// token, deduplicated by ent_seq keeping the first hit. It runs again after
// tagKnown has re-linked ambiguous tokens to the entry the Learner knows.
func (s *Story) rebuildVocabItems() {
	s.VocabItems = nil
	seen := map[int64]bool{}
	for _, sen := range s.Sentences {
		for _, t := range sen.Tokens {
			if t.EntSeq == nil || seen[*t.EntSeq] {
				continue
			}
			seen[*t.EntSeq] = true
			s.VocabItems = append(s.VocabItems, VocabItem{EntSeq: *t.EntSeq, JA: t.Dictionary})
		}
	}
}

// tagKnown asks the KnownSource about every ent_seq the candidate linked to,
// then tags tokens (known + SRS Level) and flags vocab items IsKnown/IsFocus.
func (g *Generator) tagKnown(ctx context.Context, s *Story, req Request) error {
	// Ask about every entry that shares a token's spelling, not just the
	// first: the token cannot say which of them was meant.
	var seqs []int64
	seen := map[int64]bool{}
	add := func(seq int64) {
		if !seen[seq] {
			seen[seq] = true
			seqs = append(seqs, seq)
		}
	}
	for _, sen := range s.Sentences {
		for _, t := range sen.Tokens {
			if t.EntSeq == nil {
				continue
			}
			add(*t.EntSeq)
			for _, a := range t.alts {
				add(a.EntSeq)
			}
		}
	}
	known, err := req.Known.KnownVocab(ctx, req.UserID, seqs)
	if err != nil {
		return fmt.Errorf("story known-item lookup: %w", err)
	}
	focusWant := make(map[int64]bool, len(req.Focus.Vocab))
	for _, v := range req.Focus.Vocab {
		focusWant[v.EntSeq] = true
	}
	gloss := make(map[int64]string, len(req.Focus.Vocab))
	for _, v := range req.Focus.Vocab {
		gloss[v.EntSeq] = v.EN
	}
	for i := range s.Sentences {
		for j := range s.Sentences[i].Tokens {
			t := &s.Sentences[i].Tokens[j]
			if t.EntSeq == nil {
				continue
			}
			// The token counts as known when the Learner knows any entry
			// of its spelling, and links to that entry: a focus word among
			// them first (so a Story covers the item it was built around),
			// then the first entry, then the other alternatives in order.
			chosen := knownEntryFor(t, known, focusWant)
			if chosen == nil {
				continue
			}
			if *t.EntSeq != chosen.EntSeq {
				seq := chosen.EntSeq
				t.EntSeq = &seq
				t.Dictionary = chosen.JA
			}
			v := known[chosen.EntSeq]
			t.Tag = TagKnown
			level := v.SRSLevel
			t.SRSLevel = &level
		}
	}
	s.rebuildVocabItems()
	for i := range s.VocabItems {
		v := &s.VocabItems[i]
		if kv, ok := known[v.EntSeq]; ok {
			v.IsKnown = kv.IsKnown
		}
		v.IsFocus = focusWant[v.EntSeq]
		if v.EN == "" {
			v.EN = gloss[v.EntSeq]
		}
	}
	return nil
}

// knownEntryFor picks the entry a token is linked to from among the entries
// sharing its spelling that the Learner knows: a Focus Set word if one of them
// is, else the token's own first entry, else the first known alternative. It
// returns nil when the Learner knows none of them.
func knownEntryFor(t *Token, known map[int64]KnownView, focusWant map[int64]bool) *VocabHit {
	cands := make([]VocabHit, 0, len(t.alts)+1)
	cands = append(cands, VocabHit{EntSeq: *t.EntSeq, JA: t.Dictionary})
	for _, a := range t.alts {
		if a.EntSeq != *t.EntSeq {
			cands = append(cands, a)
		}
	}
	var first *VocabHit
	for i := range cands {
		if v, ok := known[cands[i].EntSeq]; !ok || !v.IsKnown {
			continue
		}
		if focusWant[cands[i].EntSeq] {
			return &cands[i]
		}
		if first == nil {
			first = &cands[i]
		}
	}
	return first
}

// gate runs the deterministic checks over an already-tokenised, already-
// tagged candidate: Known-word coverage over content tokens, Focus Set
// inclusion over BOTH the vocabulary and grammar halves, and Grammar Spans
// citing suggested points on token boundaries and covering only the
// pattern's own characters. It fills the Story's count fields either way, so
// a rejected Story still records what the gate saw.
func (g *Generator) gate(s *Story, settings Settings, focus FocusSet) []string {
	if err := s.Validate(); err != nil {
		return []string{err.Error() + shortfallHint(s)}
	}
	var problems []string

	focusWant := make(map[int64]bool, len(focus.Vocab))
	for _, v := range focus.Vocab {
		focusWant[v.EntSeq] = true
	}
	focusGrammar := make(map[int64]bool, len(focus.Grammar))
	for _, gm := range focus.Grammar {
		focusGrammar[gm.PointID] = true
	}
	content, knownCount := 0, 0
	var unknown []string
	unknownSeen := map[string]bool{}
	focusHit := map[int64]bool{}
	grammarHit := map[int64]bool{}
	var discarded []string
	for senIdx := range s.Sentences {
		sen := &s.Sentences[senIdx]
		for _, t := range sen.Tokens {
			if !t.content {
				continue
			}
			content++
			if t.Tag != TagKnown {
				// Unlinked vocabulary items count as unknown. Remember the
				// word so the retry can name it: "use only known words" alone
				// gave the model nothing to change.
				w := t.Dictionary
				if w == "" {
					w = t.Surface
				}
				if !unknownSeen[w] {
					unknownSeen[w] = true
					unknown = append(unknown, w)
				}
				continue
			}
			knownCount++
			if t.EntSeq != nil && focusWant[*t.EntSeq] {
				focusHit[*t.EntSeq] = true
			}
		}
		// A mis-cut span (across word boundaries, or swallowing a verb or
		// adjective stem) is discarded, not a reason to throw the passage away:
		// it is never stored or shown, so no wrong highlight reaches the
		// Learner, and it does not count towards the Focus Set, so the focus
		// fraction below still decides whether enough grammar really appears.
		// Live, mis-cut spans failed otherwise good passages on every attempt.
		kept := sen.Spans[:0]
		for _, sp := range sen.Spans {
			// Validate (run first) guarantees the span lies inside the sentence.
			txt := runeSlice(sen.JA, sp.Start, sp.End)
			if !focusGrammar[sp.GrammarPointID] {
				// Discarded like a mis-cut span: a Story's spans are all
				// Focus Set spans. Live, one run failed all five attempts on
				// nothing but these.
				discarded = append(discarded, fmt.Sprintf(
					"grammar span [%d,%d) %q in sentence %d (%q) cites point %d, which was not in the suggested list, and was discarded",
					sp.Start, sp.End, txt, sen.Pos, sen.JA, sp.GrammarPointID))
				continue
			}
			miscut := false
			if !onTokenBoundary(sen.Tokens, sp.Start, sp.End) {
				miscut = true
				discarded = append(discarded, fmt.Sprintf(
					"grammar span [%d,%d) %q in sentence %d (%q) cuts across word boundaries and was discarded; spans must cover whole words",
					sp.Start, sp.End, txt, sen.Pos, sen.JA))
			}
			if surf, atStem := spanStartsAtContentWord(sen.Tokens, sp.Start); atStem &&
				!spanStartsLikePattern(txt, focus.grammarPattern(sp.GrammarPointID)) {
				miscut = true
				discarded = append(discarded, fmt.Sprintf(
					"grammar span [%d,%d) %q in sentence %d (%q) opens at the content word %s, which is not part of the pattern, and was discarded; a span must cover the pattern's own characters only, never the verb or adjective stem before it (for 食べてしまった with pattern てしまった the span covers てしまった)",
					sp.Start, sp.End, txt, sen.Pos, sen.JA, surf))
			}
			// Every span must realise the point it cites, wherever it opens:
			// the stem rule above only covers spans opening at a content
			// word, so a span over a particle was kept whatever it cited.
			if pattern := focus.grammarPattern(sp.GrammarPointID); !miscut && !spanExpressesPattern(txt, pattern) {
				miscut = true
				discarded = append(discarded, fmt.Sprintf(
					"grammar span [%d,%d) %q in sentence %d (%q) does not express point %d (%q), which it cites, and was discarded; a span must cover the characters of the pattern it cites",
					sp.Start, sp.End, txt, sen.Pos, sen.JA, sp.GrammarPointID, pattern))
			}
			if miscut {
				continue
			}
			grammarHit[sp.GrammarPointID] = true
			kept = append(kept, sp)
		}
		sen.Spans = kept
	}
	// The focus fraction counts both halves of the Focus Set: a point counts
	// as hit when at least one span in the Story realises it.
	focusTotal := len(focusWant) + len(focusGrammar)
	focusHits := len(focusHit) + len(grammarHit)
	s.ContentWords, s.KnownWords, s.FocusItems, s.FocusHit = content, knownCount, focusTotal, focusHits

	if content > 0 {
		cov := float64(knownCount) / float64(content)
		if cov < settings.MinCoverage {
			problems = append(problems, fmt.Sprintf(
				"known-word coverage is %.0f%% (%d of %d content words are words the learner knows); at least %.0f%% are required — rewrite using only the known words you were given. Replace these words, which the learner does not know: %s",
				cov*100, knownCount, content, settings.MinCoverage*100, listWords(unknown, 25)))
		}
	}
	if focusTotal > 0 {
		frac := float64(focusHits) / float64(focusTotal)
		if frac < settings.MinFocusFraction {
			problems = append(problems, fmt.Sprintf(
				"only %d of the %d focus items appear (%d of %d focus words, %d of %d focus grammar points; %.0f%%); at least %.0f%% must appear — build the passage around the focus items, they are the point of the exercise",
				focusHits, focusTotal, len(focusHit), len(focusWant), len(grammarHit), len(focusGrammar), frac*100, settings.MinFocusFraction*100))
		}
	}
	// A passage that passes is not nagged about spans that were quietly
	// discarded; one that fails is told, so the retry can fix the cause.
	if len(problems) > 0 {
		problems = append(problems, discarded...)
	}
	return problems
}

// contrastiveOpeners are the contrastive conjunctions the style check counts
// at the start of a sentence, longest first so a prefix never shadows one.
var contrastiveOpeners = []string{"けれども", "ところが", "しかし", "だが", "でも"}

// openingConjunction reports the conjunction a sentence opens with, if any,
// and whether it is a contrastive one. A contrastive opener is matched by its
// text, so a conjunction the tokeniser tags differently still counts.
func openingConjunction(sen Sentence) (word string, contrastive, ok bool) {
	for _, w := range contrastiveOpeners {
		if strings.HasPrefix(sen.JA, w) && onTokenBoundary(sen.Tokens, 0, utf8.RuneCountInString(w)) {
			return w, true, true
		}
	}
	if len(sen.Tokens) > 0 && sen.Tokens[0].conjunction {
		return sen.Tokens[0].Surface, false, true
	}
	return "", false, false
}

// styleProblems is the soft style check: too many sentences opening with a
// contrastive conjunction, or too many opening with any conjunction. It is
// kept apart from gate because a Story that fails only here is still accepted
// on its last attempt.
func styleProblems(s *Story) []string {
	n := len(s.Sentences)
	if n == 0 {
		return nil
	}
	var problems []string
	var contrastive []string
	conjunctive := 0
	for _, sen := range s.Sentences {
		word, isContrastive, ok := openingConjunction(sen)
		if !ok {
			continue
		}
		conjunctive++
		if isContrastive {
			contrastive = append(contrastive, fmt.Sprintf("%s (%q)", word, sen.JA))
		}
	}
	if len(contrastive) > MaxContrastiveOpeners {
		problems = append(problems, fmt.Sprintf(
			"%d sentences open with a contrastive conjunction, at most %d are allowed: %s. Use one only where the passage really turns against what came before, and link other ideas with clause endings (〜けど, 〜ので, 〜て), time words such as その後, or no connector at all",
			len(contrastive), MaxContrastiveOpeners, strings.Join(contrastive, "; ")))
	}
	if share := float64(conjunctive) / float64(n); share > MaxConjunctionShare {
		problems = append(problems, fmt.Sprintf(
			"%d of %d sentences (%.0f%%) open with a conjunction, at most %.0f%% may; join related clauses inside one sentence instead of starting a new sentence with そして, それから or a conjunction",
			conjunctive, n, share*100, MaxConjunctionShare*100))
	}
	return problems
}

// listWords joins up to max words for feedback, saying how many were left out.
func listWords(words []string, max int) string {
	if len(words) <= max {
		return strings.Join(words, "、")
	}
	return fmt.Sprintf("%s (and %d more)", strings.Join(words[:max], "、"), len(words)-max)
}

// locateSpan finds text in a sentence and returns its rune offsets [start,end).
// The first occurrence wins; a pattern that repeats within one sentence is rare
// and the model can disambiguate by citing a longer run of text.
func locateSpan(sentence, text string) (start, end int, ok bool) {
	i := strings.Index(sentence, text)
	if i < 0 {
		return 0, 0, false
	}
	start = utf8.RuneCountInString(sentence[:i])
	return start, start + utf8.RuneCountInString(text), true
}

// runeSlice is s[start:end] in runes, for quoting a span in feedback.
func runeSlice(s string, start, end int) string {
	rs := []rune(s)
	if start < 0 || end > len(rs) || start > end {
		return ""
	}
	return string(rs[start:end])
}

// shortfallHint turns a too-short passage into an instruction the model can
// act on. "203 characters, want 400" alone made a model merge sentences to
// reach the floor (or just shrug), since it cannot count characters; saying
// how far short it is and that the fix is more sentences, each in its own
// entry, steers it where the length actually comes from.
func shortfallHint(s *Story) string {
	runes := utf8.RuneCountInString(s.Text)
	if runes >= MinChars || len(s.Sentences) == 0 {
		return ""
	}
	short := MinChars - runes
	n := len(s.Sentences)
	avg := runes / n
	// Exact targets, not advice. "Make them longer" and "add 12 more" were
	// both easy to ignore or overdo: live, length-only retries came back
	// byte-identical four times running, and "add 12" drew 50 tiny sentences.
	// Sentences at least 10 characters longer than the ones written (and never
	// under 25), enough of them to land on a target with a clear margin above
	// the floor, since models still undershoot what they are asked for.
	per := max(avg+10, 25)
	target := (MinChars + PromptMinChars) / 2
	count := max(min((target+per-1)/per, PromptMaxSentences), 1)
	return fmt.Sprintf(" — it is about %d characters too short. You wrote %d sentences averaging %d characters (%d in total). "+
		"Rewrite it as %d sentences of at least %d characters each, about %d characters in total: "+
		"give every sentence a time, a place, a reason or a feeling to say, "+
		"and keep each sentence as its own separate entry (never merge sentences into one entry)",
		short, n, avg, runes, count, per, count*per)
}

// spanStartsAtContentWord reports whether a span opens at the first
// character of a content-word token — the stem-inclusion the pattern-only
// rule forbids (食べてしまった must be spanned てしまった, not from 食べ).
// It returns the offending surface for the retry feedback.
func spanStartsAtContentWord(toks []Token, start int) (string, bool) {
	for _, t := range toks {
		if t.Start == start && t.content {
			return t.Surface, true
		}
	}
	return "", false
}

// spanStartsLikePattern reports whether a span begins the way its Grammar
// Point's own pattern begins, which makes an opening content word part of the
// pattern (必要がある, はずがない, どうやって) rather than a verb or adjective
// stem the span swallowed before it (食べ in 食べてしまった). It compares the
// leading characters, so a conjugated span still matches (いたしました for
// いたします). With no pattern known it answers false, keeping the rule strict.
func spanStartsLikePattern(span, pattern string) bool {
	p := []rune(strings.TrimLeft(pattern, "～〜~"))
	if len(p) == 0 {
		return false
	}
	s := []rune(span)
	common := 0
	for common < len(p) && common < len(s) && p[common] == s[common] {
		common++
	}
	return common >= min(2, len(p))
}

// spanExpressesPattern reports whether a Grammar Span's text realises the
// pattern of the point it cites. A span matches a variant of the pattern (split
// on ・ and /, normalised as the catalogue normalises them) when:
//   - one contains the other (に in について, ことがある in ～ことがある);
//   - it starts the way the variant starts (いたしました for いたします); or
//   - the variant's dictionary forms appear in order in the span's
//     (てしまいました for てしまう), the rule internal/grammar uses.
//
// An empty pattern gives nothing to judge, so the span is kept. Live, the model
// put spans over と and について citing がり and あまり (issue #98 follow-up);
// this is the check that discards them.
func spanExpressesPattern(span, pattern string) bool {
	if strings.TrimSpace(pattern) == "" {
		return true
	}
	s := refdata.NormalisePattern(span)
	if s == "" {
		return false
	}
	spanSeq := baseForms(s)
	for _, v := range refdata.SplitVariants(pattern) {
		nv := refdata.NormalisePattern(v)
		if nv == "" {
			continue
		}
		if strings.Contains(s, nv) || strings.Contains(nv, s) || spanStartsLikePattern(s, nv) {
			return true
		}
		if seq := baseForms(nv); len(seq) > 0 && isSubseq(seq, spanSeq) {
			return true
		}
	}
	return false
}

// baseForms is the dictionary-form sequence of a text, the surface standing in
// where kagome has no base form. A text kagome cannot tokenise has none.
func baseForms(text string) []string {
	toks, err := tokenise(text)
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(toks))
	for _, t := range toks {
		if base, ok := t.BaseForm(); ok && base != "" && base != "*" {
			out = append(out, base)
		} else {
			out = append(out, t.Surface)
		}
	}
	return out
}

// isSubseq reports whether needle appears in hay in order, not necessarily
// contiguously.
func isSubseq(needle, hay []string) bool {
	i := 0
	for _, h := range hay {
		if i < len(needle) && needle[i] == h {
			i++
		}
	}
	return i == len(needle)
}

// grammarPattern is the catalogue text of a suggested grammar point.
func (f FocusSet) grammarPattern(pointID int64) string {
	for _, g := range f.Grammar {
		if g.PointID == pointID {
			return g.Pattern
		}
	}
	return ""
}

// hasGrammar reports whether the Focus Set suggested this grammar point;
// spans citing anything else are rejected.
func (f FocusSet) hasGrammar(pointID int64) bool {
	for _, g := range f.Grammar {
		if g.PointID == pointID {
			return true
		}
	}
	return false
}

// fallbackTitle is the no-title-from-the-model fallback (issue #31): the
// first sentence — everything up to the first 。？！ — or, when no
// terminator lands inside the first 40 runes, a shortened 40-rune cut.
func fallbackTitle(text string) string {
	const maxRunes = 40
	rs := []rune(text)
	limit := min(len(rs), maxRunes)
	for i, r := range rs[:limit] {
		if r == '。' || r == '？' || r == '！' {
			return string(rs[:i])
		}
	}
	return string(rs[:limit])
}

// stripNulls removes NUL characters: Postgres rejects \u0000 in text, and a
// model that emits one should produce a storable story, not a save failure.
func stripNulls(s string) string {
	if !strings.ContainsRune(s, 0) {
		return s
	}
	return strings.ReplaceAll(s, "\x00", "")
}

// toHiragana converts kagome's surface reading to hiragana: katakana
// morphemes (シズカ) tokenise with a katakana reading, and furigana is
// hiragana everywhere else (dictionary readings included), so readings are
// stored in one script. The long-vowel mark and iteration marks stay as they
// are; only the base katakana block (U+30A1–U+30FA, plus the small ン U+30FC
// is not converted) shifts by the fixed 0x60 offset to its hiragana twin.
func toHiragana(s string) string {
	if s == "" {
		return s
	}
	out := []rune(s)
	changed := false
	for i, r := range out {
		if r >= 0x30A1 && r <= 0x30FA {
			out[i] = r - 0x60
			changed = true
		}
	}
	if !changed {
		return s
	}
	return string(out)
}

// onTokenBoundary reports whether [start,end) covers whole kagome tokens.
func onTokenBoundary(toks []Token, start, end int) bool {
	for i, t := range toks {
		if t.Start != start {
			continue
		}
		for j := i; j < len(toks); j++ {
			if toks[j].End == end {
				return true
			}
			if toks[j].End > end {
				break
			}
		}
		break
	}
	return false
}

const systemPrompt = `You are a careful Japanese teacher writing short reading passages for English-speaking JLPT learners.
You never invent words: every word you use comes from the learner's known-word list you are given.
You answer only with JSON in exactly the shape requested, with no commentary.`

// userPrompt assembles the generation brief: genre/theme, the Focus Set's
// vocabulary and grammar, the Known Items list, and the JSON contract.
func userPrompt(req Request, settings Settings) string {
	var b strings.Builder
	fmt.Fprintf(&b, `Write a Japanese reading passage for a learner.

Passage rules:
- %d to %d characters total (counting every character), split into %d to %d sentences. That is about %d to %d characters per sentence, so write a complete sentence in each entry and do not stop early: a passage of fewer than %d characters is rejected. Never put several sentences into one entry.
- Join closely related clauses inside one sentence (with the te-form, けど, ので, から or のに) instead of starting a new sentence for each step.
- Use at most %d contrastive conjunctions (でも, しかし, ところが, けれども, だが) in the whole passage, and only for a real contrast. Link other ideas with clause endings, time words (その後, 次の日) or no connector at all. Keep the sentences that open with any conjunction to %.0f%% or fewer.
- Introduce every person the first time with a name or relationship (生徒の田中さん, 田中さんのお母さん), and refer to them the same way afterwards. In narration the narrator's own family is 母 or 父. Keep the cast to about three people.
- Natural modern Japanese in kana and kanji, plain text: no markdown, no quotes, no brackets.
- Use only words from the Known Words list below. A word not in the list is an error the checker will reject.
`, PromptMinChars, PromptMaxChars, PromptMinSentences, PromptMaxSentences, PromptMinSentenceRunes, PromptMaxSentenceRunes, MinChars, MaxContrastiveOpeners, MaxConjunctionShare*100)
	if req.Genre != "" {
		fmt.Fprintf(&b, "- Genre/theme: %s. Repeat it in the genre field.\n", req.Genre)
	} else {
		fmt.Fprintf(&b, "- Genre/theme: surprise the reader with any genre you think they would enjoy. Name it in the genre field.\n")
	}
	if req.Theme != "" {
		fmt.Fprintf(&b, "- Theme: %s.\n", req.Theme)
	}
	if len(req.DislikedGenres) > 0 {
		fmt.Fprintf(&b, "- Avoid these genres, the reader did not like them: %s.\n", strings.Join(req.DislikedGenres, ", "))
	}
	if len(req.AvoidRecentGenres) > 0 {
		fmt.Fprintf(&b, "- Avoid these genres too, the reader has just read them: %s.\n", strings.Join(req.AvoidRecentGenres, ", "))
	}

	if len(req.Focus.Vocab) > 0 {
		minUse := int(float64(len(req.Focus.Vocab))*settings.MinFocusFraction + 0.999)
		fmt.Fprintf(&b, `
Focus words (the words this lesson targets — at least %d of the %d must appear. Work them in where they fit naturally, and leave a word out rather than force it into an unrelated sentence):
%s
`, minUse, len(req.Focus.Vocab), vocabLines(req.Focus.Vocab))
	}
	if len(req.Focus.Grammar) > 0 {
		fmt.Fprintf(&b, `
Grammar points to use (cite each use with a grammar span):
%s
`, grammarLines(req.Focus.Grammar))
	}

	if len(req.KnownWords) > 0 {
		fmt.Fprintf(&b, `
Known words (the only words you may use; focus words are included):
%s
`, vocabLines(req.KnownWords))
	}

	fmt.Fprintf(&b, `
Title: give the passage a short Japanese title (title) and translate that title into English (title_en). Also name, in English, the theme you wrote on (theme) — the theme you were given if you were given one.

Comprehension questions: write %d to %d multiple-choice questions in Japanese about the passage. Each has 2 to 4 options and the index (from 0) of the correct option.

Grammar spans: for each use of a grammar point, give its grammar_point_id and text — the exact characters of that sentence that express the pattern, copied verbatim from the sentence's ja field. Do not count positions; the checker finds the text itself. Spans must cover whole words, and they cover the pattern's characters only — never the stem of the verb or adjective. Example: for 食べてしまった with the pattern てしまった, text is てしまった, not 食べてしまった. Never include the verb or adjective that comes before the pattern. A pattern that itself begins with a word, such as 必要がある or はずがない, is spanned in full.

Return JSON: {"title": string, "title_en": string, "theme": string, "genre": string, "sentences": [{"ja": string, "en": string, "grammar_spans": [{"text": string, "grammar_point_id": int}]}], "questions": [{"prompt_ja": string, "options_ja": [string], "answer_index": int}]}`,
		MinQuestions, MaxQuestions)
	return b.String()
}

func vocabLines(items []VocabFocus) string {
	var b strings.Builder
	for _, v := range items {
		if v.EN != "" {
			fmt.Fprintf(&b, "- %s (%s)\n", v.JA, v.EN)
		} else {
			fmt.Fprintf(&b, "- %s\n", v.JA)
		}
	}
	return b.String()
}

func grammarLines(items []GrammarFocus) string {
	var b strings.Builder
	for _, g := range items {
		fmt.Fprintf(&b, "- %s (grammar_point_id %d)\n", g.Pattern, g.PointID)
	}
	return b.String()
}

// Schema is the JSON Schema the model must answer with. Indexes are
// character (codepoint) positions, as the prompt says.
func Schema() llm.Schema {
	return llm.Schema{Name: "story", Schema: json.RawMessage(storySchemaJSON)}
}

const storySchemaJSON = `{"type":"object","properties":{
	"title":{"type":"string"},
	"title_en":{"type":"string"},
	"theme":{"type":"string"},
	"genre":{"type":"string"},
	"sentences":{"type":"array","minItems":3,"maxItems":100,"items":{
		"type":"object",
		"properties":{
			"ja":{"type":"string"},
			"en":{"type":"string"},
			"grammar_spans":{"type":"array","items":{
				"type":"object",
				"properties":{
					"text":{"type":"string"},
					"grammar_point_id":{"type":"integer"}
				},
				"required":["text","grammar_point_id"],
				"additionalProperties":false
			}}
		},
		"required":["ja","en","grammar_spans"],
		"additionalProperties":false
	}},
	"questions":{"type":"array","minItems":3,"maxItems":5,"items":{
		"type":"object",
		"properties":{
			"prompt_ja":{"type":"string"},
			"options_ja":{"type":"array","minItems":2,"maxItems":4,"items":{"type":"string"}},
			"answer_index":{"type":"integer"}
		},
		"required":["prompt_ja","options_ja","answer_index"],
		"additionalProperties":false
	}}
},"required":["title","title_en","theme","genre","sentences","questions"],"additionalProperties":false}`

// storyJSON is the model's reply shape. A Grammar Span arrives as the text it
// covers, and the server finds the character offsets itself: models cannot
// count characters, and one bad offset used to discard a whole passage (every
// retry repeated it). Start/End are still read, as a fallback for replies
// that give offsets instead of text.
type storyJSON struct {
	Genre     string `json:"genre"`
	Title     string `json:"title"`
	TitleEN   string `json:"title_en"`
	Theme     string `json:"theme"`
	Sentences []struct {
		JA           string `json:"ja"`
		EN           string `json:"en"`
		GrammarSpans []struct {
			Text           string `json:"text"`
			Start          int    `json:"start"`
			End            int    `json:"end"`
			GrammarPointID int64  `json:"grammar_point_id"`
		} `json:"grammar_spans"`
	} `json:"sentences"`
	Questions []struct {
		PromptJA  string   `json:"prompt_ja"`
		OptionsJA []string `json:"options_ja"`
		AnswerIdx int      `json:"answer_index"`
	} `json:"questions"`
}

func retryPrompt(problems []string, raw storyJSON) string {
	var b strings.Builder
	b.WriteString("That passage failed our automatic checks. Fix every problem below and rewrite the whole passage, keeping the same genre:\n")
	for _, p := range problems {
		b.WriteString("- " + p + "\n")
	}
	b.WriteString("\nThe passage you wrote:")
	for _, sen := range raw.Sentences {
		b.WriteString("\n" + sen.JA)
	}
	b.WriteString("\n\nReturn the complete corrected JSON, nothing else.")
	return b.String()
}
