// Package httpapi wires the generated OpenAPI stubs to their implementations.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/aiprovider"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/api"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/auth"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/dictionary"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/grammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/itemlist"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/knowngrammar"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/marumorisync"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/mastery"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/practice"
	"github.com/jaycdev/virtual-japan-tutor/apps/server/internal/story"
)

// Pinger reports whether the database is reachable.
type Pinger interface {
	Ping(ctx context.Context) error
}

const pingTimeout = 2 * time.Second

// publicRoutes are the only routes reachable without a session. Everything else is
// authenticated by default: a new route added to the spec is protected unless it is
// listed here (and opts out with `security: []` in api/openapi.yaml; a test keeps the
// two in agreement). Keys are Go ServeMux patterns, "METHOD /path".
var publicRoutes = map[string]bool{
	"GET /health":      true,
	"POST /auth/login": true,
}

// DefaultMaxBodyBytes is the request body cap when WithMaxBodyBytes is not used.
const DefaultMaxBodyBytes = 1 << 20

type server struct {
	db           Pinger
	auth         *auth.Service
	ai           *aiprovider.Service
	marumori     *marumorisync.Service
	grammar      grammar.Store
	grammarGen   *grammar.Generator
	knownGrammar *knowngrammar.Service
	mastery      *mastery.Service
	practice     *practice.Service
	story        *story.Service
	dictionary   *dictionary.Service
	itemLists    *itemlist.Service
	maxBody      int64
}

// WithMaxBodyBytes sets the cap applied to every request body (default 1 MiB).
func WithMaxBodyBytes(n int64) Option { return func(s *server) { s.maxBody = n } }

// Option wires an optional feature service into the handler.
type Option func(*server)

// WithAIProviders enables the /ai-providers and /ai-tasks routes.
func WithAIProviders(svc *aiprovider.Service) Option { return func(s *server) { s.ai = svc } }

// WithMaruMori enables the /marumori routes.
func WithMaruMori(svc *marumorisync.Service) Option { return func(s *server) { s.marumori = svc } }

// WithKnownGrammar enables the /starting-level and /grammar/review routes
// (issue #6: onboarding and Observed Grammar review).
func WithKnownGrammar(svc *knowngrammar.Service) Option {
	return func(s *server) { s.knownGrammar = svc }
}

// WithFocusSet enables the /focus-set route (issue #7: Mastery scoring and
// the rotating Focus Set).
func WithFocusSet(svc *mastery.Service) Option {
	return func(s *server) { s.mastery = svc }
}

// New returns the HTTP handler serving the API defined in api/openapi.yaml.
func New(db Pinger, authn *auth.Service, opts ...Option) http.Handler {
	s := &server{db: db, auth: authn, maxBody: DefaultMaxBodyBytes}
	for _, o := range opts {
		o(s)
	}
	strict := api.NewStrictHandlerWithOptions(s, nil, api.StrictHTTPServerOptions{
		RequestErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, err error) {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				writePayloadTooLarge(w)
				return
			}
			writeError(w, http.StatusBadRequest, "bad_request", "Malformed request")
		},
		ResponseErrorHandlerFunc: func(w http.ResponseWriter, r *http.Request, err error) {
			slog.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
			writeError(w, http.StatusInternalServerError, "internal", "Internal server error")
		},
	})
	inner := api.HandlerWithOptions(strict, api.StdHTTPServerOptions{
		Middlewares: []api.MiddlewareFunc{s.requireSession},
		ErrorHandlerFunc: func(w http.ResponseWriter, _ *http.Request, _ error) {
			writeError(w, http.StatusBadRequest, "bad_request", "Malformed request")
		},
	})
	return s.limitBody(inner)
}

// limitBody caps every request body, public routes included, before anything decodes it.
// A declared Content-Length over the cap is refused outright; otherwise the reader errors
// once the cap is exceeded, which the JSON decoding error handler turns into a 413.
func (s *server) limitBody(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.ContentLength > s.maxBody {
			writePayloadTooLarge(w)
			return
		}
		if r.Body != nil {
			r.Body = http.MaxBytesReader(w, r.Body, s.maxBody)
		}
		next.ServeHTTP(w, r)
	})
}

