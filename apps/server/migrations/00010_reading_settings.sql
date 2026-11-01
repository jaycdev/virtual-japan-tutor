-- +goose Up
-- Reading settings for the story reader (issue #11). The Blur Translation
-- preference joins the other per-user reading columns next to the Furigana
-- Threshold: the Reading Panel starts with sentence translations blurred, and
-- this column remembers whether the Learner wants them that way. A plain
-- column on users, not the JSON blob story settings use: one boolean with no
-- sub-fields of its own, read on every story view.
ALTER TABLE users
    ADD COLUMN blur_translation BOOLEAN NOT NULL DEFAULT TRUE;

-- +goose Down
ALTER TABLE users DROP COLUMN blur_translation;
