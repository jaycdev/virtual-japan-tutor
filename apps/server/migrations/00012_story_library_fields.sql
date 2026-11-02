-- +goose Up
-- Story Library fields (#31): every Story carries a Title (with the English
-- translation the reader shows blurred), the Theme it was written on, its
-- Origin (automatic vs on-demand), and the Read mark recording when the user
-- finished it. Everything except origin stays nullable: backfilled values are
-- honest placeholders, not invented data.
ALTER TABLE stories
  ADD COLUMN title TEXT,
  ADD COLUMN title_en TEXT,
  ADD COLUMN theme TEXT,
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'automatic'
    CHECK (origin IN ('automatic', 'on_demand')),
  ADD COLUMN read_at TIMESTAMPTZ;

-- Backfill existing Stories without any model calls: a shortened first
-- sentence (cut at 。？！, else capped to 40 characters — the same rule as
-- fallbackTitle in the story package). left()/strpos work in characters,
-- which is what the cap means.
UPDATE stories
SET title = CASE
  WHEN strpos(left(text, 40), '。') > 0
    THEN left(text, strpos(left(text, 40), '。') - 1)
  WHEN strpos(left(text, 40), '？') > 0
    THEN left(text, strpos(left(text, 40), '？') - 1)
  WHEN strpos(left(text, 40), '！') > 0
    THEN left(text, strpos(left(text, 40), '！') - 1)
  ELSE left(text, 40)
END
WHERE title IS NULL;

-- Stories already read (practiced_at) or no longer on deck (ready_at) are
-- Read; whatever is sitting ready for its first read stays unread.
UPDATE stories
SET read_at = COALESCE(practiced_at, created_at)
WHERE read_at IS NULL
  AND ready_at IS NULL;

-- +goose Down
ALTER TABLE stories
  DROP COLUMN read_at,
  DROP COLUMN origin,
  DROP COLUMN theme,
  DROP COLUMN title_en,
  DROP COLUMN title;
