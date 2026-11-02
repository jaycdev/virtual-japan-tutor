# Build context is the repository root (see deploy/docker-compose.yml), because the import image
# carries data/grammar/jlpt-grammar.csv. Generated code is committed, so the image build
# needs neither the OpenAPI spec nor any code generation.
#
# Targets: `server` (default, the last stage) and `import` (one-off reference data import).
FROM --platform=$BUILDPLATFORM golang:1.27.1-alpine AS build
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/ ./cmd/server ./cmd/import

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
EXPOSE 8080
# Migrations are embedded in the binary and applied on start.
ENTRYPOINT ["server"]
