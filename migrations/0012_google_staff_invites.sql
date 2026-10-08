ALTER TABLE oauth_states ADD COLUMN invite_hash TEXT REFERENCES invitations(token_hash);
