CREATE TABLE businesses(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
INSERT INTO businesses(id,name,created_at) VALUES('default','最初の事業',datetime('now'));
ALTER TABLE analytics_imports ADD COLUMN business_id TEXT NOT NULL DEFAULT 'default';
CREATE TABLE analytics_rows_scoped(
 id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, project_id TEXT NOT NULL,
 date TEXT NOT NULL, data TEXT NOT NULL, import_id TEXT NOT NULL REFERENCES analytics_imports(id),
 business_id TEXT NOT NULL REFERENCES businesses(id), UNIQUE(business_id,source,external_id)
);
INSERT INTO analytics_rows_scoped(id,source,external_id,project_id,date,data,import_id,business_id)
 SELECT id,source,external_id,project_id,date,data,import_id,'default' FROM analytics_rows;
DROP TABLE analytics_rows;
ALTER TABLE analytics_rows_scoped RENAME TO analytics_rows;
CREATE INDEX analytics_business_date ON analytics_rows(business_id,date,id);
CREATE TABLE native_connections(
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), provider TEXT NOT NULL,
 label TEXT NOT NULL, external_id TEXT NOT NULL, credential TEXT NOT NULL, targets TEXT NOT NULL DEFAULT '[]',
 enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_attempt TEXT, last_success TEXT, last_error TEXT,
 UNIQUE(business_id,provider,external_id)
);
CREATE TABLE native_snapshots(
 business_id TEXT NOT NULL REFERENCES businesses(id), connection_id TEXT NOT NULL REFERENCES native_connections(id),
 resource_id TEXT NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, collected_at TEXT NOT NULL,
 PRIMARY KEY(connection_id,resource_id,day)
);
CREATE INDEX native_business_day ON native_snapshots(business_id,day);
