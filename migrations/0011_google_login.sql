ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN google_linked_at TEXT;
CREATE UNIQUE INDEX users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

CREATE TABLE oauth_states(
 state_hash TEXT PRIMARY KEY,
 nonce TEXT NOT NULL,
 expires INTEGER NOT NULL
);
CREATE INDEX oauth_states_expiry ON oauth_states(expires);
