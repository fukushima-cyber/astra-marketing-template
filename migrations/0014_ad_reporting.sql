CREATE TABLE ad_reporting_connections (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
 provider TEXT NOT NULL CHECK(provider IN ('google','line','meta','x','tiktok','chatgpt')),
 external_id TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL, timezone TEXT NOT NULL,
 credential TEXT NOT NULL, created_at TEXT NOT NULL, last_sync TEXT, last_error TEXT,
 busy_id TEXT, busy_until TEXT, UNIQUE(provider,external_id)
);
CREATE INDEX ad_reporting_business ON ad_reporting_connections(business_id);
CREATE TABLE ad_reporting_days (
 connection_id TEXT NOT NULL REFERENCES ad_reporting_connections(id), day TEXT NOT NULL,
 data TEXT NOT NULL, collected_at TEXT NOT NULL, PRIMARY KEY(connection_id,day)
);
