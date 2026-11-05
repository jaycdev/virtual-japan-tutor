# Particles look up the Grammar Catalogue, not JMdict

A particle in a Story (は, が, を, に, の, で, と, も and similar) opens a Lookup that shows the Grammar Catalogue point it expresses, not a JMdict entry. Particles still get no dictionary link: the reader gives them a Grammar Catalogue hint instead.

**Why:** JMdict is a poor source for a particle. A single-kana spelling matches many unrelated entries (は is also the reading of 歯 and 葉), so a dictionary Lookup would hover a particle as an unrelated noun. What a Learner wants from は is its job ("topic marker"), and the Grammar Catalogue already says that for most particles ([ADR 0005](0005-grammar-catalogue-source.md)).

**The rule:**
- A token with no dictionary link whose surface is exactly a Grammar Catalogue pattern gets a hint: the point's id, pattern, meaning and JLPT Level. It is computed when a Story loads, never stored, so existing Stories need no repair and catalogue edits show up at once.
- A pattern with rows at several levels (に, と, も) resolves to the lowest level (N5 first), then catalogue order.
- A particle with no row (へ) gets no hint and stays unhoverable.
- Auxiliaries (だ, です, ます, ない, た) get no hint either: the catalogue has no single-token row for them, so they stay unhoverable.

**What a hint does not do:** it is not a dictionary link (`entSeq`). So a hinted particle gets no dotted underline, no Weak Signal, no Lookup Menu and nothing to save, and it adds nothing to `vocab_items`. Those behaviours key on `entSeq`, and they stay that way.

**Known limit:** the rule matches on surface alone, because the stored token keeps no part of speech. An unlinked content word whose surface happens to equal a catalogue pattern would also get a hint. In practice that does not occur for the particles above.
