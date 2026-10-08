-- Private application data. No anonymous or browser database access.

CREATE SCHEMA astra;

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;

DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='astra_runtime') THEN CREATE ROLE astra_runtime NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS; END IF; END $$;

REVOKE ALL ON SCHEMA astra FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA astra, extensions TO astra_runtime;

ALTER ROLE astra_runtime SET search_path=astra,extensions,pg_catalog;

SET search_path = astra, pg_catalog, extensions;

CREATE TABLE analytics_imports (id TEXT PRIMARY KEY, signature TEXT NOT NULL, created_at TEXT NOT NULL, count BIGINT NOT NULL, business_id TEXT NOT NULL DEFAULT 'default');

CREATE TABLE businesses(id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, company_id TEXT NOT NULL DEFAULT 'company' CHECK(company_id='company'), kind TEXT NOT NULL DEFAULT 'content' CHECK(kind IN ('content','affiliate')), archived_at TEXT, revenue_models TEXT NOT NULL DEFAULT '[]', acquisition_channels TEXT NOT NULL DEFAULT '[]', profile_version BIGINT NOT NULL DEFAULT 0);

CREATE TABLE companies(id TEXT PRIMARY KEY, name TEXT NOT NULL);

CREATE TABLE documents (id TEXT PRIMARY KEY, version BIGINT NOT NULL, data TEXT NOT NULL, last_request TEXT NOT NULL);

CREATE TABLE login_limits (id TEXT PRIMARY KEY, attempts BIGINT NOT NULL, expires BIGINT NOT NULL);

CREATE TABLE receipts (id TEXT PRIMARY KEY, signature TEXT NOT NULL, document_id TEXT NOT NULL);

CREATE TABLE ad_accounts (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), provider TEXT NOT NULL,
 external_id TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL, timezone TEXT NOT NULL,
 credential TEXT NOT NULL, policy TEXT NOT NULL, version BIGINT NOT NULL DEFAULT 1,
 busy_id TEXT, last_sync TEXT, created_at TEXT NOT NULL, UNIQUE(provider,external_id)
);

CREATE TABLE ad_reporting_connections (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id),
 provider TEXT NOT NULL CHECK(provider IN ('google','line','meta','x','tiktok','chatgpt')),
 external_id TEXT NOT NULL, name TEXT NOT NULL, currency TEXT NOT NULL, timezone TEXT NOT NULL,
 credential TEXT NOT NULL, created_at TEXT NOT NULL, last_sync TEXT, last_error TEXT,
 busy_id TEXT, busy_until TEXT, UNIQUE(provider,external_id)
);

CREATE TABLE "analytics_rows"(
 id TEXT PRIMARY KEY, source TEXT NOT NULL, external_id TEXT NOT NULL, project_id TEXT NOT NULL,
 date TEXT NOT NULL, data TEXT NOT NULL, import_id TEXT NOT NULL REFERENCES analytics_imports(id),
 business_id TEXT NOT NULL REFERENCES businesses(id), UNIQUE(business_id,source,external_id)
);

CREATE TABLE audit_events(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), actor_id TEXT, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE TABLE autonomy_jobs (
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), status TEXT NOT NULL,
 policy_version BIGINT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE native_connections(
 id TEXT PRIMARY KEY, business_id TEXT NOT NULL REFERENCES businesses(id), provider TEXT NOT NULL,
 label TEXT NOT NULL, external_id TEXT NOT NULL, credential TEXT NOT NULL, targets TEXT NOT NULL DEFAULT '[]',
 enabled BIGINT NOT NULL DEFAULT 1, created_at TEXT NOT NULL, last_attempt TEXT, last_success TEXT, last_error TEXT,
 UNIQUE(business_id,provider,external_id)
);

CREATE TABLE users(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), email extensions.citext NOT NULL UNIQUE,
 name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','member')),
 active BIGINT NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version BIGINT NOT NULL DEFAULT 1, created_at TEXT NOT NULL
, mutation_id TEXT NOT NULL DEFAULT '', google_sub TEXT, google_linked_at TEXT);

CREATE TABLE access_grants(
 user_id TEXT NOT NULL REFERENCES users(id), business_id TEXT NOT NULL REFERENCES businesses(id),
 page TEXT NOT NULL, edit BIGINT NOT NULL DEFAULT 0, projects TEXT NOT NULL DEFAULT 'null',
 PRIMARY KEY(user_id,business_id,page)
);

