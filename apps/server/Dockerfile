# Build context is the repository root (see deploy/docker-compose.yml), because the import image
# carries data/grammar/jlpt-grammar.csv. Generated code is committed, so the image build
# needs neither the OpenAPI spec nor any code generation.
#
# Targets: `server` (default, the last stage: the API plus the built web app) and `import` (one-off
# reference data import).
FROM --platform=$BUILDPLATFORM golang:1.27.1-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/server ./cmd/import

# The web app: the Expo export of apps/app (ADR-0007). The output is plain static files, so this
# stage always runs on the build platform. Production builds call the API on their own origin,
# which is where the server serves them from.
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
RUN corepack enable
WORKDIR /src
# expo export in a container: no interactive prompts, no telemetry.
ENV CI=1 \
    EXPO_NO_TELEMETRY=1
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY apps/app/package.json apps/app/
COPY apps/server/package.json apps/server/
COPY packages/api-client/package.json packages/api-client/
COPY packages/core/package.json packages/core/
RUN pnpm install --frozen-lockfile --filter "@vjt/app..."
COPY apps/app apps/app
COPY packages/api-client packages/api-client
COPY packages/core packages/core
# @vjt/api-client and @vjt/core are consumed from their built dist/, so build the dependencies
# first; the export itself is web-only (the app's `build` script exports Android).
RUN pnpm --filter "@vjt/app^..." build \
 && pnpm --filter @vjt/app run build:web

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
COPY --from=web /src/apps/app/dist-web /usr/share/vjt/web
# Serve the web app at / next to the API. Unset WEB_DIR to run the API only.
ENV WEB_DIR=/usr/share/vjt/web
EXPOSE 8080
# Migrations are embedded in the binary and applied on start.
ENTRYPOINT ["server"]
