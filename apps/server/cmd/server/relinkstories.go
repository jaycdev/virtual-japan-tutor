package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/config"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/db"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
)

// relinkJob names the relink of stored Stories in maintenance_jobs. Once its row
// exists the startup hook skips it, so the relink does not re-tokenise every
// Story on each boot.
const relinkJob = "relink-stories-94"

// relinkOnce runs the relink on startup unless it already completed. It reports
// whether it ran. A run that fails or is cancelled records nothing, so the next
// start retries it. The relink only fills missing links, so a retry is safe.
func relinkOnce(ctx context.Context, pool *pgxpool.Pool) (story.RelinkReport, bool, error) {
	var done bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM maintenance_jobs WHERE name = $1)`, relinkJob).Scan(&done); err != nil {
		return story.RelinkReport{}, false, fmt.Errorf("relink marker: %w", err)
	}
	if done {
		return story.RelinkReport{}, false, nil
	}
	rep, err := story.NewRelinker(pool).Run(ctx)
	if err != nil {
		return rep, true, err
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO maintenance_jobs (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, relinkJob); err != nil {
		return rep, true, fmt.Errorf("relink marker: %w", err)
	}
	return rep, true, nil
}

// relinkStoriesCmd implements `server relink-stories`: a one-off, idempotent
// repair that gives already-stored Stories the dictionary links generation did
// not write before issue #94, so their words can be looked up. It only fills
// in missing links, so running it again is safe.
func relinkStoriesCmd(ctx context.Context, cfg config.Config, args []string) error {
	if err := parseRelinkStoriesArgs(args); err != nil {
		return err
	}
	// Safe to run before the server ever started: migrations are idempotent.
	if err := db.Migrate(ctx, cfg.DatabaseURL); err != nil {
		return err
	}
	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	rep, runErr := story.NewRelinker(pool).Run(ctx)
	// The summary prints even when a Story failed, so the failure count is
	// on the record next to the error.
	fmt.Fprintf(os.Stderr, "relinked %d tokens in %d of %d stories (%d sentences skipped, %d failed)\n",
		rep.TokensLinked, rep.StoriesChanged, rep.Stories, rep.SentencesSkipped, rep.Failed)
	return runErr
}

// parseRelinkStoriesArgs takes no flags: any argument is a usage error.
func parseRelinkStoriesArgs(args []string) error {
	if len(args) > 0 {
		return errors.New("usage: server relink-stories")
	}
	return nil
}
