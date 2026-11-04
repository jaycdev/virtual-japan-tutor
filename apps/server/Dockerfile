# Build context is the repository root (see deploy/docker-compose.yml), because the import image
# carries data/grammar/jlpt-grammar.csv. Generated code is committed, so the image build
# needs neither the OpenAPI spec nor any code generation.
#
# Targets: `server` (default, the last stage: the API plus the web app) and `import` (one-off
# reference data import).
FROM --platform=$BUILDPLATFORM golang:1.27.1-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/server ./cmd/import

# The web app (ADR-0010): apps/web, a Vite + React SPA. The build runs once on the build
# platform (--platform=$BUILDPLATFORM) — dist/ is static files, so every target architecture's
# final stage just COPYs it; the Go stage above is the only per-architecture work. Node matches
# CI/mise (mise.toml). Workspace manifests come before the sources so pnpm install is reused
# until dependencies change. apps/mobile is deliberately absent: pnpm --frozen-lockfile accepts
# lockfile importers that are not in the workspace, and the web build never touches it.
# Generated code is committed, so the build runs no generators.
FROM --platform=$BUILDPLATFORM node:24.21.0-alpine AS web
WORKDIR /src
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json turbo.json tsconfig.base.json .npmrc ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/api-client/package.json packages/api-client/
COPY packages/core/package.json packages/core/
COPY packages/design/package.json packages/design/
RUN corepack enable && pnpm install --frozen-lockfile
COPY packages/api-client packages/api-client
COPY packages/core packages/core
COPY packages/design packages/design
COPY apps/web apps/web
# The `...` suffix also runs the build scripts of the workspace deps (@vjt/design,
# @vjt/api-client, @vjt/core) first, in topological order.
RUN pnpm --filter @vjt/web... build
RUN mkdir -p /out && cp -r apps/web/dist /out/web

# Reference data import: JMdict, KANJIDIC2, JLPT lists, Kanjium and the Grammar Catalogue.
# Downloads land in a cache directory meant to be a named volume (no bind mounts).
# Run with: docker compose run --rm import
FROM alpine:3.22 AS import
RUN apk add --no-cache ca-certificates \
 && adduser -D -u 10001 app \
 && mkdir -p /var/cache/vjt-refdata \
 && chown app /var/cache/vjt-refdata
USER app
COPY --from=build /out/import /usr/local/bin/import
COPY data/grammar/jlpt-grammar.csv /usr/share/vjt/jlpt-grammar.csv
ENV GRAMMAR_CSV=/usr/share/vjt/jlpt-grammar.csv \
    REFDATA_CACHE_DIR=/var/cache/vjt-refdata
ENTRYPOINT ["import"]

FROM alpine:3.22 AS server
RUN adduser -D -u 10001 app
USER app
COPY --from=build /out/server /usr/local/bin/server
COPY --from=web /out/web /usr/share/vjt/web
# Serve the web app at / next to the API. Unset WEB_DIR to run the API only.
ENV WEB_DIR=/usr/share/vjt/web
EXPOSE 8080
# Migrations are embedded in the binary and applied on start.
ENTRYPOINT ["server"]
