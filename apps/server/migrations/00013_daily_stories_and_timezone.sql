-- +goose Up
-- Issue #32: Automatic Stories once a day and Today's Story.
--
-- The Learner's Timezone (GLOSSARY.md) decides which local day an Automatic
-- Story belongs to. '' means unset: the server's own timezone is used until
-- the Learner chooses one (the IANA name is validated in the API layer).
ALTER TABLE story_user_state
    ADD COLUMN timezone TEXT NOT NULL DEFAULT '';

-- The ready flow is gone: a Story is Today's Story by being the newest
-- Automatic Story, so nothing marks one as "ready to open", and nothing
-- remembers the Focus Set a story was generated against — the daily rule,
-- not a significance comparison, decides when the next story is written.
DROP INDEX IF EXISTS stories_one_ready_idx;
ALTER TABLE stories DROP COLUMN IF EXISTS ready_at;
ALTER TABLE story_user_state DROP COLUMN IF EXISTS focus_snapshot;

-- +goose Down
ALTER TABLE stories ADD COLUMN ready_at TIMESTAMPTZ;
CREATE UNIQUE INDEX stories_one_ready_idx ON stories (user_id) WHERE ready_at IS NOT NULL;
ALTER TABLE story_user_state ADD COLUMN focus_snapshot TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE story_user_state DROP COLUMN timezone;
