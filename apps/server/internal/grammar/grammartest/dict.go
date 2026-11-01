// Package grammartest provides in-memory fakes for the grammar package's
// interfaces, for use by its tests and by tests of its callers.
package grammartest

import (
	"context"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
)

// MemDictionary is a fixed set of known surface forms standing in for the
// JMdict reference data.
type MemDictionary struct {
	words   map[string]bool
	lookups []string // every surface asked about, for assertions
}

func NewMemDictionary(words ...string) *MemDictionary {
	d := &MemDictionary{words: map[string]bool{}}
	for _, w := range words {
		d.words[w] = true
	}
	return d
}

func (d *MemDictionary) Known(_ context.Context, surface string) (bool, error) {
	d.lookups = append(d.lookups, surface)
	return d.words[surface], nil
}

// Lookups returns every surface form the dictionary was asked about.
func (d *MemDictionary) Lookups() []string { return d.lookups }

var _ grammar.Dictionary = (*MemDictionary)(nil)
