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

Postgres-backed Go tests are skipped unless `TEST_DATABASE_URL` is set (CI sets it).

## Regenerating from the OpenAPI spec

1. Edit `api/openapi.yaml`.
2. Run `pnpm generate`. This updates `apps/server/internal/api/api.gen.go` (oapi-codegen, strict server)
   and `packages/api-client/src/generated/schema.ts` (openapi-typescript).
3. Implement any new methods on the Go `StrictServerInterface` (`apps/server/internal/httpapi`).
4. Commit the generated files. CI re-runs generation and fails if they are stale.

## Running with Docker Compose

Docker runs on a remote VM, so compose uses no bind mounts: images are built from `apps/server`
and Postgres data lives in a named volume. Migrations are embedded in the server binary and applied on start.

```sh
docker --context docker-dev compose up --build
curl http://docker-dev.internal:8080/health   # {"database":"connected","status":"ok"}
docker --context docker-dev compose down -v   # tear down, including the database volume
```

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

## Environment

See `.env.example` for every variable. Never commit a real `.env`.
