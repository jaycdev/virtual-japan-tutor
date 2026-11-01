package config_test

import (
	"strings"
	"testing"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/config"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
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

func TestLoadAIDefaultIsOptionalAndNormalised(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil || cfg.AIDefaultBaseURL != "" || cfg.AIDefaultModel != "" || cfg.AIDefaultAPIKey != "" {
		t.Fatalf("unset: %+v, %v", cfg, err)
	}
	cfg, err = config.Load(env(map[string]string{
		"DATABASE_URL":        "postgres://x",
		"AI_DEFAULT_BASE_URL": "http://ollama.lan:11434/",
		"AI_DEFAULT_MODEL":    " llama3 ",
	}))
	if err != nil || cfg.AIDefaultBaseURL != "http://ollama.lan:11434/v1" || cfg.AIDefaultModel != "llama3" || cfg.AIDefaultAPIKey != "" {
		t.Fatalf("keyless: %+v, %v", cfg, err)
	}
	cfg, err = config.Load(env(map[string]string{
		"DATABASE_URL": "postgres://x", "AI_DEFAULT_BASE_URL": "https://api.openai.com/v1", "AI_DEFAULT_MODEL": "m", "AI_DEFAULT_API_KEY": "sk-1",
	}))
	if err != nil || cfg.AIDefaultAPIKey != "sk-1" {
		t.Fatalf("with key: %+v, %v", cfg, err)
	}
}

func TestLoadRejectsHalfConfiguredAIDefault(t *testing.T) {
	cases := map[string]map[string]string{
		"url without model": {"AI_DEFAULT_BASE_URL": "https://x/v1"},
		"model without url": {"AI_DEFAULT_MODEL": "m"},
		"key alone":         {"AI_DEFAULT_API_KEY": "sk-secret-1"},
		"bad url":           {"AI_DEFAULT_BASE_URL": "ftp://x", "AI_DEFAULT_MODEL": "m"},
	}
	for name, extra := range cases {
		t.Run(name, func(t *testing.T) {
			extra["DATABASE_URL"] = "postgres://x"
			_, err := config.Load(env(extra))
			if err == nil || !strings.Contains(err.Error(), "AI_DEFAULT_") {
				t.Fatalf("err = %v, want an AI_DEFAULT_* error", err)
			}
			if strings.Contains(err.Error(), "sk-secret-1") {
				t.Fatalf("error leaks the key: %v", err)
			}
		})
	}
}

func TestLoadMaxBodyBytes(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil || cfg.MaxBodyBytes != 1<<20 {
		t.Fatalf("default = %d, %v; want 1 MiB", cfg.MaxBodyBytes, err)
	}
	cfg, err = config.Load(env(map[string]string{"DATABASE_URL": "postgres://x", "HTTP_MAX_BODY_BYTES": "4096"}))
	if err != nil || cfg.MaxBodyBytes != 4096 {
		t.Fatalf("override = %d, %v", cfg.MaxBodyBytes, err)
	}
	for _, bad := range []string{"0", "-1", "lots"} {
		if _, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x", "HTTP_MAX_BODY_BYTES": bad})); err == nil {
			t.Errorf("HTTP_MAX_BODY_BYTES=%q: expected error", bad)
		}
	}
}

func TestLoadMaruMoriDefaults(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{"DATABASE_URL": "postgres://x"}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MaruMoriBaseURL != marumori.KnownDefaultBaseURL {
		t.Errorf("MaruMoriBaseURL = %q, want %q", cfg.MaruMoriBaseURL, marumori.KnownDefaultBaseURL)
	}
	if cfg.MaruMoriSyncInterval != 4*time.Hour {
		t.Errorf("MaruMoriSyncInterval = %v, want 4h", cfg.MaruMoriSyncInterval)
	}
	if !cfg.MaruMoriSyncEnabled {
		t.Error("MaruMoriSyncEnabled = false, want true by default")
	}
}

func TestLoadMaruMoriOverrides(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{
		"DATABASE_URL":           "postgres://x",
		"MARUMORI_API_BASE_URL":  "http://marumori.test:3000/api/",
		"MARUMORI_SYNC_INTERVAL": "15m",
		"MARUMORI_SYNC_ENABLED":  "false",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MaruMoriBaseURL != "http://marumori.test:3000/api" { // normalised: no trailing slash
		t.Errorf("MaruMoriBaseURL = %q", cfg.MaruMoriBaseURL)
	}
	if cfg.MaruMoriSyncInterval != 15*time.Minute {
		t.Errorf("MaruMoriSyncInterval = %v, want 15m", cfg.MaruMoriSyncInterval)
	}
	if cfg.MaruMoriSyncEnabled {
		t.Error("MARUMORI_SYNC_ENABLED=false must disable scheduled Syncs")
	}
}

func TestLoadRejectsBadMaruMoriConfig(t *testing.T) {
	cases := map[string]map[string]string{
		"bad url":           {"MARUMORI_API_BASE_URL": "ftp://marumori"},
		"zero interval":     {"MARUMORI_SYNC_INTERVAL": "0s"},
		"negative interval": {"MARUMORI_SYNC_INTERVAL": "-5m"},
		"garbage interval":  {"MARUMORI_SYNC_INTERVAL": "often"},
		"garbage enabled":   {"MARUMORI_SYNC_ENABLED": "maybe"},
	}
	for name, extra := range cases {
		t.Run(name, func(t *testing.T) {
			extra["DATABASE_URL"] = "postgres://x"
			_, err := config.Load(env(extra))
			if err == nil || !strings.Contains(err.Error(), "MARUMORI_") {
				t.Fatalf("err = %v, want a MARUMORI_* error", err)
			}
		})
	}
}
