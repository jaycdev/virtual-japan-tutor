-- +goose Up
-- Item Lists, Boosting Lists and Weak Signals (issue #12). Item Lists are
-- the Learner's own named groups of Words, Kanji and Grammar Points:
-- everything saved from the reader, plus any list they make themselves. One
-- item can sit in several lists at once, so membership is its own table
-- keyed by list, kind and ref — the same ItemKey shape Mastery scores and
-- the practice engine exercises.
--
-- A Boosting List, the list's boosting flag, marks its not-yet-Known items
-- as Stretch Items: they get reserved slots in Focus Sets and a deliberate,
-- capped mastery boost on their Known score; one boost even when an item
-- belongs to several Boosting Lists, since the mastery package dedupes by
-- item.
--
-- Seeding choice: the built-in Saved list is created lazily by the item-list
-- service the first time a Learner touches lists, reads, saves or defaults,
-- so no registration step is involved. This backfill gives Learners who
-- existed before the migration the same list up front, and marks it as their
-- Default List; new Learners get it lazily and resolve their effective
-- default to it when users.default_item_list_id is NULL, a COALESCE in the
-- service. The default column is nullable ON DELETE SET NULL on purpose:
-- deleting the list that happened to be the default falls back to Saved
-- rather than dangling.
--
-- lookup_hold_ms is the reader's Weak Signal threshold: a dictionary lookup
-- held open at least this long counts as a Weak Signal. The timer runs
-- client-side, so the threshold lives here next to the other reader
-- preferences rather than in practice's Options.

CREATE TABLE item_lists (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       text        NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
    boosting   boolean     NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive unique names per Learner: an expression index, since a
-- plain UNIQUE constraint cannot wrap lower().
CREATE UNIQUE INDEX item_lists_user_name_uidx ON item_lists (user_id, lower(name));

CREATE INDEX item_lists_user_idx ON item_lists (user_id, created_at);

CREATE TABLE item_list_items (
    list_id   uuid        NOT NULL REFERENCES item_lists(id) ON DELETE CASCADE,
    item_kind text        NOT NULL CHECK (item_kind IN ('kanji','vocabulary','grammar')),
    item_ref  text        NOT NULL,
    added_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (list_id, item_kind, item_ref)
);

CREATE INDEX item_list_items_item_idx ON item_list_items (item_kind, item_ref);

ALTER TABLE users
    ADD COLUMN default_item_list_id uuid REFERENCES item_lists(id) ON DELETE SET NULL,
    ADD COLUMN lookup_hold_ms integer NOT NULL DEFAULT 800;

-- Backfill existing Learners with their Saved list, as the default.
INSERT INTO item_lists (user_id, name, boosting)
SELECT id, 'Saved', true FROM users
ON CONFLICT (user_id, lower(name)) DO NOTHING;

UPDATE users
SET default_item_list_id = (
    SELECT id FROM item_lists
    WHERE item_lists.user_id = users.id
      AND lower(item_lists.name) = 'saved'
);
