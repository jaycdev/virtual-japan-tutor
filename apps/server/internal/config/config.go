// Package config reads server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
)

type Config struct {
	// HTTPAddr is the listen address (env HTTP_ADDR, default ":8080").
	HTTPAddr string
	// DatabaseURL is the Postgres connection string (env DATABASE_URL, required).
	DatabaseURL string
	// ReadTimeout bounds reading an entire request (env HTTP_READ_TIMEOUT, default 15s).
	ReadTimeout time.Duration
	// WriteTimeout bounds writing a response (env HTTP_WRITE_TIMEOUT, default 30s).
	WriteTimeout time.Duration
	// IdleTimeout bounds keep-alive idle connections (env HTTP_IDLE_TIMEOUT, default 60s).
	IdleTimeout time.Duration
	// SecretsKey is the 32-byte key for encrypting stored secrets (env SECRETS_KEY, base64, required).
	SecretsKey []byte
	// SessionTTL is how long a login session lasts (env SESSION_TTL, default 720h = 30 days).
	SessionTTL time.Duration
	// BootstrapUsername and BootstrapPassword (env VJT_BOOTSTRAP_USERNAME / VJT_BOOTSTRAP_PASSWORD)
	// create the first account on boot, only while there are no users. Both or neither.
	BootstrapUsername string
	BootstrapPassword string
}

// Load builds a Config using getenv (typically os.Getenv).
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		HTTPAddr:    getenv("HTTP_ADDR"),
		DatabaseURL: getenv("DATABASE_URL"),

		BootstrapUsername: getenv("VJT_BOOTSTRAP_USERNAME"),
		BootstrapPassword: getenv("VJT_BOOTSTRAP_PASSWORD"),
	}
	if cfg.HTTPAddr == "" {
		cfg.HTTPAddr = ":8080"
	}
	if cfg.DatabaseURL == "" {
		return Config{}, errors.New("DATABASE_URL is required")
	}

	var err error
	if cfg.ReadTimeout, err = duration(getenv, "HTTP_READ_TIMEOUT", 15*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.WriteTimeout, err = duration(getenv, "HTTP_WRITE_TIMEOUT", 30*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.IdleTimeout, err = duration(getenv, "HTTP_IDLE_TIMEOUT", 60*time.Second); err != nil {
		return Config{}, err
	}
	if cfg.SessionTTL, err = duration(getenv, "SESSION_TTL", 30*24*time.Hour); err != nil {
		return Config{}, err
	}
	if cfg.SecretsKey, err = secrets.ParseKey(getenv(secrets.KeyEnv)); err != nil {
		return Config{}, err
	}
	if (cfg.BootstrapUsername == "") != (cfg.BootstrapPassword == "") {
		return Config{}, errors.New("VJT_BOOTSTRAP_USERNAME and VJT_BOOTSTRAP_PASSWORD must be set together")
	}
	return cfg, nil
}

// duration parses a positive Go duration (e.g. "15s") from key, or returns def if unset.
func duration(getenv func(string) string, key string, def time.Duration) (time.Duration, error) {
	v := getenv(key)
	if v == "" {
		return def, nil
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	if d <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %q", key, v)
	}
	return d, nil
}
