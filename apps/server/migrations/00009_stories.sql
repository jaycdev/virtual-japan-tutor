-- +goose Up
-- Story generation (issue #10): generated Stories with their sentences, token
-- tags, Grammar Spans, and comprehension questions; the Story Library list;
-- ratings; and per-user Story settings. Spans and token offsets are codepoint
-- (rune) indexes into the sentence text, matching grammar_examples (00006)
-- and the convention documented in api/openapi.yaml -- not UTF-16 indexes.

ALTER TABLE users
    ADD COLUMN furigana_threshold_srs_level SMALLINT NOT NULL DEFAULT 3
        CHECK (furigana_threshold_srs_level BETWEEN 0 AND 9);
-- Furigana Threshold (GLOSSARY.md): the SRS Level at or above which Known
-- Items appear without furigana; below it, and for unknown tokens, the
-- reading is shown. mastery.MaxSRSLevel is 9; level 3 is the product default.

CREATE TABLE stories (
    id             UUID        PRIMARY KEY,
    user_id        UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    genre          TEXT        NOT NULL CHECK (genre <> ''),
    -- The generation brief sent to the model (base user prompt, not the
    -- retry feedback): what was asked of the model, kept for debugging a
    -- Story's gate outcome.
    prompt         TEXT        NOT NULL,
    text           TEXT        NOT NULL,
    -- Vocabulary the Story covers: every sentence token that linked to a
    -- jmdict entry, by ent_seq, with whether it was a Known Item at
    -- generation time. Written from the generation-time tokenisation.
    vocab_items    JSONB       NOT NULL DEFAULT '[]'::jsonb,
    -- What the validation gate decided, on the last attempt whether or not
    -- it passed (ADR 0002: the outcome of the gate is data, kept either way).
    content_words  INTEGER     NOT NULL CHECK (content_words >= 0),
    known_words    INTEGER     NOT NULL CHECK (known_words >= 0 AND known_words <= content_words),
    focus_items    INTEGER     NOT NULL DEFAULT 0 CHECK (focus_items >= 0),
    focus_hit      INTEGER     NOT NULL CHECK (focus_hit >= 0 AND focus_hit <= focus_items),
    validated      BOOLEAN     NOT NULL,
    attempts       INTEGER     NOT NULL DEFAULT 1 CHECK (attempts >= 1),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- At most one ready (not yet opened) Story per user: the background
    -- generator keeps exactly zero or one, so opening a Story is instant.
    -- Opening a Story clears this; the library keeps the row either way.
    ready_at       TIMESTAMPTZ,
    -- When this Story's first comprehension answer wrote Practice Records
    -- (one row per Focus Set item it covers, at most once per Story); NULL
    -- until then. The marker lives here rather than in practice_records,
    -- which stays a plain append-only log (00008).
    practiced_at   TIMESTAMPTZ
);

CREATE INDEX stories_user_created_idx ON stories (user_id, created_at DESC);
CREATE UNIQUE INDEX stories_one_ready_idx ON stories (user_id) WHERE ready_at IS NOT NULL;

CREATE TABLE story_sentences (
    id          UUID       PRIMARY KEY,
    story_id    UUID       NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
    position    INTEGER    NOT NULL CHECK (position >= 0),
    ja          TEXT       NOT NULL CHECK (ja <> ''),
    en          TEXT       NOT NULL CHECK (en <> ''),
    UNIQUE (story_id, position)
);

-- Every morpheme of every sentence as kagome tokenised it, tagged known or
-- unknown against the user's Known Items at generation time. Function-word
-- tokens are stored too (the display needs their exact surfaces), but only
-- content words drive the coverage counts — and only content words are
-- looked up, so non-content tokens carry NO ent_seq link. Widening those
-- links belongs to the #11 reading experience (tappable word lookups), not
-- to generation.
CREATE TABLE story_tokens (
    id          UUID       PRIMARY KEY,
    story_id    UUID       NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
    sentence_id UUID       NOT NULL REFERENCES story_sentences (id) ON DELETE CASCADE,
    position    INTEGER    NOT NULL CHECK (position >= 0),
    surface     TEXT       NOT NULL CHECK (surface <> ''),
    start       INTEGER    NOT NULL CHECK (start >= 0),
    "end"       INTEGER    NOT NULL CHECK ("end" > start),
    reading     TEXT       NOT NULL DEFAULT '',
    dictionary  TEXT       NOT NULL DEFAULT '',
    -- ON DELETE SET NULL: a jmdict entry withdrawn upstream unlinks the
    -- token rather than deleting the whole Story (the token then reads as
    -- unlinked, exactly like a token that never linked at all).
    ent_seq     BIGINT REFERENCES jmdict_entries (ent_seq) ON DELETE SET NULL,
    tag         TEXT       NOT NULL CHECK (tag IN ('known', 'unknown')),
    -- The Learner's SRS Level at generation time; mastery's scale is 0–9
    -- (mastery.MaxSRSLevel), and only Known Items carry one.
    srs_level   SMALLINT   CHECK (srs_level BETWEEN 0 AND 9),
    UNIQUE (story_id, sentence_id, position)
);

CREATE TABLE story_grammar_spans (
    id               UUID       PRIMARY KEY,
    story_id         UUID       NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
    sentence_id      UUID       NOT NULL REFERENCES story_sentences (id) ON DELETE CASCADE,
    start            INTEGER    NOT NULL CHECK (start >= 0),
    "end"            INTEGER    NOT NULL CHECK ("end" > start),
    grammar_point_id BIGINT     NOT NULL REFERENCES grammar_points (id),
    -- The point was in the Focus Set the Story was generated for. Answering
    -- a comprehension question writes Practice Records for these Grammar
    -- Points (once per point per Story), matching vocab_items' IsFocus flag.
    -- Validated Stories' spans are all focus spans (the gate rejects the
    -- rest); failed ones may store others unflagged.
    is_focus         BOOLEAN    NOT NULL DEFAULT FALSE
);

