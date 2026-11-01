-- +goose Up
-- AI Providers: saved OpenAI-compatible endpoints (see GLOSSARY.md). Every table is
-- user-scoped (README "Data conventions").
CREATE TABLE ai_providers (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           uuid NOT NULL REFERENCES users(id),
    name              text NOT NULL,
    base_url          text NOT NULL,
    -- internal/secrets ciphertext ("v1:..."); NULL for keyless endpoints (e.g. local Ollama).
    api_key_encrypted text,
    model             text NOT NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now(),
    -- Target of the composite FK below: an assignment can only point at the same user's provider.
    UNIQUE (user_id, id)
);

-- Names are unique per user, case-insensitively.
CREATE UNIQUE INDEX ai_providers_user_name_key ON ai_providers (user_id, lower(name));

-- Which provider a user has chosen for each task. The set of tasks is fixed in code
-- (internal/aiprovider.Tasks and the AiTask enum in api/openapi.yaml), not here, so adding
-- a task needs no migration.
CREATE TABLE ai_task_assignments (
    user_id     uuid NOT NULL REFERENCES users(id),
    task        text NOT NULL,
    provider_id uuid NOT NULL,
    PRIMARY KEY (user_id, task),
    -- RESTRICT (the default): a provider that is still assigned cannot be deleted.
    FOREIGN KEY (user_id, provider_id) REFERENCES ai_providers (user_id, id)
);

-- +goose Down
DROP TABLE ai_task_assignments;
DROP TABLE ai_providers;
