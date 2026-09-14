CREATE TABLE analytics_imports (id TEXT PRIMARY KEY, signature TEXT NOT NULL, created_at TEXT NOT NULL, count INTEGER NOT NULL);
CREATE TABLE analytics_rows (id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, project_id TEXT NOT NULL, date TEXT NOT NULL, data TEXT NOT NULL, import_id TEXT NOT NULL REFERENCES analytics_imports(id), UNIQUE(source, external_id));
CREATE INDEX analytics_period ON analytics_rows(date,project_id,id);
