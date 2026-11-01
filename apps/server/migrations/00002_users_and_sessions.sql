-- +goose Up
-- Convention: every domain table added from now on carries
--   user_id uuid NOT NULL REFERENCES users(id)
-- (see "Data conventions" in the README).
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username      text NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Usernames are unique case-insensitively ("Alice" and "alice" are the same account).
CREATE UNIQUE INDEX users_username_lower_key ON users (lower(username));

-- Opaque session tokens. Only the SHA-256 of the token is stored, never the token.
CREATE TABLE sessions (
    token_hash   bytea PRIMARY KEY,
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL,
    last_used_at timestamptz NOT NULL,
    expires_at   timestamptz NOT NULL
);

CREATE INDEX sessions_user_id_idx ON sessions (user_id);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

-- +goose Down
DROP TABLE sessions;
DROP TABLE users;
