CREATE TABLE companies(id TEXT PRIMARY KEY, name TEXT NOT NULL);
INSERT INTO companies VALUES('company','会社ダッシュボード');
ALTER TABLE businesses ADD COLUMN company_id TEXT NOT NULL DEFAULT 'company' CHECK(company_id='company');
CREATE TABLE users(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), email TEXT NOT NULL COLLATE NOCASE UNIQUE,
 name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX one_company_owner ON users(company_id) WHERE role='owner';
CREATE TRIGGER preserve_owner BEFORE UPDATE ON users WHEN OLD.role='owner' AND (NEW.role!='owner' OR NEW.active!=1 OR NEW.company_id!=OLD.company_id)
BEGIN SELECT RAISE(ABORT,'owner cannot be removed'); END;
CREATE TRIGGER preserve_owner_delete BEFORE DELETE ON users WHEN OLD.role='owner'
BEGIN SELECT RAISE(ABORT,'owner cannot be removed'); END;
CREATE TABLE access_grants(
 user_id TEXT NOT NULL REFERENCES users(id), business_id TEXT NOT NULL REFERENCES businesses(id),
 page TEXT NOT NULL, edit INTEGER NOT NULL DEFAULT 0, projects TEXT NOT NULL DEFAULT 'null',
 PRIMARY KEY(user_id,business_id,page)
);
CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON user_sessions(expires);
CREATE TABLE invitations(
 token_hash TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), email TEXT COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('owner','member')), grants TEXT NOT NULL DEFAULT '[]',
 kind TEXT NOT NULL DEFAULT 'enroll' CHECK(kind IN ('enroll','reset')), target_id TEXT REFERENCES users(id),
 expires INTEGER NOT NULL, created_by TEXT REFERENCES users(id), used_by TEXT REFERENCES users(id), revoked INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE TABLE audit_events(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), actor_id TEXT, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX audit_time ON audit_events(company_id,created_at);
ALTER TABLE users ADD COLUMN mutation_id TEXT NOT NULL DEFAULT '';
