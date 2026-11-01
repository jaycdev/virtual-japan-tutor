# Known grammar is seeded from a Starting Level, then grown from observed activity

MaruMori's API can list known kanji and vocabulary, but not known grammar. It only exposes grammar that is currently in lessons or due for review, plus total counts per SRS Level. So the Learner declares a Starting Level (a JLPT Level) when they set up the app, and Grammar Catalogue points at or below that level are treated as known (Seeded Grammar). After that, each Sync adds grammar seen in the Learner's MaruMori grammar activity (Observed Grammar), and newly observed points are targeted straight away.

The alternatives were relying only on observed activity, which means no grammar coverage on day one, or making the Learner tick points manually, which is tedious and drifts out of date.
