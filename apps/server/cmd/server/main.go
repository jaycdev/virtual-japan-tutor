package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/config"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/db"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/httpapi"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/refdata"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("server failed", "err", err)
		os.Exit(1)
	}
}

// run serves the API, or runs a subcommand (`create-user`).
func run(args []string) error {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		return err
	}
	// Fail fast on a bootstrap account we could never create.
	if cfg.BootstrapUsername != "" {
		if err := auth.ValidateCredentials(cfg.BootstrapUsername, cfg.BootstrapPassword); err != nil {
			return fmt.Errorf("VJT_BOOTSTRAP_USERNAME / VJT_BOOTSTRAP_PASSWORD: %w", err)
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if len(args) > 0 {
		if args[0] != "create-user" {
			return fmt.Errorf("unknown command %q (available: create-user)", args[0])
		}
		return createUserCmd(ctx, cfg, args[1:])
	}

	pool, err := db.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	svc := auth.NewService(auth.NewPostgresStore(pool), auth.Options{TTL: cfg.SessionTTL})
	box, err := secrets.NewFromKey(cfg.SecretsKey)
	if err != nil {
		return err
	}
	ai := aiprovider.NewService(aiprovider.NewPostgresStore(pool), box)

	// MaruMori Sync: the Service decrypts each learner's key per run and hands it to a
	// fresh upstream reader (ADR-0002: knowledge state only, never item content).
	refStore := refdata.NewStore(pool)
	knownGrammar := knowngrammar.NewService(knowngrammar.NewPostgresStore(pool), refStore, refdata.NormalisePattern)
	maru := marumorisync.NewService(
		marumorisync.NewPostgresStore(pool), box, refStore,
		func(baseURL, apiKey string) (marumorisync.Upstream, error) { return marumori.New(baseURL, apiKey) },
		marumorisync.WithBaseURL(cfg.MaruMoriBaseURL),
		marumorisync.WithGrammarObserver(knownGrammar),
	)
	// Mastery and the Focus Set (issue #7): read-only over the knowledge state
	// and the signals; scoring weights and rotation knobs come from config.
	focus := mastery.NewService(mastery.NewPostgresStore(pool), cfg.Mastery)

	// Practice Sessions (issue #9): exercises drawn from the Focus Set, with
	// every answer appended to the Practice Record the mastery service reads.
	practiceSvc := practice.NewService(focus, practice.NewPostgresContent(pool),
		practice.NewMemStore(cfg.PracticeSessionTTL), practice.NewPostgresResults(pool), cfg.Practice)

	// The grammar store doubles as the JMdict-backed dictionary the example
	// validator checks words against.
	grammarStore := grammar.NewPostgresStore(pool)
	grammarGen := grammar.NewGenerator(grammarStore, grammarStore, ai)

	// Migrate (then seed the first account and the default AI Provider) in the background so
	// the server (and /health) is up even while Postgres is still starting; retry until it
	// succeeds or we shut down.
	go prepareDatabase(ctx, cfg, svc, pool, ai)

	if cfg.MaruMoriSyncEnabled {
		scheduler := marumorisync.NewScheduler(maru, cfg.MaruMoriSyncInterval)
		go scheduler.Run(ctx)
		slog.Info("marumori scheduled syncs enabled", "interval", cfg.MaruMoriSyncInterval)
	}

	srv := &http.Server{
		Addr:              cfg.HTTPAddr,
		Handler:           httpapi.New(pool, svc, httpapi.WithAIProviders(ai), httpapi.WithMaruMori(maru), httpapi.WithGrammar(grammarStore, grammarGen), httpapi.WithKnownGrammar(knownGrammar), httpapi.WithFocusSet(focus), httpapi.WithPractice(practiceSvc), httpapi.WithMaxBodyBytes(cfg.MaxBodyBytes)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       cfg.ReadTimeout,
		WriteTimeout:      cfg.WriteTimeout,
		IdleTimeout:       cfg.IdleTimeout,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.HTTPAddr)
		errCh <- srv.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		slog.Info("shutting down")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}

func prepareDatabase(ctx context.Context, cfg config.Config, svc *auth.Service, pool *pgxpool.Pool, ai *aiprovider.Service) {
	if !retry(ctx, "migration", func() error { return db.Migrate(ctx, cfg.DatabaseURL) }) {
		return
	}
	slog.Info("migrations applied")

	if cfg.BootstrapUsername != "" {
		var created bool
		if !retry(ctx, "bootstrap user", func() (err error) {
			created, err = svc.Bootstrap(ctx, cfg.BootstrapUsername, cfg.BootstrapPassword)
			return err
		}) {
			return
		}
		if created {
			slog.Info("created bootstrap user", "username", cfg.BootstrapUsername)
		} else {
			slog.Info("bootstrap user skipped: users already exist")
		}
	}

	if cfg.AIDefaultBaseURL != "" {
		var seeded bool
		if !retry(ctx, "default AI provider", func() (err error) {
			seeded, err = seedAIDefault(ctx, pool, ai, cfg)
			return err
		}) {
			return
		}
		if seeded {
			slog.Info("created default AI provider from AI_DEFAULT_* and assigned it to every task", "base_url", cfg.AIDefaultBaseURL, "model", cfg.AIDefaultModel)
		} else {
			slog.Info("default AI provider skipped: needs exactly one user who has no providers yet")
		}
	}
}

// retry runs fn with backoff until it succeeds (true) or ctx is cancelled (false).
func retry(ctx context.Context, what string, fn func() error) bool {
	for delay := time.Second; ; delay = min(delay*2, 15*time.Second) {
		err := fn()
		if err == nil {
			return true
		}
		slog.Warn(what+" failed, retrying", "err", err, "in", delay)
		select {
		case <-ctx.Done():
			return false
		case <-time.After(delay):
		}
	}
}
