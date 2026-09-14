CREATE TABLE autonomy_settings (
 business_id TEXT PRIMARY KEY REFERENCES businesses(id), owner_id TEXT NOT NULL REFERENCES users(id),
 version INTEGER NOT NULL, policy TEXT NOT NULL, next_at INTEGER, lease TEXT, lease_until INTEGER,
 model TEXT NOT NULL DEFAULT '', credential TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE autonomy_jobs (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), status TEXT NOT NULL,
 policy_version INTEGER NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX autonomy_one_running ON autonomy_jobs(business_id) WHERE status='running';
CREATE INDEX autonomy_job_scope ON autonomy_jobs(business_id,created_at);
CREATE TABLE autonomy_actions (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES autonomy_jobs(id), name TEXT NOT NULL,
 status TEXT NOT NULL, prepared TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
