package config_test

import (
	"strings"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/config"
)

const testKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" // 32 zero bytes, base64

// env returns a getenv over m, plus a valid SECRETS_KEY unless m sets its own.
func env(m map[string]string) func(string) string {
	return func(k string) string {
		if v, ok := m[k]; ok {
			return v
		}
		if k == "SECRETS_KEY" {
			return testKey
		}
		return ""
	}
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

func TestLoadRequiresAValidSecretsKey(t *testing.T) {
	for name, key := range map[string]string{
		"missing":    "",
		"not base64": "%%%",
		"too short":  "c2hvcnQ=",
	} {
		_, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x", "SECRETS_KEY": key}))
		if err == nil {
			t.Errorf("%s: expected error", name)
			continue
		}
		if !strings.Contains(err.Error(), "SECRETS_KEY") {
			t.Errorf("%s: error %q does not name SECRETS_KEY", name, err)
		}
	}
}

func TestLoadDecodesTheSecretsKey(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.SecretsKey) != 32 {
		t.Fatalf("SecretsKey has %d bytes, want 32", len(cfg.SecretsKey))
	}
}

func TestLoadSessionTTL(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SessionTTL != 30*24*time.Hour {
		t.Fatalf("default SessionTTL = %v, want 720h", cfg.SessionTTL)
	}
	cfg, err = config.Load(env(map[string]string{"DATABASE_URL": "postgres://x", "SESSION_TTL": "12h"}))
	if err != nil || cfg.SessionTTL != 12*time.Hour {
		t.Fatalf("SessionTTL = %v, %v; want 12h", cfg.SessionTTL, err)
	}
	if _, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x", "SESSION_TTL": "0s"})); err == nil {
		t.Fatal("expected error for SESSION_TTL=0s")
	}
}

func TestLoadBootstrapCredentialsComeAsAPair(t *testing.T) {
	base := map[string]string{"DATABASE_URL": "postgres://x"}
	with := func(kv ...string) func(string) string {
		m := map[string]string{}
		for k, v := range base {
			m[k] = v
		}
		for i := 0; i < len(kv); i += 2 {
			m[kv[i]] = kv[i+1]
		}
		return env(m)
	}

	cfg, err := config.Load(with("VJT_BOOTSTRAP_USERNAME", "owner", "VJT_BOOTSTRAP_PASSWORD", "a-long-password"))
	if err != nil || cfg.BootstrapUsername != "owner" || cfg.BootstrapPassword != "a-long-password" {
		t.Fatalf("pair: %+v, %v", cfg, err)
	}
	cfg, err = config.Load(with())
	if err != nil || cfg.BootstrapUsername != "" || cfg.BootstrapPassword != "" {
		t.Fatalf("neither: %+v, %v", cfg, err)
	}
	for _, only := range [][]string{{"VJT_BOOTSTRAP_USERNAME", "owner"}, {"VJT_BOOTSTRAP_PASSWORD", "a-long-password"}} {
		if _, err := config.Load(with(only...)); err == nil {
			t.Errorf("only %s set: expected error", only[0])
		}
	}
}