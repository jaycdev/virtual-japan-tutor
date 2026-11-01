// Package config reads server configuration from environment variables.
package config

import "errors"

type Config struct {
	// HTTPAddr is the listen address (env HTTP_ADDR, default ":8080").
	HTTPAddr string
	// DatabaseURL is the Postgres connection string (env DATABASE_URL, required).
	DatabaseURL string
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
	return cfg, nil
}
