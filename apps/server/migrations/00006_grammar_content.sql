-- +goose Up
-- Grammar Catalogue content (issue #8): provenance columns for the explanation
-- and the AI-generated example sentences with their Grammar Spans.

ALTER TABLE grammar_points
    -- When the explanation last changed (generated or hand-edited); NULL when it
    -- has never been filled in.
    ADD COLUMN explanation_updated_at timestamptz,
    -- true when a Learner edited the explanation by hand, false when it came
    -- from generation, NULL-equivalent handled by explanation_updated_at.
    ADD COLUMN explanation_edited boolean NOT NULL DEFAULT false;

-- One example sentence per Grammar Point, validated server-side before insert
-- (see internal/grammar). Span offsets are rune offsets into sentence_ja; the
-- validator guarantees sentence_ja[span_start:span_end] == span_text, which the
-- database cannot express as a CHECK.
CREATE TABLE grammar_examples (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    grammar_point_id bigint    NOT NULL REFERENCES grammar_points(id) ON DELETE CASCADE,
    sentence_ja    text        NOT NULL,
    translation_en text        NOT NULL,
    span_start     integer     NOT NULL CHECK (span_start >= 0),
    span_end       integer     NOT NULL CHECK (span_end > span_start),
    span_text      text        NOT NULL,
    source         text        NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'manual')),
    -- Which validation pipeline accepted the sentence; today there is one.
    language_check text        NOT NULL DEFAULT 'jmdict_tokenised'
                                 CHECK (language_check = 'jmdict_tokenised'),
    created_at     timestamptz NOT NULL DEFAULT now(),
    -- Re-generating the same sentence for the same point is a no-op, not a dupe.
    UNIQUE (grammar_point_id, sentence_ja)
);
CREATE INDEX grammar_examples_grammar_point_idx ON grammar_examples (grammar_point_id);

-- +goose Down
DROP TABLE grammar_examples;
ALTER TABLE grammar_points
    DROP COLUMN explanation_edited,
    DROP COLUMN explanation_updated_at;
