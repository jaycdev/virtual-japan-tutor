-- +goose Up
-- One-off maintenance jobs the server runs on startup (for example the relink
-- of stored Stories, issue #94). A row marks a job as completed, so it runs once
-- per database and never again. A failed job leaves no row and retries on the
-- next start.
CREATE TABLE maintenance_jobs (
    name         TEXT        PRIMARY KEY,
    completed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- +goose Down
DROP TABLE IF EXISTS maintenance_jobs;
