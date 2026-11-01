// Package config reads server configuration from environment variables.
package config

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/llm"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumori"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/secrets"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
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
	// MaxBodyBytes caps every request body (env HTTP_MAX_BODY_BYTES, default 1 MiB).
	MaxBodyBytes int64
	// SecretsKey is the 32-byte key for encrypting stored secrets (env SECRETS_KEY, base64, required).
	SecretsKey []byte
	// SessionTTL is how long a login session lasts (env SESSION_TTL, default 720h = 30 days).
	SessionTTL time.Duration
	// BootstrapUsername and BootstrapPassword (env VJT_BOOTSTRAP_USERNAME / VJT_BOOTSTRAP_PASSWORD)
	// create the first account on boot, only while there are no users. Both or neither.
	BootstrapUsername string
	BootstrapPassword string
	// AIDefault* (env AI_DEFAULT_BASE_URL / AI_DEFAULT_MODEL / AI_DEFAULT_API_KEY) describe an
	// optional "Default" AI Provider, created on boot for the only user while they have none.
	// Base URL and model go together; the key is optional (keyless local endpoints).
	// AIDefaultBaseURL is already normalised.
	AIDefaultBaseURL string
	AIDefaultModel   string
	AIDefaultAPIKey  string
	// MaruMoriBaseURL is the MaruMori API base URL (env MARUMORI_API_BASE_URL, default
	// the public API). Normalised: no trailing slash. Point it at a stand-in in tests.
	MaruMoriBaseURL string
	// MaruMoriSyncInterval is how often scheduled Syncs run (env MARUMORI_SYNC_INTERVAL,
	// default 4h). Jittered per sweep by the scheduler.
	MaruMoriSyncInterval time.Duration
	// MaruMoriSyncEnabled gates scheduled Syncs (env MARUMORI_SYNC_ENABLED, default true).
	// Manual Syncs from Settings work regardless.
	MaruMoriSyncEnabled bool
	// Mastery holds the Mastery scoring weights and Focus Set rotation knobs
	// (env MASTERY_* and FOCUS_SET_*, see loadMastery for names and bounds).
	Mastery mastery.Options
	// Practice holds Practice Session size (env PRACTICE_SESSION_SIZE; see
	// loadPractice).
	Practice practice.Options
	// PracticeSessionTTL is how long a Practice Session stays resumable after
	// it starts (env PRACTICE_SESSION_TTL); it configures the session store,
	// not the practice service itself.
	PracticeSessionTTL time.Duration
	// Story holds the story generation gate bounds and prompt budget
	// (env STORY_*, see loadStory; issue #10).
	Story story.Settings
	// StoryInterval is how often the background generator sweeps users
	// (env STORY_SCHEDULER_INTERVAL, default 15m).
	StoryInterval time.Duration
	// StoryEnabled gates the background generator (env STORY_ENABLED,
	// default true). The /stories routes work regardless; with the
	// scheduler off, stories only appear when something else calls
	// EnsureReady.
	StoryEnabled bool
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
	if cfg.MaxBodyBytes, err = positiveInt(getenv, "HTTP_MAX_BODY_BYTES", 1<<20); err != nil {
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
	if err := loadAIDefault(getenv, &cfg); err != nil {
		return Config{}, err
	}
	if err := loadMaruMori(getenv, &cfg); err != nil {
		return Config{}, err
	}
	if err := loadMastery(getenv, &cfg); err != nil {
		return Config{}, err
	}
	if err := loadPractice(getenv, &cfg); err != nil {
		return Config{}, err
	}
	if err := loadStory(getenv, &cfg); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

// loadAIDefault validates the AI_DEFAULT_* trio. Errors never include the key.
func loadAIDefault(getenv func(string) string, cfg *Config) error {
	base := strings.TrimSpace(getenv("AI_DEFAULT_BASE_URL"))
	model := strings.TrimSpace(getenv("AI_DEFAULT_MODEL"))
	key := strings.TrimSpace(getenv("AI_DEFAULT_API_KEY"))
	if base == "" && model == "" && key == "" {
		return nil
	}
	if base == "" || model == "" {
		return errors.New("AI_DEFAULT_BASE_URL and AI_DEFAULT_MODEL must be set together (AI_DEFAULT_API_KEY is optional)")
	}
	norm, err := llm.NormalizeBaseURL(base)
	if err != nil {
		return fmt.Errorf("AI_DEFAULT_BASE_URL: %w", err)
	}
	cfg.AIDefaultBaseURL, cfg.AIDefaultModel, cfg.AIDefaultAPIKey = norm, model, key
	return nil
}

// loadMaruMori validates the MARUMORI_* settings.
func loadMaruMori(getenv func(string) string, cfg *Config) error {
	base, err := marumori.NormalizeBaseURL(getenv("MARUMORI_API_BASE_URL"))
	if err != nil {
		return fmt.Errorf("MARUMORI_API_BASE_URL: %w", err)
	}
	cfg.MaruMoriBaseURL = base
	if cfg.MaruMoriSyncInterval, err = duration(getenv, "MARUMORI_SYNC_INTERVAL", 4*time.Hour); err != nil {
		return err
	}
	enabled := getenv("MARUMORI_SYNC_ENABLED")
	if enabled == "" {
		cfg.MaruMoriSyncEnabled = true
		return nil
	}
	cfg.MaruMoriSyncEnabled, err = strconv.ParseBool(enabled)
	if err != nil {
		return fmt.Errorf("MARUMORI_SYNC_ENABLED: %w", err)
	}
	return nil
}

// loadMastery validates the MASTERY_* and FOCUS_SET_* settings (issue #7).
// Defaults come from mastery's own constants, so the scoring defaults live in
// one place.
func loadMastery(getenv func(string) string, cfg *Config) error {
	def := mastery.DefaultOptions()
	opts := mastery.DefaultOptions()

	var err error
	if opts.Weights.SRS, err = unitFloat(getenv, "MASTERY_WEIGHT_SRS", def.Weights.SRS); err != nil {
		return err
	}
	if opts.Weights.Practice, err = unitFloat(getenv, "MASTERY_WEIGHT_PRACTICE", def.Weights.Practice); err != nil {
		return err
	}
	if opts.Weights.Trend, err = unitFloat(getenv, "MASTERY_WEIGHT_TREND", def.Weights.Trend); err != nil {
		return err
	}
	if opts.Weights.WeakSignals, err = unitFloat(getenv, "MASTERY_WEIGHT_WEAK_SIGNALS", def.Weights.WeakSignals); err != nil {
		return err
	}
	// The positive-evidence weights must keep at least one component live:
	// all three at zero would score every Known Item at NoEvidenceMastery no
	// matter what the Learner does.
	if opts.Weights.SRS+opts.Weights.Practice+opts.Weights.Trend <= 0 {
		return fmt.Errorf("MASTERY_WEIGHT_SRS, MASTERY_WEIGHT_PRACTICE and MASTERY_WEIGHT_TREND must not all be zero")
	}
	// A zero penalty would be rewritten to the default by withDefaults, so
	// the config layer refuses it: what you set is what the scorer uses.
	opts.TrendDropPenalty, err = unitFloat(getenv, "MASTERY_TREND_DROP_PENALTY", def.TrendDropPenalty)
	if err != nil {
		return err
	}
	if opts.TrendDropPenalty <= 0 {
		return fmt.Errorf("MASTERY_TREND_DROP_PENALTY must be in (0, 1], got 0")
	}
	if opts.PracticeHalfLife, err = duration(getenv, "MASTERY_PRACTICE_HALF_LIFE", def.PracticeHalfLife); err != nil {
		return err
	}
	if opts.WeakSignalHalfLife, err = duration(getenv, "MASTERY_WEAK_SIGNAL_HALF_LIFE", def.WeakSignalHalfLife); err != nil {
		return err
	}

	if opts.SetSize, err = boundedInt(getenv, "FOCUS_SET_SIZE", def.SetSize, 15, 20); err != nil {
		return err
	}
	// The per-kind cap only makes sense inside the set's capacity.
	if opts.MaxPerKind, err = boundedInt(getenv, "FOCUS_SET_MAX_PER_KIND", def.MaxPerKind, 1, opts.SetSize); err != nil {
		return err
	}
	if opts.GraduateStreak, err = boundedInt(getenv, "FOCUS_SET_GRADUATE_STREAK", def.GraduateStreak, 1, 100); err != nil {
		return err
	}
	if opts.GraduateMinDays, err = boundedInt(getenv, "FOCUS_SET_GRADUATE_MIN_DAYS", def.GraduateMinDays, 1, 365); err != nil {
		return err
	}
	if opts.NewGrammarWindow, err = duration(getenv, "FOCUS_SET_NEW_GRAMMAR_WINDOW", def.NewGrammarWindow); err != nil {
		return err
	}

	cfg.Mastery = opts
	return nil
}

// loadPractice validates the PRACTICE_* settings (issue #9). Defaults come
// from practice's own constants, so the session defaults live in one place.
func loadPractice(getenv func(string) string, cfg *Config) error {
	var err error
	// The issue asks for "around 20 exercises"; the bounds keep a mistake
	// from turning a session into a marathon or a single question.
	if cfg.Practice.SessionSize, err = boundedInt(getenv, "PRACTICE_SESSION_SIZE", practice.DefaultSessionSize, 5, 50); err != nil {
		return err
	}
	if cfg.PracticeSessionTTL, err = duration(getenv, "PRACTICE_SESSION_TTL", practice.DefaultSessionTTL); err != nil {
		return err
	}
	return nil
}

// loadStory validates the STORY_* settings (issue #10). Defaults come from
// story's own constants, so the gate's defaults live in one place.
func loadStory(getenv func(string) string, cfg *Config) error {
	var err error
	// Known-word coverage and the Focus Set fraction are fractions of the
	// gate's counts; the issue fixes their defaults (0.95 and ~0.5).
	if cfg.Story.MinCoverage, err = unitFloat(getenv, "STORY_MIN_COVERAGE", story.DefaultCoverage); err != nil {
		return err
	}
	if cfg.Story.MinFocusFraction, err = unitFloat(getenv, "STORY_MIN_FOCUS_FRACTION", story.DefaultFocusFraction); err != nil {
		return err
	}
	// Attempts include the first: the gate's feedback drives at most two
	// retries, and the bound keeps a misconfiguration from looping forever.
	if cfg.Story.MaxAttempts, err = boundedInt(getenv, "STORY_MAX_ATTEMPTS", story.DefaultMaxAttempts, 1, 10); err != nil {
		return err
	}
	if cfg.Story.PromptKnownLimit, err = boundedInt(getenv, "STORY_PROMPT_KNOWN_LIMIT", story.DefaultPromptKnownLimit, 10, 5000); err != nil {
		return err
	}
	// Failure backoff: while a user's newest Story is a gate failure younger
	// than this, regeneration passes skip them (issue #10 review: a stuck
	// provider costs one generation per window, not one per interval). "0"
	// disables the backoff.
	if getenv("STORY_RETRY_COOLDOWN") == "0" {
		cfg.Story.RetryCooldown = 0
	} else if cfg.Story.RetryCooldown, err = duration(getenv, "STORY_RETRY_COOLDOWN", story.DefaultRetryCooldown); err != nil {
		return err
	}
	if cfg.StoryInterval, err = duration(getenv, "STORY_SCHEDULER_INTERVAL", 15*time.Minute); err != nil {
		return err
	}
	enabled := getenv("STORY_ENABLED")
	if enabled == "" {
		cfg.StoryEnabled = true
		return nil
	}
	cfg.StoryEnabled, err = strconv.ParseBool(enabled)
	if err != nil {
		return fmt.Errorf("STORY_ENABLED: %w", err)
	}
	return nil
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

// positiveInt parses a positive integer from key, or returns def if unset.
func positiveInt(getenv func(string) string, key string, def int64) (int64, error) {
	v := getenv(key)
	if v == "" {
		return def, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	if n <= 0 {
		return 0, fmt.Errorf("%s must be positive, got %q", key, v)
	}
	return n, nil
}

// unitFloat parses a fraction in [0,1] from key, or returns def if unset.
func unitFloat(getenv func(string) string, key string, def float64) (float64, error) {
	v := getenv(key)
	if v == "" {
		return def, nil
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	if !(f >= 0 && f <= 1) { // rejects NaN too: every comparison against NaN is false
		return 0, fmt.Errorf("%s must be between 0 and 1, got %q", key, v)
	}
	return f, nil
}

// boundedInt parses an integer in [min, max] from key, or returns def if unset.
func boundedInt(getenv func(string) string, key string, def, min, max int) (int, error) {
	v := getenv(key)
	if v == "" {
		return def, nil
	}
	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("%s: %w", key, err)
	}
	if n < int64(min) || n > int64(max) {
		return 0, fmt.Errorf("%s must be between %d and %d, got %q", key, min, max, v)
	}
	return int(n), nil
}
