package story

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"

	"github.com/google/uuid"
	"github.com/ikawaha/kagome-dict/ipa"
	"github.com/ikawaha/kagome/v2/tokenizer"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
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

// isContent reports whether a token is a content word for coverage purposes:
// nouns, verbs, adjectives and adverbs, minus bare numerals (名詞,数 — JMdict
// is not a number list). It matches internal/grammar's coverage rule so the
// two features count "content word" the same way.
func isContent(t tokenizer.Token) bool {
	switch posCategory(t) {
	case "名詞", "動詞", "形容詞", "副詞":
		return posSubCategory(t) != "数"
	default:
		return false
	}
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
	// DislikedGenres are the genres the Learner rated net down: the prompt
	// names them as "avoid", and PickGenre already dropped them from its
	// fallback.
	DislikedGenres []string
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
	var lastErr error
	for attempt := 1; attempt <= settings.MaxAttempts; attempt++ {
		res, err := client.ChatJSON(ctx, msgs, Schema(), llm.Options{MaxTokens: 4000})
		if err != nil {
			// Provider-level failure: gate feedback cannot fix it. Report
			// the last candidate if a previous attempt got that far.
			if last != nil {
				return last, lastErr
			}
			return nil, fmt.Errorf("story generation: %w", err)
		}
		var raw storyJSON
		if err := json.Unmarshal(res.JSON, &raw); err != nil {
			lastErr = fmt.Errorf("story generation: parsing model output: %w", err)
			msgs = append(msgs,
				llm.Message{Role: llm.RoleAssistant, Content: string(res.JSON)},
				llm.Message{Role: llm.RoleUser, Content: "That was not valid JSON for the schema. Return the complete corrected JSON only."},
			)
			continue
		}
		story, err := g.materialise(ctx, &raw, req.UserID, req.Focus, req.Genre)
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
		if len(problems) == 0 {
			story.Validated = true
			return story, nil
		}
		story.Validated = false
		last = story
		lastErr = fmt.Errorf("story rejected by the validation gate on attempt %d: %s", attempt, strings.Join(problems, "; "))
		if attempt < settings.MaxAttempts {
			msgs = append(msgs,
				llm.Message{Role: llm.RoleAssistant, Content: string(res.JSON)},
				llm.Message{Role: llm.RoleUser, Content: retryPrompt(problems, raw)},
			)
		}
	}
	return last, lastErr
}

// materialise converts the model's JSON into a Story: tokenising every
// sentence with kagome and linking content tokens to jmdict entries through
// the lookup. Known/unknown tagging happens afterwards in tagKnown, once the
// linked entries are known. Spans arriving here are copied verbatim; the
// gate judges them.
func (g *Generator) materialise(ctx context.Context, raw *storyJSON, userID uuid.UUID, focus FocusSet, genre string) (*Story, error) {
	s := &Story{UserID: userID, Genre: genre}
	if s.Genre == "" {
		s.Genre = raw.Genre
	}
	if s.Genre == "" {
		s.Genre = "free"
	}
	var texts []string
	looked := map[string]VocabHit{} // surface → hit, so repeats cost one query
	for i, in := range raw.Sentences {
		sen := Sentence{Pos: i, JA: in.JA, EN: in.EN}
		toks, err := tokenise(in.JA)
		if err != nil {
			return nil, err
		}
		for j, kt := range toks {
			base, _ := kt.BaseForm()
			reading, _ := kt.Reading()
			tok := Token{Pos: j, Surface: kt.Surface, Start: kt.Start, End: kt.End, Reading: reading, Dictionary: base, Tag: TagUnknown}
			if isContent(kt) {
				tok.content = true
				hit, ok := looked[kt.Surface]
				if !ok {
					var err error
					hit, ok, err = g.lookup.Lookup(ctx, kt.Surface, base)
					if err != nil {
						return nil, err
					}
					if ok {
						looked[kt.Surface] = hit
					}
				}
				if ok {
					seq := hit.EntSeq
					tok.EntSeq = &seq
					tok.Dictionary = hit.JA
				}
			}
			sen.Tokens = append(sen.Tokens, tok)
		}
		for _, sp := range in.GrammarSpans {
			sen.Spans = append(sen.Spans, Span{
				Start:          sp.Start,
				End:            sp.End,
				GrammarPointID: sp.GrammarPointID,
				IsFocus:        focus.hasGrammar(sp.GrammarPointID),
			})
		}
		s.Sentences = append(s.Sentences, sen)
		texts = append(texts, in.JA)
	}
	for i, q := range raw.Questions {
		s.Questions = append(s.Questions, Question{Pos: i, PromptJA: q.PromptJA, OptionsJA: q.OptionsJA, AnswerIndex: q.AnswerIdx})
	}
	s.Text = strings.Join(texts, "")

	// Vocabulary the Story covers: every linked content token, deduplicated
	// by ent_seq keeping the first hit.
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
	return s, nil
}

