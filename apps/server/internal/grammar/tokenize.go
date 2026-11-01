package grammar

import (
	"fmt"
	"sync"

	"github.com/ikawaha/kagome-dict/ipa"
	"github.com/ikawaha/kagome/v2/tokenizer"
)

// Token is one morph of a sentence. Start and End are rune offsets into the
// sentence. Base is the token's dictionary form, empty for tokens the
// morphological dictionary does not know. POS lists the part-of-speech
// elements, outermost category first (e.g. 名詞, 数).
type Token struct {
	Surface string
	Start   int
	End     int
	POS     []string
	Base    string
}

// The morphological tokeniser is kagome (github.com/ikawaha/kagome): pure Go,
// so it behaves identically in tests, the server, and containers, with the
// IPA dictionary embedded in the binary. Loading the dictionary is lazy and
// happens once per process.
var analyser = struct {
	once sync.Once
	tok  *tokenizer.Tokenizer
	err  error
	mu   sync.Mutex // kagome tokenisers are not goroutine-safe; generations run concurrently
}{}

// tokenise splits a sentence into Tokens. A non-nil error is an internal
// failure of the analyser, never a rejection.
func tokenise(s string) ([]Token, error) {
	analyser.once.Do(func() {
		analyser.tok, analyser.err = tokenizer.New(ipa.Dict(), tokenizer.OmitBosEos())
	})
	if analyser.err != nil {
		return nil, fmt.Errorf("grammar tokeniser: %w", analyser.err)
	}
	analyser.mu.Lock()
	defer analyser.mu.Unlock()
	raw := analyser.tok.Tokenize(s)
	out := make([]Token, 0, len(raw))
	for _, t := range raw {
		base, _ := t.BaseForm()
		out = append(out, Token{Surface: t.Surface, Start: t.Start, End: t.End, POS: t.POS(), Base: base})
	}
	return out, nil
}