CREATE TABLE ad_changes (
 id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES ad_accounts(id), business_id TEXT NOT NULL,
 signature TEXT NOT NULL, data TEXT NOT NULL, status TEXT NOT NULL, created_by TEXT NOT NULL,
 approved_by TEXT, attempt_token TEXT, created_at TEXT NOT NULL, attempted_at TEXT, finished_at TEXT, message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE ad_entities (
 account_id TEXT NOT NULL REFERENCES ad_accounts(id), id TEXT NOT NULL, level TEXT NOT NULL,
 data TEXT NOT NULL, PRIMARY KEY(account_id,id)
);

CREATE TABLE ad_reporting_days (
 connection_id TEXT NOT NULL REFERENCES ad_reporting_connections(id), day TEXT NOT NULL,
 data TEXT NOT NULL, collected_at TEXT NOT NULL, PRIMARY KEY(connection_id,day)
);

CREATE TABLE ad_reports (
 account_id TEXT NOT NULL REFERENCES ad_accounts(id), ad_id TEXT NOT NULL, day TEXT NOT NULL,
 data TEXT NOT NULL, collected_at TEXT NOT NULL, PRIMARY KEY(account_id,ad_id,day)
);

CREATE TABLE autonomy_actions (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES autonomy_jobs(id), name TEXT NOT NULL,
 status TEXT NOT NULL, prepared TEXT NOT NULL DEFAULT '', result TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE autonomy_settings (
 business_id TEXT PRIMARY KEY REFERENCES businesses(id), owner_id TEXT NOT NULL REFERENCES users(id),
 version BIGINT NOT NULL, policy TEXT NOT NULL, next_at BIGINT, lease TEXT, lease_until BIGINT,
 model TEXT NOT NULL DEFAULT '', credential TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);

CREATE TABLE invitations(
 token_hash TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES companies(id), email extensions.citext,
 role TEXT NOT NULL CHECK(role IN ('owner','member')), grants TEXT NOT NULL DEFAULT '[]',
 kind TEXT NOT NULL DEFAULT 'enroll' CHECK(kind IN ('enroll','reset')), target_id TEXT REFERENCES users(id),
 expires BIGINT NOT NULL, created_by TEXT REFERENCES users(id), used_by TEXT REFERENCES users(id), revoked BIGINT NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);

CREATE TABLE native_snapshots(
 business_id TEXT NOT NULL REFERENCES businesses(id), connection_id TEXT NOT NULL REFERENCES native_connections(id),
 resource_id TEXT NOT NULL, day TEXT NOT NULL, data TEXT NOT NULL, collected_at TEXT NOT NULL,
 PRIMARY KEY(connection_id,resource_id,day)
);

CREATE TABLE user_sessions(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), version BIGINT NOT NULL, expires BIGINT NOT NULL);

CREATE TABLE oauth_states(
 state_hash TEXT PRIMARY KEY,
 nonce TEXT NOT NULL,
 expires BIGINT NOT NULL
, invite_hash TEXT REFERENCES invitations(token_hash));

CREATE INDEX analytics_period ON analytics_rows(date,project_id,id);

CREATE INDEX analytics_business_date ON analytics_rows(business_id,date,id);

CREATE INDEX native_business_day ON native_snapshots(business_id,day);

CREATE UNIQUE INDEX one_company_owner ON users(company_id) WHERE role='owner';

CREATE INDEX sessions_expiry ON user_sessions(expires);

CREATE INDEX audit_time ON audit_events(company_id,created_at);

CREATE INDEX ad_report_date ON ad_reports(account_id,day);

CREATE INDEX ad_change_scope ON ad_changes(business_id,created_at);

CREATE UNIQUE INDEX autonomy_one_running ON autonomy_jobs(business_id) WHERE status='running';

CREATE INDEX autonomy_job_scope ON autonomy_jobs(business_id,created_at);

CREATE INDEX businesses_active_kind ON businesses(company_id,kind,archived_at,created_at);

CREATE UNIQUE INDEX users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

CREATE INDEX oauth_states_expiry ON oauth_states(expires);

CREATE INDEX ad_reporting_business ON ad_reporting_connections(business_id);

CREATE TABLE scheduler_state(id TEXT PRIMARY KEY, scope TEXT NOT NULL, last_error TEXT, updated_at BIGINT NOT NULL);

CREATE FUNCTION astra.json_each(source TEXT) RETURNS TABLE(value TEXT) LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path=pg_catalog AS $$ SELECT CASE WHEN jsonb_typeof(item)='string' THEN item #>> '{}' ELSE item::text END FROM jsonb_array_elements(CASE WHEN jsonb_typeof(source::jsonb)='array' THEN source::jsonb ELSE '[]'::jsonb END) AS item $$;

CREATE FUNCTION astra.preserve_owner() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $$ BEGIN IF OLD.role='owner' AND (TG_OP='DELETE' OR NEW.role <> 'owner' OR NEW.active <> 1 OR NEW.company_id <> OLD.company_id) THEN RAISE EXCEPTION 'owner cannot be removed'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;

CREATE TRIGGER preserve_owner BEFORE UPDATE OR DELETE ON astra.users FOR EACH ROW EXECUTE FUNCTION astra.preserve_owner();

ALTER TABLE astra.analytics_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.analytics_imports FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.businesses ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.businesses FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.companies FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.documents FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.login_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.login_limits FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.receipts FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.ad_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.ad_accounts FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.ad_reporting_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.ad_reporting_connections FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.analytics_rows ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.analytics_rows FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.audit_events FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.autonomy_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.autonomy_jobs FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.native_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.native_connections FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.users FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.access_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.access_grants FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.ad_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.ad_changes FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.ad_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.ad_entities FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.ad_reporting_days ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.ad_reporting_days FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.ad_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.ad_reports FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.autonomy_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.autonomy_actions FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.autonomy_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.autonomy_settings FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.invitations ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.invitations FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.native_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.native_snapshots FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.user_sessions FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.oauth_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.oauth_states FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

ALTER TABLE astra.scheduler_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY application_server ON astra.scheduler_state FOR ALL TO astra_runtime USING (true) WITH CHECK (true);

REVOKE ALL ON ALL TABLES IN SCHEMA astra FROM PUBLIC, anon, authenticated;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA astra FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA astra TO astra_runtime;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA astra TO astra_runtime;

ALTER DEFAULT PRIVILEGES IN SCHEMA astra REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA astra REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

RESET search_path;
