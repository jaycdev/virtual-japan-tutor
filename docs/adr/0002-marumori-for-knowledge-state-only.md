# MaruMori supplies knowledge state only; Item content comes from open data

MaruMori's public API is unofficial and undocumented (known only from a community reference). Its "known" lists return just each Item's text and SRS Level, and MaruMori's terms of use forbid copying or reproducing its content. So we use MaruMori only to learn *which* Items the Learner knows and their SRS Levels. Readings and meanings come from open datasets (JMdict for vocabulary, KANJIDIC for kanji) and from our own Grammar Catalogue. MaruMori content is never stored or sent to an AI Provider.

All MaruMori calls go through a single adapter in the Go server. The MVP never writes to MaruMori. If the API breaks, the app keeps working from the last synced data.

## Consequences

- MaruMori has no incremental sync, so each Sync pulls the full lists and compares them with what we have. It runs every few hours, plus on demand.
- We record how each Item's SRS Level changes between Syncs. That gives us a Mastery trend MaruMori doesn't provide.
