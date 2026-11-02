-- +goose Up
-- Issue #33: on-demand Stories with a progress bar that fills at the
-- Learner's own pace. One sample row per successful generation: the writing
-- stage's expected window is the average of the Learner's recent durations.
-- Append-only, like practice_records; the read takes the newest few.
CREATE TABLE story_generation_durations (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    finished_at TIMESTAMPTZ NOT NULL,
    duration_ms BIGINT      NOT NULL CHECK (duration_ms >= 0)
);

CREATE INDEX story_generation_durations_user_idx
    ON story_generation_durations (user_id, finished_at DESC);

-- +goose Down
DROP INDEX IF EXISTS story_generation_durations_user_idx;
DROP TABLE IF EXISTS story_generation_durations;
