# Virtual Japan Tutor

Monorepo: a Go server that owns all domain logic ([ADR-0001](docs/adr/0001-go-server-owns-domain-logic.md)),
a Vite + React web app and an Expo (Android) app. Terminology lives in [GLOSSARY.md](GLOSSARY.md).

## Layout

| Path                  | What                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| `api/openapi.yaml`    | OpenAPI spec: the single source of truth for the HTTP API               |
| `apps/server`         | Go server (std `net/http`, pgx, goose migrations)                       |
| `apps/web`            | Vite + React + TypeScript                                               |
| `apps/mobile`         | Expo + TypeScript (Android)                                             |
| `packages/api-client` | `@vjt/api-client`: TS types + client generated from the spec            |
| `packages/core`       | `@vjt/core`: UI-agnostic hooks/state shared by web and mobile           |

## Prerequisites

Install [mise](https://mise.jdx.dev) and run `mise install` in the repo root. It provides the pinned
Go, Node and pnpm versions from `mise.toml`.

## Common commands (from the repo root)

```sh
pnpm install
pnpm build        # build every package + the Go server
pnpm test         # TS tests + go test
pnpm lint         # eslint + go vet + gofmt check
pnpm typecheck    # tsc + go vet
pnpm generate     # regenerate Go stubs and the TS client from api/openapi.yaml
```

All of these run through Turborepo; the Go commands are wrapped by `apps/server/package.json`.

Postgres-backed Go tests are skipped unless `TEST_DATABASE_URL` is set (CI sets it). Each such test gets its own throwaway schema (`internal/dbtest`), so packages can share one database.

## Regenerating from the OpenAPI spec

1. Edit `api/openapi.yaml`.
2. Run `pnpm generate`. This updates `apps/server/internal/api/api.gen.go` (oapi-codegen, strict server)
   and `packages/api-client/src/generated/schema.ts` (openapi-typescript).
3. Implement any new methods on the Go `StrictServerInterface` (`apps/server/internal/httpapi`).
4. Commit the generated files. CI re-runs generation and `pnpm check:generated` fails on any modified or untracked generated file.

## Running with Docker Compose

Docker runs on a remote VM, so compose uses no bind mounts: images are built from `apps/server`
and Postgres data lives in a named volume. Migrations are embedded in the server binary and applied on start.

```sh
cp .env.example .env                          # then set SECRETS_KEY (see Secrets) and the bootstrap account
docker --context docker-dev compose up --build
curl http://docker-dev.internal:8080/health   # {"database":"connected","status":"ok"}
docker --context docker-dev compose down -v   # tear down, including the database volume
```

Compose refuses to start without `SECRETS_KEY`. Set `VJT_BOOTSTRAP_USERNAME` / `VJT_BOOTSTRAP_PASSWORD`
to get a first account on first boot (see [Authentication](#authentication)).

Ports are published on the Docker host (`docker-dev.internal`), not on `localhost`. Optional overrides
(credentials, `SERVER_PORT`) go in a `.env` copied from `.env.example`. If your Docker CLI has no
`compose` plugin, install Docker Compose v2 (standalone `docker-compose` works too).

## Running locally

Server (needs a reachable Postgres):

```sh
cd apps/server
DATABASE_URL=postgres://user:pass@host:5432/db go run ./cmd/server
```

Web: `pnpm --filter @vjt/web dev` (set `VITE_API_URL`). Mobile: `pnpm --filter @vjt/mobile android`
(set `EXPO_PUBLIC_API_URL`; defaults to `http://10.0.2.2:8080`, the host as seen from the Android emulator).

Packages `@vjt/api-client` and `@vjt/core` are consumed from their built `dist/`, so run `pnpm build`
(or the package's `build`) after changing them.

## Authentication

Login is username + password; there is no public signup. The server hashes passwords with argon2id
(parameters are encoded in each hash) and hands out opaque random session tokens (256-bit). Only the
SHA-256 of a token is stored (`sessions` table), so a database leak does not leak live sessions. Clients
send `Authorization: Bearer <token>` (web keeps it in `localStorage`, Android in `expo-secure-store`),
and sessions last `SESSION_TTL` (default 30 days). Logout deletes the session server-side.

| Endpoint            | Auth   | Notes                                                                 |
| ------------------- | ------ | --------------------------------------------------------------------- |
| `GET /health`       | public |                                                                       |
| `POST /auth/login`  | public | `401` for unknown user *and* wrong password (same body, same cost); `429` + `Retry-After` after 5 consecutive failures per username (30 s, doubling to 15 min; in memory, resets on restart) |
| `POST /auth/logout` | token  | `204`                                                                 |
| `GET /me`           | token  | the authenticated user                                                |

**Authenticated by default.** `api/openapi.yaml` declares a global `bearerAuth` requirement; an operation
is public only with `security: []`. The Go middleware (`internal/httpapi`) is deny-by-default (it only lets
the routes in `publicRoutes` through) and a test walks the spec to fail if the two disagree. Errors are
always `{"code": "...", "message": "..."}`.

### Creating the first account

No account exists on a fresh database. Either:

- **Env seed**: set `VJT_BOOTSTRAP_USERNAME` and `VJT_BOOTSTRAP_PASSWORD` (both, password >= 10 characters).
  On boot, after migrations, the server creates that account only if there are zero users, so leaving the
  variables set is harmless, but remove the password from your `.env` once it exists.
- **CLI**: `server create-user --username NAME`. The password is read from an interactive prompt (no echo)
  or, when stdin is not a terminal, from the first line of stdin. It is never accepted as a flag. Examples:

  ```sh
  cd apps/server && DATABASE_URL=... SECRETS_KEY=... go run ./cmd/server create-user --username me
  # in compose (remote Docker): pipe the password in, do not put it on the command line
  printf "%s\n" "$PASSWORD" | docker --context docker-dev compose exec -T server server create-user --username me
  ```

## Secrets

Third-party keys (the MaruMori key, AI Provider keys) are encrypted at rest with `internal/secrets`:
AES-256-GCM, stored as `v1:` + base64(nonce || ciphertext). The version prefix lets keys or the algorithm
rotate later. The key comes from `SECRETS_KEY` (base64, exactly 32 bytes); the server fails at startup with
a clear error if it is missing or invalid. Generate a dev key with:

```sh
openssl rand -base64 32
# no openssl (Node is already required for this repo):
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Treat it like a password: losing or changing it makes stored secrets unreadable. Today the only stored
secrets are [AI Provider](#ai-providers) API keys (a connection test then says "re-enter the key").

## AI Providers

An **AI Provider** ([GLOSSARY](GLOSSARY.md)) is a saved OpenAI-compatible endpoint: name, base URL, API key
and model. The Learner manages them in the web app's **Settings** page and picks which one serves each
**task** (`story`, `grammar_content`). All routes are authenticated and user-scoped; see `api/openapi.yaml`
(`/ai-providers`, `/ai-providers/{id}/test`, `/ai-tasks`).

- **Any OpenAI-compatible endpoint**: OpenAI, OpenRouter, LiteLLM, Ollama, vLLM... The base URL is normalised
  (trailing slash removed, `/v1` added when the path is empty, a pasted `.../chat/completions` is cut back) and
  must be `http` or `https` without embedded credentials. **Private, LAN and localhost addresses are allowed
  on purpose** (this is a single-user, self-hosted tool and local endpoints are a main use case), so anyone who
  can log in can make the server call any address it can reach.
- **Keys are write-only.** They are encrypted with `SECRETS_KEY` (`v1:` ciphertext in `ai_providers.api_key_encrypted`,
  `NULL` for keyless endpoints) and never returned: responses carry only `hasApiKey`. On `PATCH`, an omitted
  `apiKey` keeps the stored key; `null` or `""` removes it; any other string replaces it. Keys and `Authorization`
  headers are never logged, and provider error text is scrubbed of the key before it is shown.
- **Tasks.** `GET /ai-tasks` lists every task with its provider (or `null`); `PUT /ai-tasks/{task}` assigns one,
  `DELETE /ai-tasks/{task}` clears it. **Deleting a provider that is assigned to a task is rejected with `409
  provider_in_use`** (reassign the task first); it is never silently un-assigned.
- **Connection test.** `POST /ai-providers/{id}/test` sends a tiny chat request and always answers `200` with
  `{ok, latencyMs, message, structuredOutput}`; a failure is `ok: false` with a readable reason (bad key, unknown
  model, wrong base URL, rate limit, timeout, unreachable, not an OpenAI-compatible API). It also probes
  structured output and reports `json_schema`, `json_object`, `prompt_only` or `unavailable`.
- **Default from the environment.** Set `AI_DEFAULT_BASE_URL` + `AI_DEFAULT_MODEL` (and optionally
  `AI_DEFAULT_API_KEY`) and, on boot, if there is exactly one user and they have no providers, a provider named
  "Default" is created and assigned to every task. It is idempotent and never touches existing providers. If you
  create the account later (e.g. with `create-user`), restart the server to seed it.
- **For later features**: `aiprovider.Service.ResolveProvider(ctx, userID, task)` returns the decrypted config and a
  ready `llm.Client` (or `ErrNotAssigned`). `internal/llm` is a transport-only client: chat completions with
  a timeout per attempt, retries with exponential backoff and jitter on 429/5xx/network errors (honouring
  `Retry-After`, no retry on auth/validation errors), typed errors, and `ChatJSON`, which asks for `json_schema`
  structured output and falls back to `json_object`, then to prompt-only JSON extraction, per call (nothing is
  remembered per provider). Its tests use `httptest` fakes; it has not been exercised against a real provider.

## Data conventions

- Every domain table carries `user_id uuid NOT NULL REFERENCES users(id)` (`users`/`user_id` is the technical
  identity behind a Learner in the [GLOSSARY](GLOSSARY.md)). Index it with the queries you expect.
- The user id comes **only** from the request context: `auth.UserID(ctx)` (`internal/auth`). Never take it
  from request input, and filter every statement on it (`WHERE user_id = $1`). With no authenticated identity
  in the context there is no id, hence no query. `noteRepo` in `internal/auth/scoping_test.go` is the
  reference pattern, with a test that one user cannot read another's rows.
- Auth is checked in middleware before handlers run, so handlers can rely on the identity being present.

## Environment

See `.env.example` for every variable. Never commit a real `.env`.
