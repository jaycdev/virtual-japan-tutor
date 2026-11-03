# Virtual Japan Tutor

Monorepo: a Go server that owns all domain logic ([ADR-0001](docs/adr/0001-go-server-owns-domain-logic.md)),
a Vite + React web app and an Expo (Android) app. Terminology lives in [GLOSSARY.md](GLOSSARY.md).

## Install (self-hosting)

You run one server (the API and the web app, plus a Postgres database) on a machine you control. The Android
app connects to it too. Everything is yours: there is no hosted service and no signup.

### Requirements

- Docker with the Compose v2 plugin (`docker compose version`).
- Optional: a [MaruMori](https://marumori.io) API key (for your known words and kanji) and an
  OpenAI-compatible AI endpoint (OpenAI, OpenRouter, Ollama, ...) for generated stories and grammar content.

### 1. Download the config

You do not need the source. The server (API and web app) and the import tool are published as container images
(`ghcr.io/jaycdev/virtual-japan-tutor-server` and `-import`, for `amd64` and `arm64`); you only need the
Compose file and an env file:

```sh
mkdir virtual-japan-tutor && cd virtual-japan-tutor
curl -fsSLO https://raw.githubusercontent.com/jaycdev/virtual-japan-tutor/main/deploy/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/jaycdev/virtual-japan-tutor/main/deploy/.env.example -o .env
```

Choose a version with `VJT_VERSION` in `.env`:

| Tag      | You get                                                          |
| -------- | ---------------------------------------------------------------- |
| `latest` | The newest tagged release (the default). Recommended.            |
| `dev`    | The newest commit on `main`. May be unstable.                    |
| `1.2.3`  | That exact release. `1.2` follows the newest patch of that line. |

If you pin a release, download the Compose file from that tag too (replace `main` in the URLs with `v1.2.3`).
If the packages are private, run `docker login ghcr.io` first with a GitHub token that has `read:packages`.

Edit `.env` (every variable is explained in the file) and set at least:

| Variable                                         | What                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `SECRETS_KEY`                                    | Required. Encrypts the API keys you store. `openssl rand -base64 32`, or `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Back it up: losing it makes stored keys unreadable. |
| `VJT_BOOTSTRAP_USERNAME` / `VJT_BOOTSTRAP_PASSWORD` | Your first account (password at least 10 characters). Created on first boot only while no users exist. Remove the password from `.env` afterwards. |
| `POSTGRES_PASSWORD`                              | Change it from the default. The database is not published outside the Compose network. |
| `SERVER_PORT`                                    | Host port for the API (default `8080`).                                               |

Optional: `AI_DEFAULT_BASE_URL`, `AI_DEFAULT_MODEL` and `AI_DEFAULT_API_KEY` pre-create a default AI Provider
for your account. You can also add providers later in the app's Settings.

### 2. Start the server

```sh
docker compose up -d
curl http://localhost:8080/health      # {"database":"connected","status":"ok"}
```

Migrations run automatically on start.

### 3. Load the reference data (once)

Dictionary, kanji, JLPT lists, pitch accents and the grammar catalogue are loaded by a one-off job. It
downloads open datasets (a minute or so) and is safe to re-run:

```sh
docker compose run --rm import
```

See [Importing reference data](#importing-reference-data) for what it loads and its licences.

### 4. Open the web app

Open `http://localhost:8080` (or your server's address and `SERVER_PORT`) in a browser and sign in with the
account from step 1. The web app is built into the server image and served by the server itself, so there is
nothing else to deploy and no CORS or proxy setup. `http://localhost:8080/health` is the API health check.

**Android**: there is no prebuilt APK yet. Build and install it from source
(`pnpm --filter @vjt/app android` with a device or emulator attached; see [Development](#development)).
The app asks for your server address on first launch and can change it in Settings. Release builds block plain
`http://` addresses, so put the server behind HTTPS if you use the app away from a debug build.
### 5. Set up your account

Once signed in, open **Settings** to add your MaruMori key (and run **Sync now**),
add or confirm an AI Provider, and choose your starting level. To add accounts later, see
[Creating the first account](#creating-the-first-account) (the `create-user` command).

### Keeping it safe and up to date

- The server speaks plain HTTP. Put it behind a reverse proxy with HTTPS before exposing it beyond your LAN.
- Back up the `pgdata` volume and your `.env` (especially `SECRETS_KEY`).
- Update: `docker compose pull && docker compose up -d` (with `VJT_VERSION=latest` this moves you to the newest release). Migrations apply on start.
- Stop: `docker compose down` (keeps data). `docker compose down -v` deletes the database.

## Development

### Layout

| Path                  | What                                                                    |
| --------------------- | ----------------------------------------------------------------------- |
| `api/openapi.yaml`    | OpenAPI spec: the single source of truth for the HTTP API               |
| `apps/server`         | Go server (std `net/http`, pgx, goose migrations)                       |
| `apps/web`            | Vite + React + TypeScript                                               |
| `apps/app`            | Expo + TypeScript (Android and web)                                     |
| `packages/api-client` | `@vjt/api-client`: TS types + client generated from the spec            |
| `packages/core`       | `@vjt/core`: UI-agnostic hooks/state shared by the web and Expo apps    |

### Prerequisites

Install [mise](https://mise.jdx.dev) and run `mise install` in the repo root. It provides the pinned
Go, Node and pnpm versions from `mise.toml`.

### Common commands (from the repo root)

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

### Regenerating from the OpenAPI spec

1. Edit `api/openapi.yaml`.
2. Run `pnpm generate`. This updates `apps/server/internal/api/api.gen.go` (oapi-codegen, strict server)
   and `packages/api-client/src/generated/schema.ts` (openapi-typescript).
3. Implement any new methods on the Go `StrictServerInterface` (`apps/server/internal/httpapi`).
4. Commit the generated files. CI re-runs generation and `pnpm check:generated` fails on any modified or untracked generated file.

### Running with Docker Compose

`deploy/docker-compose.yml` runs the published images. For development, `docker-compose.dev.yml` overrides them to
build from this checkout (`apps/server/Dockerfile`, targets `server` and `import`). Postgres data lives in a
named volume, migrations are embedded in the server binary and applied on start, and there are no bind mounts.

```sh
cp .env.example .env     # developer settings; then set SECRETS_KEY (see Secrets) and the bootstrap account
docker compose --project-directory . -f deploy/docker-compose.yml -f docker-compose.dev.yml up --build
curl http://localhost:8080/health   # {"database":"connected","status":"ok"}
docker compose --project-directory . -f deploy/docker-compose.yml -f docker-compose.dev.yml down -v   # tear down, including the database volume
```

Compose refuses to start without `SECRETS_KEY`. Set `VJT_BOOTSTRAP_USERNAME` / `VJT_BOOTSTRAP_PASSWORD`
to get a first account on first boot (see [Authentication](#authentication)). Ports are published on the
machine running the Docker daemon. Optional overrides (credentials, `SERVER_PORT`) go in `.env`.

### Publishing images

`.github/workflows/publish.yml` builds the `server` and `import` targets of `apps/server/Dockerfile` for
`linux/amd64` and `linux/arm64` and pushes them to GitHub Container Registry
(`ghcr.io/jaycdev/virtual-japan-tutor-server` and `-import`):

| Trigger                    | Tags pushed                                          |
| -------------------------- | ---------------------------------------------------- |
| push to `main`             | `dev`, `sha-<commit>`                                |
| push of tag `vX.Y.Z`       | `X.Y.Z`, `X.Y`, `latest`                             |
| push of tag `vX.Y.Z-rc.1`  | `X.Y.Z-rc.1` only (a pre-release never moves `latest`) |

Cut a release with `git tag v0.1.0 && git push origin v0.1.0`. The workflow does not wait for CI, so tag a
commit whose CI run is green. New GHCR packages start **private**: after the first publish, open each package's
settings on GitHub and make it public (and link it to the repository) so anyone can pull without logging in.

### Importing reference data

Global reference data (no user data) is loaded from open datasets by `apps/server/cmd/import`. Licences
and attribution are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); nothing is committed except the
grammar spreadsheet.

| Dataset     | Fills                                                                       | Source                                                        |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `jmdict`    | `jmdict_entries`, `_kanji_forms`, `_readings`, `_senses`, `_tags`            | EDRDG `JMdict_e.gz` (CC BY-SA 4.0), updated daily upstream    |
| `kanjidic2` | `kanji`, `kanji_readings`, `kanji_meanings`                                  | EDRDG `kanjidic2.xml.gz` (CC BY-SA 4.0)                       |
| `waller`    | `jlpt_vocab_entries`, `jlpt_vocab_links`, `jlpt_kanji` (JLPT Level)          | Jonathan Waller's lists (CC BY), pinned mirrors, see the notices |
| `kanjium`   | `pitch_accents`                                                              | Kanjium `accents.txt` (CC BY-SA 4.0), pinned commit           |
| `grammar`   | `grammar_points` (the Grammar Catalogue)                                     | `data/grammar/jlpt-grammar.csv`                               |

A full import takes about a minute (JMdict is streamed, never held in memory) and is **idempotent**: each
dataset loads in one transaction, and running it again on the same sources leaves every table with the same
rows. JMdict entries, kanji and Grammar Points are upserted on their natural keys, so ids that other tables
will reference never change; dependent rows (forms, senses, readings, links) are replaced. `import_runs`
records one row per distinct source checksum of a dataset (source URL, licence, version, sha256, fetched-at,
row counts): re-importing identical data updates that dataset's existing row, while a changed source (new
checksum) adds a new row.

#### Run it with Docker Compose

Downloads happen inside the container into the `refdata-cache` named volume, so a second run does not
download again:

```sh
docker compose --project-directory . -f deploy/docker-compose.yml -f docker-compose.dev.yml up -d db                  # Postgres (the server is not needed)
docker compose --project-directory . -f deploy/docker-compose.yml -f docker-compose.dev.yml run --rm --build import   # everything, built from source
docker compose --project-directory . -f deploy/docker-compose.yml -f docker-compose.dev.yml run --rm import --only grammar,kanjium
docker compose --project-directory . -f deploy/docker-compose.yml -f docker-compose.dev.yml run --rm import --refresh # download again
docker compose --project-directory . -f deploy/docker-compose.yml -f docker-compose.dev.yml down                      # keeps the volumes; add -v to drop the cache and database
```

The `import` service applies pending migrations itself, so it also works against a fresh database.

#### Run it locally

```sh
cd apps/server
export DATABASE_URL=postgres://user:pass@host:5432/db
export GRAMMAR_CSV=../../data/grammar/jlpt-grammar.csv   # the default, data/grammar/..., is relative to the repo root
go run ./cmd/import                                      # download into the user cache dir, then load
go run ./cmd/import --source-dir /path/to/sources        # offline, no network
```

Flags: `--only jmdict,kanjidic2,waller,kanjium,grammar` (default all, in dependency order: the JLPT lists are
matched against JMdict, so import JMdict first), `--cache-dir` (`REFDATA_CACHE_DIR`), `--source-dir`
(`REFDATA_SOURCE_DIR`), `--refresh`, `--grammar-csv` (`GRAMMAR_CSV`), `--database-url` (`DATABASE_URL`).

Offline mode: `--source-dir` takes the same layout as the cache and never touches the network:
`JMdict_e.gz`, `kanjidic2.xml.gz` (plain `JMdict_e` / `kanjidic2.xml` also work), `accents.txt`, and
`waller/n1_vocab.csv` .. `n5_vocab.csv`, `waller/n1_kanji.csv` .. `n5_kanji.csv`. The URLs are in
`apps/server/internal/refdata/sources.go`. Downloads of pinned files (Waller, Kanjium) are checked against
their sha256 and refused on mismatch; EDRDG publishes no checksums and rebuilds its files daily, so those are
checksummed after download and the checksum is recorded in `import_runs`.

At the end the command prints a summary and the **match quality**: how many Waller rows matched JMdict /
KANJIDIC2 and how many did not (with examples), and how many JMdict entries have pitch data. Unmatched list
rows are kept in `jlpt_vocab_entries` with an empty `match_method`, never dropped.

#### How the data is interpreted

- **JLPT Level** of a word or kanji comes only from Waller's lists, matched to JMdict by (written form,
  reading), trying in order: `exact` (a written form and reading both belong to an entry; slash alternatives
  such as 土曜/土曜日 may hit separate entries), `written` (reading disagrees, but the form identifies a single
  entry), `kana` / `kana_ambiguous` (kana-only rows: entries with no kanji or usually written in kana; the
  common one with the lowest `ent_seq` wins), `kana_fallback` (only entries with kanji forms exist, e.g. いす),
  and `stem` (after stripping a trailing する/と/な/に). A word on several levels counts at the easiest. Words on no
  list have no JLPT Level. KANJIDIC2's own `<jlpt>` is on the old four-level scale, so it is stored as
  `kanji.legacy_jlpt` and never used as a level.
- **Pitch accent** (Kanjium): all patterns per (word, reading) are kept in file order, with `pitch_accents.rank`.
  Kanjium has no frequency data and lists a word's main pattern first, so rank 1 is marked `is_primary` ("most
  common"). A blank reading means the word is its own reading. Part-of-speech notes such as `(副)` go in `tag`.
- **Grammar Catalogue:** the pattern is split into `variants` on `・` and `/` (a run of dots like `・・・` is an
  ellipsis, and separators inside brackets do not split). `normalised_pattern` is the NFKC-normalised variants
  with `〜`/`～`, ellipses, whitespace, `、。`, bracket characters and `[A]` style annotations removed, ASCII
  lower-cased, joined with `・`; optional parts keep their content (`とか（で）` becomes `とかで`). See
  `NormalisePattern`. A Grammar Point is (JLPT Level, normalised pattern, ordinal): the same pattern at two levels
  is two points, and so is a pattern the spreadsheet lists twice at one level (のに and そうだ at N4), told apart by
  `ordinal`. `explanation` is a nullable column for the later AI-generated text.

#### Looking things up from Go

`internal/refdata` has `NewStore(pool)` with `FindVocabulary(written, reading)`, `VocabularyJLPTLevel(entSeq)`,
`FindKanji(literal)`, `KanjiJLPTLevel(literal)`, `PitchAccents(word, reading)` and `FindGrammar(pattern)`
(every level, easiest first; the query is normalised the same way as the catalogue).

### Running locally

Server (needs a reachable Postgres):

```sh
cd apps/server
DATABASE_URL=postgres://user:pass@host:5432/db go run ./cmd/server
```

Web: the server serves the built web app from `WEB_DIR` (the image sets it; unset means API only), so build it and
point the server at it, then open <http://localhost:8080>:

```sh
pnpm --filter @vjt/web build
cd apps/server && WEB_DIR=../web/dist DATABASE_URL=... SECRETS_KEY=... go run ./cmd/server
```

`pnpm --filter @vjt/web dev` (hot reload) calls the API on `VITE_API_URL` (default `http://localhost:8080`), a
different origin, and the server sends no CORS headers, so a browser blocks those calls. Use the build above
until CORS is added.

Android: `pnpm --filter @vjt/app android` (set `EXPO_PUBLIC_API_URL`; defaults to `http://10.0.2.2:8080`, the
host as seen from the Android emulator).

Packages `@vjt/api-client` and `@vjt/core` are consumed from their built `dist/`, so run `pnpm build`
(or the package's `build`) after changing them.

### Authentication

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
always `{"code": "...", "message": "..."}`. Every request body, including `/auth/login`, is capped at
`HTTP_MAX_BODY_BYTES` (default 1 MiB); larger bodies get `413` with code `payload_too_large`.

#### Creating the first account

No account exists on a fresh database. Either:

- **Env seed**: set `VJT_BOOTSTRAP_USERNAME` and `VJT_BOOTSTRAP_PASSWORD` (both, password >= 10 characters).
  On boot, after migrations, the server creates that account only if there are zero users, so leaving the
  variables set is harmless, but remove the password from your `.env` once it exists.
- **CLI**: `server create-user --username NAME`. The password is read from an interactive prompt (no echo)
  or, when stdin is not a terminal, from the first line of stdin. It is never accepted as a flag. Examples:

  ```sh
  cd apps/server && DATABASE_URL=... SECRETS_KEY=... go run ./cmd/server create-user --username me
  # in compose (run next to docker-compose.yml): pipe the password in, do not put it on the command line
  printf "%s\n" "$PASSWORD" | docker compose exec -T server server create-user --username me
  ```

### Secrets

Third-party keys (the MaruMori key, AI Provider keys) are encrypted at rest with `internal/secrets`:
AES-256-GCM, stored as `v1:` + base64(nonce || ciphertext). The version prefix lets keys or the algorithm
rotate later. The key comes from `SECRETS_KEY` (base64, exactly 32 bytes); the server fails at startup with
a clear error if it is missing or invalid. Generate a dev key with:

```sh
openssl rand -base64 32
# no openssl (Node is already required for this repo):
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Treat it like a password: losing or changing it makes stored secrets unreadable. Stored secrets today are
[AI Provider](#ai-providers) API keys and the [MaruMori](#marumori-connection-and-sync) API key (both write-only).

### AI Providers

An **AI Provider** ([GLOSSARY](GLOSSARY.md)) is a saved OpenAI-compatible endpoint: name, base URL, API key
and model. The Learner manages them in the web app's **Settings** page and picks which one serves each
**task** (`story`, `grammar_content`). All routes are authenticated and user-scoped; see `api/openapi.yaml`
(`/ai-providers`, `/ai-providers/{id}/test`, `/ai-tasks`).

- **Any OpenAI-compatible endpoint**: OpenAI, OpenRouter, LiteLLM, Ollama, vLLM... The base URL is normalised
  (trailing slash removed, `/v1` added when the path is empty, a pasted `.../chat/completions` is cut back) and
  must be `http` or `https` without embedded credentials. **Private, LAN and localhost addresses are allowed
  on purpose** (this is a single-user, self-hosted tool and local endpoints are a main use case), so anyone who
  can log in can make the server call any address it can reach. For the same reason the connection-test
  messages can reveal whether a host and port are reachable, which is acceptable here because the app is
  single-user and self-hosted.
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

#### Grammar content is shared

The **Grammar Catalogue** ([GLOSSARY](GLOSSARY.md)) is one shared table, and so is the content generated for it:
an **Explanation** or an **Example Sentence** belongs to the Grammar Point, not to the Learner who asked for it.
Whoever reads a point first pays for the generation (a missing explanation, and fewer than 5 example sentences,
are filled in on read); every later reader is served the stored content without a provider call. That is a cost
decision, not an oversight: one explanation per point means one bill per point, but a Learner who wants their own
wording cannot get it, and `POST /grammar-points/{id}/regenerate` replaces the explanation for every learner.
**Provider assignment stays per Learner**: the Learner whose request triggered the generation is the one whose
assigned `grammar_content` provider, API key and quota are used (the in-flight generation cache is keyed by
that Learner and point), and a Learner with no provider assigned is served whatever content the point already has
instead of being run on someone else's provider. See `internal/grammar`.

### MaruMori connection and Sync

**MaruMori** ([GLOSSARY](GLOSSARY.md)) is a third-party study app. The Learner connects it in the web app's
**Settings** page: the API key is write-only (`v1:` ciphertext in `marumori_settings.api_key_encrypted`, never
returned, never logged), and a **Sync** reads the Learner's **knowledge state** into this server. See
`api/openapi.yaml` (`/marumori`, `/marumori/key`, `/marumori/sync`, `/marumori/syncs`).

- **Knowledge state only (ADR-0002).** A Sync reads the five knowledge-state endpoints (`/home` counters,
  `/known/kanji`, `/known/vocabulary`, `/srs/grammar-lessons`, `/srs/grammar-reviews`) and stores only what MaruMori
  *knows about the Learner*: SRS levels, per-Sync history (appeared / level changed / disappeared), grammar SRS
  observations, and the home counters. Item **content** — meanings, definitions, readings, mnemonics, pitch,
  examples, personal notes, even grammar point names — is never stored or forwarded. Unlinked vocabulary is counted,
  not copied; an unlinked kanji is kept only when its text is a single character, and then only that character.
- **Linking.** Kanji resolve against KANJIDIC2 by literal; vocabulary resolves against JMdict by written text
  (ambiguous picks go to the easiest JLPT level first). Sync counts record `linked`, `unlinked` and `ambiguous`.
- **Scheduled + manual.** A background sweep Syncs every learner with a key every `MARUMORI_SYNC_INTERVAL`
  (default 4 h, ±20 % jitter so accounts do not all fire together); `MARUMORI_SYNC_ENABLED=false` disables it.
  `POST /marumori/sync` runs one immediately; a second concurrent attempt gets `409 sync_running`.
- **Failed Syncs are data, not HTTP errors.** A run against a dead upstream finishes as `failed` with readable
  learner-facing text (returned in a `200` body and listed by `/marumori/syncs`); the key never appears in it.
- **Unofficial API.** MaruMori has no official public API; `internal/marumori` mirrors the community-documented
  endpoints. Its tests run against fixtures in `internal/marumori/testdata` — nothing in this repo contacts the
  real MaruMori. `MARUMORI_API_BASE_URL` points the client elsewhere (a local stand-in, for instance).

### Data conventions

- Every domain table carries `user_id uuid NOT NULL REFERENCES users(id)` (`users`/`user_id` is the technical
  identity behind a Learner in the [GLOSSARY](GLOSSARY.md)). Index it with the queries you expect.
- The user id comes **only** from the request context: `auth.UserID(ctx)` (`internal/auth`). Never take it
  from request input, and filter every statement on it (`WHERE user_id = $1`). With no authenticated identity
  in the context there is no id, hence no query. `noteRepo` in `internal/auth/scoping_test.go` is the
  reference pattern, with a test that one user cannot read another's rows.
- Auth is checked in middleware before handlers run, so handlers can rely on the identity being present.

### Environment

See `.env.example` (developers) and `deploy/.env.example` (self-hosters) for every variable. Never commit a real `.env`.
