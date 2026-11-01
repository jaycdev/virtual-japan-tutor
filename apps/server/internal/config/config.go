// Package config reads server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"time"
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
}

// Load builds a Config using getenv (typically os.Getenv).
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		HTTPAddr:    getenv("HTTP_ADDR"),
		DatabaseURL: getenv("DATABASE_URL"),
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
