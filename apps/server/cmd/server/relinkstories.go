package main

import (
	"context"
	"errors"
	"fmt"
	"os"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/config"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/db"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
)

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
