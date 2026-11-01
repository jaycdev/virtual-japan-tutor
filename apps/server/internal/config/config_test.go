package config_test

import (
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/config"
)

func env(m map[string]string) func(string) string {
	return func(k string) string { return m[k] }
}

func TestLoadReadsEnvironment(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{
		"DATABASE_URL": "postgres://u:p@db:5432/vjt",
		"HTTP_ADDR":    ":9090",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseURL != "postgres://u:p@db:5432/vjt" || cfg.HTTPAddr != ":9090" {
		t.Fatalf("got %+v", cfg)
	}
}

func TestLoadDefaultsHTTPAddr(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddr != ":8080" {
		t.Fatalf("HTTPAddr = %q, want :8080", cfg.HTTPAddr)
	}
}

func TestLoadHTTPTimeoutDefaults(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ReadTimeout != 15*time.Second || cfg.WriteTimeout != 30*time.Second || cfg.IdleTimeout != 60*time.Second {
		t.Fatalf("got read=%v write=%v idle=%v", cfg.ReadTimeout, cfg.WriteTimeout, cfg.IdleTimeout)
	}
}

func TestLoadHTTPTimeoutOverrides(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{
		"DATABASE_URL":       "postgres://x",
		"HTTP_READ_TIMEOUT":  "3s",
		"HTTP_WRITE_TIMEOUT": "1m30s",
		"HTTP_IDLE_TIMEOUT":  "500ms",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ReadTimeout != 3*time.Second || cfg.WriteTimeout != 90*time.Second || cfg.IdleTimeout != 500*time.Millisecond {
		t.Fatalf("got read=%v write=%v idle=%v", cfg.ReadTimeout, cfg.WriteTimeout, cfg.IdleTimeout)
	}
}

func TestLoadRejectsInvalidTimeouts(t *testing.T) {
	for _, bad := range []string{"soon", "-5s", "0s"} {
		_, err := config.Load(env(map[string]string{
			"DATABASE_URL":      "postgres://x",
			"HTTP_READ_TIMEOUT": bad,
		}))
		if err == nil {
			t.Fatalf("expected error for HTTP_READ_TIMEOUT=%q", bad)
		}
	}
}

func TestLoadRequiresDatabaseURL(t *testing.T) {
	if _, err := config.Load(env(nil)); err == nil {
		t.Fatal("expected error when DATABASE_URL is missing")
	}
}
