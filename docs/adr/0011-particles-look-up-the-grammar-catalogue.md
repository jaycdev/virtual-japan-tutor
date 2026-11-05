# Particles look up the Grammar Catalogue, not JMdict

A particle in a Story (は, が, を, に, の, で, と, も and similar) opens a Lookup that shows the Grammar Catalogue point it expresses, not a JMdict entry. Particles still get no dictionary link: the reader gives them a Grammar Catalogue hint instead.

**Why:** JMdict is a poor source for a particle. A single-kana spelling matches many unrelated entries (は is also the reading of 歯 and 葉), so a dictionary Lookup would hover a particle as an unrelated noun. What a Learner wants from は is its job ("topic marker"), and the Grammar Catalogue already says that for most particles ([ADR 0005](0005-grammar-catalogue-source.md)).

**The rule:**
- A token with no dictionary link whose surface is one of an explicit list of particles (は が を に の で と も へ や か ね よ から まで より) and is exactly a Grammar Catalogue pattern gets a hint: the point's id, pattern, meaning and JLPT Level. The list is in `hintParticles` (`apps/server/internal/story/story.go`).
- The hint is computed when a Story loads, never stored, so existing Stories need no repair and catalogue edits show up at once.
- A pattern with rows at several levels (に, と, も) resolves to the lowest level (N5 first), then catalogue order.
- Anything not on the list gets no hint, even when the catalogue has a row for it. The catalogue has single-kana rows for auxiliaries, such as な (N4, "don't ~"), and kagome leaves those unlinked too, so a bare pattern match would hint きれいな with the wrong meaning. The stored token keeps no part of speech, which is why the rule is a list and not a POS check. Auxiliaries (だ, です, ます, ない, た) stay unhoverable, and so does へ, which has no row.

**What a hint does not do:** it is not a dictionary link (`entSeq`). So a hinted particle gets no dotted underline, no Weak Signal, no Lookup Menu and nothing to save, and it adds nothing to `vocab_items`. Those behaviours key on `entSeq` and stay that way. A hinted particle shows its Lookup row on hover, focus or press, and is focusable without claiming to open a menu.

**Maintenance:** adding a particle to the list is a one-line change, and it needs a test that the new surface gets a hint.
