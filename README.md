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

Docker runs on a remote VM, so compose uses no bind mounts: images are built from the repo root
(`apps/server/Dockerfile`, targets `server` and `import`) and Postgres data lives in a named volume. Migrations are embedded in the server binary and applied on start.

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

## Importing reference data

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
records one row per dataset version (source URL, licence, version, sha256, fetched-at, row counts) and is
updated, not appended to, when the same source is imported again.

### Run it on the remote Docker host

Downloads happen inside the container into the `refdata-cache` named volume, so there are no bind mounts
and a second run does not download again:

```sh
docker --context docker-dev compose up -d db                  # Postgres (the server is not needed)
docker --context docker-dev compose run --rm --build import   # everything
docker --context docker-dev compose run --rm import --only grammar,kanjium
docker --context docker-dev compose run --rm import --refresh # download again
docker --context docker-dev compose down                      # keeps the volumes; add -v to drop the cache and database
```

The `import` service applies pending migrations itself, so it also works against a fresh database.

### Run it locally

```sh
cd apps/server
DATABASE_URL=postgres://user:pass@host:5432/db go run ./cmd/import                       # download to the user cache dir
DATABASE_URL=... go run ./cmd/import --grammar-csv ../../data/grammar/jlpt-grammar.csv   # (default path is relative to the repo root)
DATABASE_URL=... go run ./cmd/import --source-dir /path/to/sources                        # offline
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

### How the data is interpreted

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

### Looking things up from Go

`internal/refdata` has `NewStore(pool)` with `FindVocabulary(written, reading)`, `VocabularyJLPTLevel(entSeq)`,
`FindKanji(literal)`, `KanjiJLPTLevel(literal)`, `PitchAccents(word, reading)` and `FindGrammar(pattern)`
(every level, easiest first; the query is normalised the same way as the catalogue).

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

Treat it like a password: losing or changing it makes stored secrets unreadable. No feature stores a secret yet.

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
