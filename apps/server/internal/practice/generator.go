package practice

import (
	"context"
	"math/rand"
	"strconv"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
)

// constText options shown above recognition and cloze prompts.
const (
	instructionRecognition = "What does this mean?"
	instructionCloze       = "Which pattern completes the sentence?"
	clozeBlank             = "＿＿＿" // three full-width underscores
)

// generator builds one session's exercises. A single math/rand source is
// advanced in exercise order, so the same seed and Focus Set build exactly
// the same session; distractor sampling is salted per exercise (seed +
// ordinal) so two exercises of one kind do not pull the identical pool.
type generator struct {
	content   Content
	seed      int64
	rng       *rand.Rand
	exercises []Exercise
}

// add appends one exercise for item, reporting false when the item has no
// content and must be skipped.
func (g *generator) add(ctx context.Context, key mastery.ItemKey) (bool, error) {
	switch key.Kind {
	case mastery.KindVocabulary:
		return g.addVocabulary(ctx, key)
	case mastery.KindKanji:
		return g.addKanji(ctx, key)
	case mastery.KindGrammar:
		return g.addCloze(ctx, key)
	default:
		return false, nil
	}
}

func (g *generator) append(ex Exercise) { g.exercises = append(g.exercises, ex) }

func (g *generator) nextID() string {
	return "e" + strconv.Itoa(len(g.exercises)+1) // e1, e2, … in Focus Set order
}

func (g *generator) salt() int64 { return g.seed + int64(len(g.exercises)) }

func (g *generator) addVocabulary(ctx context.Context, key mastery.ItemKey) (bool, error) {
	entSeq, ok := parseNumericRef(key.Ref)
	if !ok {
		return false, nil // unlinked MaruMori id: no stored content (ADR-0002)
	}
	word, found, err := g.content.VocabWord(ctx, entSeq)
	if err != nil {
		return false, err
	}
	if !found || len(word.Meanings) == 0 {
		return false, nil
	}
	distractors, err := g.content.VocabDistractors(ctx, word.Level, []int64{entSeq}, g.salt(), OptionsPerExercise-1)
	if err != nil {
		return false, err
	}
	g.appendBuilt(key, word, distractors)
	return true, nil
}

func (g *generator) addKanji(ctx context.Context, key mastery.ItemKey) (bool, error) {
	word, found, err := g.content.KanjiWord(ctx, key.Ref)
	if err != nil {
		return false, err
	}
	if !found || len(word.Meanings) == 0 {
		return false, nil
	}
	distractors, err := g.content.KanjiDistractors(ctx, word.Level, []string{key.Ref}, g.salt(), OptionsPerExercise-1)
	if err != nil {
		return false, err
	}
	g.appendBuilt(key, word, distractors)
	return true, nil
}

func (g *generator) addCloze(ctx context.Context, key mastery.ItemKey) (bool, error) {
	pointID, ok := parseNumericRef(key.Ref)
	if !ok {
		return false, nil
	}
	cloze, found, err := g.content.GrammarCloze(ctx, pointID)
	if err != nil {
		return false, err
	}
	if !found || cloze.SpanText == "" || !validSpan(cloze) {
		return false, nil
	}
	distractors, err := g.content.ClozeDistractors(ctx, cloze.Level, pointID, cloze.SpanText, g.salt(), OptionsPerExercise-1)
	if err != nil {
		return false, err
	}

	runes := []rune(cloze.Sentence)
	ex := Exercise{
		ID:          g.nextID(),
		Kind:        ExerciseGrammarCloze,
		Item:        key,
		Prompt:      string(runes[:cloze.SpanStart]) + clozeBlank + string(runes[cloze.SpanEnd:]),
		Instruction: instructionCloze,
	}
	ex.Options, ex.CorrectOptionID = g.options(cloze.SpanText, distractors)
	g.append(ex)
	return true, nil
}

// validSpan re-checks the validator's guarantee (sentence[span] == spanText)
// against drift or hand-edited rows: a broken span blanks wrongly, so the
// example is skipped instead.
func validSpan(c ClozeContent) bool {
	r := []rune(c.Sentence)
	if c.SpanStart < 0 || c.SpanEnd > len(r) || c.SpanStart >= c.SpanEnd {
		return false
	}
	return string(r[c.SpanStart:c.SpanEnd]) == c.SpanText
}

// appendBuilt builds one recognition exercise: correct is the item's first
// meaning, options are correct plus distractors, shuffled.
func (g *generator) appendBuilt(key mastery.ItemKey, word Word, distractors []string) {
	ex := Exercise{
		ID:          g.nextID(),
		Kind:        ExerciseRecognition,
		Item:        key,
		Prompt:      word.Display,
		Instruction: instructionRecognition,
	}
	ex.Options, ex.CorrectOptionID = g.options(word.Meanings[0], distractors)
	g.append(ex)
}

// options shuffles correct plus up to OptionsPerExercise-1 distinct,
// non-empty distractors (never equal to correct) into "a"…"d" options, and
// reports which id holds correct.
func (g *generator) options(correct string, distractors []string) ([]Option, string) {
	texts := []string{correct}
	for _, d := range distractors {
		if d == "" || d == correct {
			continue
		}
		seen := false
		for _, t := range texts[1:] {
			if t == d {
				seen = true
				break
			}
		}
		if !seen {
			texts = append(texts, d)
		}
		if len(texts) == OptionsPerExercise {
			break
		}
	}
	g.shuffle(texts)
	opts := make([]Option, len(texts))
	correctID := ""
	for i, t := range texts {
		id := string(rune('a' + i))
		opts[i] = Option{ID: id, Text: t}
		if t == correct {
			correctID = id
		}
	}
	return opts, correctID
}

func (g *generator) shuffle(texts []string) {
	if g.rng == nil {
		g.rng = rand.New(rand.NewSource(g.seed))
	}
	g.rng.Shuffle(len(texts), func(i, j int) { texts[i], texts[j] = texts[j], texts[i] })
}