-- Every span read goes through story_id (Get's loadChildren); without this
-- the query seq-scans the whole table.
CREATE INDEX story_grammar_spans_story_idx ON story_grammar_spans (story_id);

CREATE TABLE story_questions (
    id           UUID        PRIMARY KEY,
    story_id     UUID        NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
    position     INTEGER     NOT NULL CHECK (position >= 0),
    prompt_ja    TEXT        NOT NULL CHECK (prompt_ja <> ''),
    options_ja   TEXT[]      NOT NULL CHECK (cardinality(options_ja) >= 2),
    answer_index SMALLINT    NOT NULL CHECK (answer_index >= 0),
    UNIQUE (story_id, position),
    CHECK (answer_index < cardinality(options_ja))
);

CREATE TABLE story_ratings (
    story_id UUID        PRIMARY KEY REFERENCES stories (id) ON DELETE CASCADE,
    user_id  UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    rating   TEXT        NOT NULL CHECK (rating IN ('up', 'down')),
    rated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RatingCounts and genre steering look ratings up by user; the PRIMARY KEY
-- only covers the story side.
CREATE INDEX story_ratings_user_idx ON story_ratings (user_id);

-- Per-user background state: the membership of the Focus Set captured when
-- the last VALIDATED Story was generated (a failed attempt leaves the old
-- snapshot so the next pass re-tries against the same Focus Set). A
-- significant change (see internal/story: at least a third of the members
-- differ) re-arms generation; the keys are mastery ItemKey refs
-- ("vocabulary:1234"). preferred_genre/preferred_theme are the Learner's
-- story preferences ('' = "surprise me" / no theme): they steer the prompt's
-- genre/theme choice, never the validation gate.
CREATE TABLE story_user_state (
    user_id         UUID        PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    focus_snapshot  TEXT[]      NOT NULL DEFAULT '{}',
    preferred_genre TEXT        NOT NULL DEFAULT '',
    preferred_theme TEXT        NOT NULL DEFAULT '',
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE story_user_state;
DROP TABLE story_ratings;
DROP TABLE story_questions;
DROP TABLE story_grammar_spans;
DROP TABLE story_tokens;
DROP TABLE story_sentences;
DROP TABLE stories;
ALTER TABLE users DROP COLUMN furigana_threshold_srs_level;