func writePayloadTooLarge(w http.ResponseWriter) {
	writeError(w, http.StatusRequestEntityTooLarge, "payload_too_large", "Request body too large")
}

// requireSession authenticates every route not in publicRoutes, before the request body
// is read, and attaches the caller's auth.Identity to the request context.
func (s *server) requireSession(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if publicRoutes[r.Pattern] {
			next.ServeHTTP(w, r)
			return
		}
		token, ok := bearerToken(r)
		if !ok {
			unauthorized(w)
			return
		}
		id, err := s.auth.Authenticate(r.Context(), token)
		switch {
		case errors.Is(err, auth.ErrUnauthenticated):
			unauthorized(w)
		case err != nil:
			slog.Error("authenticate", "err", err)
			writeError(w, http.StatusInternalServerError, "internal", "Internal server error")
		default:
			next.ServeHTTP(w, r.WithContext(auth.WithIdentity(r.Context(), id)))
		}
	})
}

// bearerToken extracts the token from "Authorization: Bearer <token>" (scheme is case-insensitive).
func bearerToken(r *http.Request) (string, bool) {
	scheme, token, found := strings.Cut(r.Header.Get("Authorization"), " ")
	token = strings.TrimSpace(token)
	if !found || !strings.EqualFold(scheme, "Bearer") || token == "" {
		return "", false
	}
	return token, true
}

func unauthorized(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Bearer realm="vjt"`)
	writeError(w, http.StatusUnauthorized, "unauthorized", "Missing, invalid or expired session token")
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(api.Error{Code: code, Message: message})
}

func (s *server) GetHealth(ctx context.Context, _ api.GetHealthRequestObject) (api.GetHealthResponseObject, error) {
	ctx, cancel := context.WithTimeout(ctx, pingTimeout)
	defer cancel()
	if err := s.db.Ping(ctx); err != nil {
		return api.GetHealth503JSONResponse{Status: api.HealthStatusDegraded, Database: api.Unreachable}, nil
	}
	return api.GetHealth200JSONResponse{Status: api.HealthStatusOk, Database: api.Connected}, nil
}

func (s *server) Login(ctx context.Context, req api.LoginRequestObject) (api.LoginResponseObject, error) {
	if req.Body == nil || req.Body.Username == "" || req.Body.Password == "" {
		return api.Login400JSONResponse{Code: "bad_request", Message: "username and password are required"}, nil
	}
	sess, err := s.auth.Login(ctx, req.Body.Username, req.Body.Password)
	var locked *auth.LockedError
	switch {
	case errors.As(err, &locked):
		secs := max(1, int(math.Ceil(locked.RetryAfter.Seconds())))
		return api.Login429JSONResponse{
			Body:    api.Error{Code: "too_many_attempts", Message: "Too many failed attempts; try again later"},
			Headers: api.Login429ResponseHeaders{RetryAfter: secs},
		}, nil
	case errors.Is(err, auth.ErrInvalidCredentials):
		return api.Login401JSONResponse{Code: "invalid_credentials", Message: "Invalid username or password"}, nil
	case err != nil:
		return nil, err
	}
	return api.Login200JSONResponse{
		Token:     sess.Token,
		ExpiresAt: sess.ExpiresAt,
		User:      api.User{Id: sess.User.ID, Username: sess.User.Username},
	}, nil
}

func (s *server) Logout(ctx context.Context, _ api.LogoutRequestObject) (api.LogoutResponseObject, error) {
	if err := s.auth.Logout(ctx); err != nil {
		return nil, err
	}
	return api.Logout204Response{}, nil
}

func (s *server) GetMe(ctx context.Context, _ api.GetMeRequestObject) (api.GetMeResponseObject, error) {
	id, ok := auth.IdentityFrom(ctx)
	if !ok {
		return nil, auth.ErrUnauthenticated // unreachable behind requireSession; fail closed
	}
	return api.GetMe200JSONResponse{Id: id.ID, Username: id.Username}, nil
}
