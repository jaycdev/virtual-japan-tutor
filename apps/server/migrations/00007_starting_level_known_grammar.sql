-- +goose Up
-- Onboarding and grammar knowledge (issue #6, docs/adr/0003): the Starting Level the
-- Learner declares at onboarding, and the two halves of known grammar — Seeded
-- Grammar derived from the Starting Level, and Observed Grammar confirmed by
-- MaruMori grammar reviews and matched to the Grammar Catalogue.

ALTER TABLE users
    -- NULL until onboarding picks one. Grammar Points at or below it are Seeded.
    ADD COLUMN starting_level text CHECK (starting_level IN ('N5', 'N4', 'N3', 'N2', 'N1'));

-- One row per (Learner, Grammar Point) the Learner knows. source records why:
-- 'seeded' from the Starting Level, 'observed' from MaruMori grammar reviews.
-- A seeded point confirmed by MaruMori flips to 'observed' and survives later
-- Starting Level changes; changing the Starting Level adds and removes 'seeded'
-- rows only (issue #6).
CREATE TABLE known_grammar_points (
    user_id          uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- ON DELETE CASCADE: when the importer prunes a Grammar Point from the
    -- Catalogue, the Learner's Known Item for it goes with it.
    grammar_point_id bigint      NOT NULL REFERENCES grammar_points(id) ON DELETE CASCADE,
    source           text        NOT NULL CHECK (source IN ('seeded', 'observed')),
    -- Initial Mastery per docs/adr/0003: Seeded starts medium, newly Observed
    -- starts low so it is targeted straight away. Later Practice rewrites it.
    mastery          text        NOT NULL CHECK (mastery IN ('low', 'medium', 'high')),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    -- The PK already serves per-user lookups: no extra user_id index.
    PRIMARY KEY (user_id, grammar_point_id)
);

-- The confirmed MaruMori grammar observations and their Catalogue Matching
-- outcome (issue #6). matched_point is NULL while the observation is unmatched;
-- flagged_for_review marks the two cases the "review these" settings list shows:
-- no match at all, and a duplicate pattern resolved without MaruMori's level.
CREATE TABLE known_grammar_observations (
    user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marumori_id       text        NOT NULL,   -- the observation's MaruMori `_id`
    -- The pattern text MaruMori showed. A Grammar Point's identity is its
    -- pattern, so this is identity for matching, not item content (ADR-0002).
    pattern           text        NOT NULL DEFAULT '',
    -- MaruMori's own JLPT Level for the point, when it states one ('' when not).
    jlpt_level        text        NOT NULL DEFAULT '' CHECK (jlpt_level IN ('', 'N5', 'N4', 'N3', 'N2', 'N1')),
    matched_point     bigint      REFERENCES grammar_points(id) ON DELETE SET NULL,
    flagged_for_review boolean    NOT NULL DEFAULT false,
    observed_at       timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, marumori_id)
);
CREATE INDEX known_grammar_observations_flagged_idx ON known_grammar_observations (user_id, flagged_for_review);

-- +goose Down
DROP TABLE known_grammar_observations;
DROP TABLE known_grammar_points;
ALTER TABLE users DROP COLUMN starting_level;
