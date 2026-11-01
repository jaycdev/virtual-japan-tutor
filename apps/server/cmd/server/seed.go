package main

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/config"
)

// seedAIDefault creates the env-configured "Default" AI Provider (AI_DEFAULT_*) for the
// only user and assigns it to every task. It does nothing unless exactly one user exists
// and that user has no providers, so it is safe on every boot. It reports whether it
// created the provider.
func seedAIDefault(ctx context.Context, pool *pgxpool.Pool, ai *aiprovider.Service, cfg config.Config) (bool, error) {
	if cfg.AIDefaultBaseURL == "" {
		return false, nil
	}
	uid, ok, err := aiprovider.SoleUserID(ctx, pool)
	if err != nil || !ok {
		return false, err
	}
	return ai.SeedDefault(ctx, uid, aiprovider.DefaultConfig{
		BaseURL: cfg.AIDefaultBaseURL, APIKey: cfg.AIDefaultAPIKey, Model: cfg.AIDefaultModel,
	})
}