// tagKnown asks the KnownSource about every ent_seq the candidate linked to,
// then tags tokens (known + SRS Level) and flags vocab items IsKnown/IsFocus.
func (g *Generator) tagKnown(ctx context.Context, s *Story, req Request) error {
	var seqs []int64
	seen := map[int64]bool{}
	for _, sen := range s.Sentences {
		for _, t := range sen.Tokens {
			if t.EntSeq != nil && !seen[*t.EntSeq] {
				seen[*t.EntSeq] = true
				seqs = append(seqs, *t.EntSeq)
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
			if v, ok := known[*t.EntSeq]; ok && v.IsKnown {
				t.Tag = TagKnown
				level := v.SRSLevel
				t.SRSLevel = &level
			}
		}
	}
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

// gate runs the deterministic checks over an already-tokenised, already-
// tagged candidate: Known-word coverage over content tokens, Focus Set
// inclusion over BOTH the vocabulary and grammar halves, and Grammar Spans
// citing suggested points on token boundaries and covering only the
// pattern's own characters. It fills the Story's count fields either way, so
// a rejected Story still records what the gate saw.
func (g *Generator) gate(s *Story, settings Settings, focus FocusSet) []string {
	if err := s.Validate(); err != nil {
		return []string{err.Error()}
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
	focusHit := map[int64]bool{}
	grammarHit := map[int64]bool{}
	for _, sen := range s.Sentences {
		for _, t := range sen.Tokens {
			if !t.content {
				continue
			}
			content++
			if t.Tag != TagKnown {
				continue // unlinked vocabulary items count as unknown
			}
			knownCount++
			if t.EntSeq != nil && focusWant[*t.EntSeq] {
				focusHit[*t.EntSeq] = true
			}
		}
		for si := range sen.Spans {
			sp := &sen.Spans[si]
			if !focusGrammar[sp.GrammarPointID] {
				problems = append(problems, fmt.Sprintf(
					"grammar span [%d,%d) in sentence %d cites point %d, which was not in the suggested list",
					sp.Start, sp.End, sen.Pos, sp.GrammarPointID))
				continue
			}
			if !onTokenBoundary(sen.Tokens, sp.Start, sp.End) {
				problems = append(problems, fmt.Sprintf(
					"grammar span [%d,%d) in sentence %d cuts across word boundaries; spans must cover whole words",
					sp.Start, sp.End, sen.Pos))
			}
			if surf, atStem := spanStartsAtContentWord(sen.Tokens, sp.Start); atStem {
				problems = append(problems, fmt.Sprintf(
					"grammar span [%d,%d) in sentence %d opens at the content word %s; a span must cover the pattern's own characters only, never the verb or adjective stem (for 食べてしまった with pattern てしまった the span covers てしまった)",
					sp.Start, sp.End, sen.Pos, surf))
			}
			grammarHit[sp.GrammarPointID] = true
		}
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
				"known-word coverage is %.0f%% (%d of %d content words are words the learner knows); at least %.0f%% are required — rewrite using only the known words you were given",
				cov*100, knownCount, content, settings.MinCoverage*100))
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
	return problems
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
- %d to %d characters total (counting every character), split into 4 to %d sentences.
- Natural modern Japanese in kana and kanji, plain text: no markdown, no quotes, no brackets.
- Use only words from the Known Words list below. A word not in the list is an error the checker will reject.
`, MinChars, 800, MaxSentences)
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

	if len(req.Focus.Vocab) > 0 {
		minUse := int(float64(len(req.Focus.Vocab))*settings.MinFocusFraction + 0.999)
		fmt.Fprintf(&b, `
Focus words (the words this lesson targets — at least %d of the %d must appear, and the passage should be about them):
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
Comprehension questions: write %d to %d multiple-choice questions in Japanese about the passage. Each has 2 to 4 options and the index (from 0) of the correct option.

Character positions: for each grammar span, start is the position of its first character (counting from 0 across the sentence) and end is the position just after its last character. Spans must cover whole words, and they cover the pattern's characters only — never the stem of the verb or adjective. Example: for 食べてしまった with the pattern てしまった, the span starts at the て, not at 食べ. A span that opens at the first character of a content word is rejected.

Return JSON: {"genre": string, "sentences": [{"ja": string, "en": string, "grammar_spans": [{"start": int, "end": int, "grammar_point_id": int}]}], "questions": [{"prompt_ja": string, "options_ja": [string], "answer_index": int}]}`,
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
	"genre":{"type":"string"},
	"sentences":{"type":"array","minItems":3,"maxItems":8,"items":{
		"type":"object",
		"properties":{
			"ja":{"type":"string"},
			"en":{"type":"string"},
			"grammar_spans":{"type":"array","items":{
				"type":"object",
				"properties":{
					"start":{"type":"integer"},
					"end":{"type":"integer"},
					"grammar_point_id":{"type":"integer"}
				},
				"required":["start","end","grammar_point_id"],
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
			"options_ja":{"type":"array","minItems":2,"items":{"type":"string"}},
			"answer_index":{"type":"integer"}
		},
		"required":["prompt_ja","options_ja","answer_index"],
		"additionalProperties":false
	}}
},"required":["genre","sentences","questions"],"additionalProperties":false}`

// storyJSON is the model's reply shape; indexes are characters, as the
// schema and system prompt both say.
type storyJSON struct {
	Genre     string `json:"genre"`
	Sentences []struct {
		JA           string `json:"ja"`
		EN           string `json:"en"`
		GrammarSpans []struct {
			Start          int   `json:"start"`
			End            int   `json:"end"`
			GrammarPointID int64 `json:"grammar_point_id"`
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
