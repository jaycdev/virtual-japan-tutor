# The Interface Language comes from a typed string table in `@vjt/core`, and the server stays English

The Learner can switch the interface to Japanese (with or without furigana) to practise reading. The choice is saved on each device, like theme and Japanese font. All interface text lives in one typed string table in `@vjt/core`, shared by the web and mobile apps (ADR-0010). Each entry holds the English text, the Japanese text and the Japanese with hand-written readings. The type checker and a test make sure no entry is missing its Japanese. The server doesn't know which Interface Language a device uses. It keeps sending English, and the apps choose the wording from stable codes: Exercise instructions from the Exercise's `kind`, and errors from the error's `code`. If a code has no translation, the server's English message shows.

## Considered Options

- **i18next (or a similar library) with JSON files for each language.** Rejected. With two languages and one shared package, a typed table catches missing keys at compile time and adds no runtime dependency. The library also has no built-in way to store hand-written furigana readings.
- **Save the Interface Language on the server and have it send translated text.** Rejected because the Learner wanted the choice per device, and because the server would need a second copy of every string.
- **Furigana on interface text decided by the Furigana Threshold.** Rejected because interface text isn't matched to Items, so there is no SRS Level to compare against.

## Consequences

- New interface text has to go in the string table, never straight into JSX. Text written straight into the JSX of either app should become a lint error.
- Learning content (meanings, Sentence Translations, a Story Title's translation, Dictionary Entry senses) is never put in the table and stays English.
- Genres are still saved, and sent to the AI, in English. Only the suggested Genres have Japanese names, and a Genre the Learner typed shows as typed.
