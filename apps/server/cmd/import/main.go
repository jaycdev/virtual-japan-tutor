// Command import loads the reference data (JMdict, KANJIDIC2, the JLPT lists,
// Kanjium pitch accents and the Grammar Catalogue) into Postgres. It is
// repeatable: running it again on the same sources changes nothing.
//
//	import                         # everything, downloading into the cache dir
//	import --only grammar          # one dataset (repeat or comma-separate for several)
//	import --source-dir ./sources  # offline: use pre-downloaded files, no network
//
// See README.md ("Importing reference data") and THIRD_PARTY_NOTICES.md.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/db"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
)

func main() {
	if err := run(os.Args[1:], os.Getenv); err != nil {
		slog.Error("import failed", "err", err)
		os.Exit(1)
	}
}

type datasetList []refdata.Dataset

func (l *datasetList) String() string { return fmt.Sprint([]refdata.Dataset(*l)) }

func (l *datasetList) Set(v string) error {
	for _, part := range strings.Split(v, ",") {
		d, err := refdata.ParseDataset(strings.TrimSpace(part))
		if err != nil {
			return err
		}
		*l = append(*l, d)
	}
	return nil
}

func run(args []string, getenv func(string) string) error {
	fs := flag.NewFlagSet("import", flag.ContinueOnError)
	var only datasetList
	fs.Var(&only, "only", "dataset to import: jmdict, kanjidic2, waller, kanjium or grammar (repeatable, comma-separated; default all)")
	sourceDir := fs.String("source-dir", getenv("REFDATA_SOURCE_DIR"), "offline mode: directory of pre-downloaded source files laid out like the cache (env REFDATA_SOURCE_DIR)")
	cacheDir := fs.String("cache-dir", envOr(getenv, "REFDATA_CACHE_DIR", defaultCacheDir()), "where downloads are kept (env REFDATA_CACHE_DIR)")
	refresh := fs.Bool("refresh", false, "download again even if the file is cached")
	grammarCSV := fs.String("grammar-csv", envOr(getenv, "GRAMMAR_CSV", filepath.Join("data", "grammar", "jlpt-grammar.csv")), "path of the Grammar Catalogue spreadsheet (env GRAMMAR_CSV)")
	dbURL := fs.String("database-url", getenv("DATABASE_URL"), "Postgres connection string (env DATABASE_URL)")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if *dbURL == "" {
		return fmt.Errorf("DATABASE_URL (or --database-url) is required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	log := slog.Default()

	if err := waitAndMigrate(ctx, *dbURL, log); err != nil {
		return err
	}
	pool, err := db.Open(ctx, *dbURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	start := time.Now()
	report, err := refdata.Import(ctx, refdata.ImportParams{
		Pool: pool,
		Fetcher: &refdata.Fetcher{
			SourceDir: *sourceDir,
			CacheDir:  *cacheDir,
			Refresh:   *refresh,
			Log:       log,
		},
		GrammarCSV: *grammarCSV,
		Datasets:   only,
		Log:        log,
	})
	if report != nil {
		printReport(os.Stdout, report, time.Since(start))
	}
	return err
}

// waitAndMigrate applies pending migrations, retrying while Postgres starts.
func waitAndMigrate(ctx context.Context, url string, log *slog.Logger) error {
	var err error
	for delay := time.Second; ; delay = min(delay*2, 10*time.Second) {
		if err = db.Migrate(ctx, url); err == nil {
			return nil
		}
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if delay >= 10*time.Second {
			return fmt.Errorf("database not ready: %w", err)
		}
		log.Warn("database not ready, retrying", "err", err, "in", delay)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(delay):
		}
	}
}

func envOr(getenv func(string) string, key, def string) string {
	if v := getenv(key); v != "" {
		return v
	}
	return def
}

func defaultCacheDir() string {
	if dir, err := os.UserCacheDir(); err == nil {
		return filepath.Join(dir, "vjt-refdata")
	}
	return filepath.Join(os.TempDir(), "vjt-refdata")
}
