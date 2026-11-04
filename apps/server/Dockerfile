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

# TEMPORARY (#75 -> #82): the web app is being rebuilt as apps/web (#76), and apps/mobile is
# phone-only with no web export. Until #82 wires apps/web in here, the server image serves a
# placeholder page so the image still builds and serves / next to the API. Replace this stage
# with the apps/web build when #82 lands.
FROM alpine:3.22 AS web
RUN mkdir -p /out/web \
 && echo '<!doctype html><meta charset="utf-8"><title>Virtual Japan Tutor</title><p>The web app is being rebuilt, see #73.</p>' > /out/web/index.html

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
