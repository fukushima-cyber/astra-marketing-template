ALTER TABLE businesses ADD COLUMN archived_at TEXT;
CREATE INDEX businesses_active_kind ON businesses(company_id,kind,archived_at,created_at);
