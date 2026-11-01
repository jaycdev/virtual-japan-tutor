package auth

import (
	"context"

	"github.com/google/uuid"
)

// Identity is the authenticated caller attached to a request context by the HTTP middleware.
type Identity struct {
	User
	sessionKey []byte // hash of the bearer token; lets Logout delete exactly this session
}

type identityKey struct{}

// WithIdentity returns ctx carrying id.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, id)
}

// IdentityFrom returns the Identity in ctx, if the request was authenticated.
func IdentityFrom(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey{}).(Identity)
	return id, ok
}

// UserID returns the authenticated user's id, or ErrUnauthenticated. Every query on a
// user-scoped table takes its user_id from here (never from request input), so a handler
// cannot forget the scope: no id in context, no query.
func UserID(ctx context.Context) (uuid.UUID, error) {
	id, ok := IdentityFrom(ctx)
	if !ok {
		return uuid.Nil, ErrUnauthenticated
	}
	return id.ID, nil
}
