# Build context is apps/server (see docker-compose.yml). Generated code is committed,
# so the image build does not need the OpenAPI spec or any code generation.
FROM golang:1.27.1-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM alpine:3.22
RUN adduser -D -u 10001 app
USER app
COPY --from=build /out/server /usr/local/bin/server
EXPOSE 8080
# Migrations are embedded in the binary and applied on start.
ENTRYPOINT ["server"]
