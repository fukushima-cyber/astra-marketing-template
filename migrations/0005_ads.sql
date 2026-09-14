CREATE TABLE ad_accounts (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), provider TEXT NOT NULL,
 external_id TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL, timezone TEXT NOT NULL,
 credential TEXT NOT NULL, policy TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 busy_id TEXT, last_sync TEXT, created_at TEXT NOT NULL, UNIQUE(provider,external_id)
);
CREATE TABLE ad_entities (
 account_id TEXT NOT NULL REFERENCES ad_accounts(id), id TEXT NOT NULL, level TEXT NOT NULL,
 data TEXT NOT NULL, PRIMARY KEY(account_id,id)
);
CREATE TABLE ad_reports (
 account_id TEXT NOT NULL REFERENCES ad_accounts(id), ad_id TEXT NOT NULL, day TEXT NOT NULL,
 data TEXT NOT NULL, collected_at TEXT NOT NULL, PRIMARY KEY(account_id,ad_id,day)
);
CREATE TABLE ad_changes (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES ad_accounts(id), business_id TEXT NOT NULL,
 signature TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL,
 approved_by TEXT, attempt_token TEXT, created_at TEXT NOT NULL, attempted_at TEXT, finished_at TEXT, message TEXT NOT NULL DEFAULT ''
);
CREATE INDEX ad_report_date ON ad_reports(account_id,day);
CREATE INDEX ad_change_scope ON ad_changes(business_id,created_at);
