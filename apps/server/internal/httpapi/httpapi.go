// Package httpapi wires the generated OpenAPI stubs to their implementations.
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
)

// Pinger reports whether the database is reachable.
type Pinger interface {
	Ping(ctx context.Context) error
}

const pingTimeout = 2 * time.Second

type server struct{ db Pinger }

// New returns the HTTP handler serving the API defined in api/openapi.yaml.
func New(db Pinger) http.Handler {
	strict := api.NewStrictHandler(&server{db: db}, nil)
	return api.Handler(strict)
}

func (s *server) GetHealth(ctx context.Context, _ api.GetHealthRequestObject) (api.GetHealthResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		return api.GetHealth503JSONResponse{Status: api.Degraded, Database: api.Unreachable}, nil
	}
	return api.GetHealth200JSONResponse{Status: api.Ok, Database: api.Connected}, nil
}
