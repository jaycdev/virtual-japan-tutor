-- +goose Up
-- Practice Record and Weak Signals (issue #7, docs/adr/0004): the two in-app signals
-- Mastery combines with SRS Level. This migration lays the read side the Mastery and
-- Focus Set feature needs; the write sides arrive with their features — Practice
-- Sessions (issue #9) append practice_records, reading behaviour (issue #12) appends
-- weak_signals. Nothing here schedules reviews: MaruMori stays the Learner's SRS.
--
-- Items are addressed the way the Focus Set names them: kind plus a stable text ref —
-- the JMdict ent_seq for linked vocabulary, the literal for linked kanji, the MaruMori
-- id for items with no reference-data link yet, and the Grammar Catalogue point id for
-- grammar. A weak_signals.signal is free text ('lookup', 'translation_unblur',
-- 'boosting_list', ...); their weights live in server config, not per row.

CREATE TABLE practice_records (
    id          bigserial PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_kind   text NOT NULL CHECK (item_kind IN ('kanji', 'vocabulary', 'grammar')),
    item_ref    text NOT NULL,
    correct     boolean NOT NULL,
    answered_at timestamptz NOT NULL
);

CREATE INDEX practice_records_user_item_idx
    ON practice_records (user_id, item_kind, item_ref, answered_at DESC);

CREATE TABLE weak_signals (
    id          bigserial PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_kind   text NOT NULL CHECK (item_kind IN ('kanji', 'vocabulary', 'grammar')),
    item_ref    text NOT NULL,
    signal      text NOT NULL,
    occurred_at timestamptz NOT NULL
);

CREATE INDEX weak_signals_user_item_idx
    ON weak_signals (user_id, item_kind, item_ref, occurred_at DESC);

-- +goose Down
DROP TABLE weak_signals;
DROP TABLE practice_records;
