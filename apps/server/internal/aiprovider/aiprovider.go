// Package aiprovider manages AI Providers (GLOSSARY.md): the Learner's saved
// OpenAI-compatible endpoints, which one is used for which task, and how a task resolves to
// a ready-to-use llm.Client. API keys are encrypted at rest (internal/secrets) and are
// write-only: nothing in this package's public types carries a key except Resolved, which
// is for server-side callers only.
package aiprovider

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
)

// Task is a job the app delegates to an AI Provider. The set is fixed; it is also the
// AiTask enum in api/openapi.yaml (a test keeps the two in step).
type Task string

const (
	TaskStory          Task = "story"
	TaskGrammarContent Task = "grammar_content"
)

// Tasks lists every task in a stable order.
var Tasks = []Task{TaskStory, TaskGrammarContent}

// Valid reports whether t is a known task.
func (t Task) Valid() bool {
	for _, k := range Tasks {
		if k == t {
			return true
		}
	}
	return false
}

// Errors; match with errors.Is.
var (
	ErrNotFound      = errors.New("ai provider not found")
	ErrNameTaken     = errors.New("an AI provider with this name already exists")
	ErrInUse         = errors.New("ai provider is assigned to a task")
	ErrInvalidInput  = errors.New("invalid ai provider")
	ErrUnknownTask   = errors.New("unknown task")
	ErrNotAssigned   = errors.New("no AI provider is assigned to the task")
	ErrKeyUnreadable = errors.New("the stored API key cannot be decrypted (was SECRETS_KEY changed?); enter the key again")
)

// Record is a provider as stored. APIKeyEncrypted is internal/secrets ciphertext, nil when
// the provider has no key.
type Record struct {
	ID              uuid.UUID
	Name            string
	BaseURL         string
	Model           string
	APIKeyEncrypted *string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// Store persists providers and task assignments. Every method is scoped to userID; a
// Record or provider id belonging to another user is simply ErrNotFound.
type Store interface {
	// List returns the user's providers, oldest first.
	List(ctx context.Context, userID uuid.UUID) ([]Record, error)
	Get(ctx context.Context, userID, id uuid.UUID) (Record, error)
	// Create inserts r (its ID and timestamps are assigned); ErrNameTaken on a duplicate name.
	Create(ctx context.Context, userID uuid.UUID, r Record) (Record, error)
	// Update replaces name, base URL, key and model of r.ID; ErrNotFound / ErrNameTaken.
	Update(ctx context.Context, userID uuid.UUID, r Record) (Record, error)
	// Delete removes a provider; ErrInUse while a task is assigned to it.
	Delete(ctx context.Context, userID, id uuid.UUID) error
	// Assignments returns the tasks that have a provider.
	Assignments(ctx context.Context, userID uuid.UUID) (map[Task]uuid.UUID, error)
	// Assign sets (or with nil, clears) the provider for a task; ErrNotFound if the
	// provider is not the user's.
	Assign(ctx context.Context, userID uuid.UUID, task Task, providerID *uuid.UUID) error
	// CreateDefaultIfNone atomically creates r and assigns it to tasks, but only if the
	// user has no providers. It reports whether it did.
	CreateDefaultIfNone(ctx context.Context, userID uuid.UUID, r Record, tasks []Task) (bool, error)
}
