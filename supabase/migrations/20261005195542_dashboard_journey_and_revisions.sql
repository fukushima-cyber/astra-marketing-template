SET search_path=astra,public;
CREATE TABLE astra.journey_events (
 id text PRIMARY KEY, business_id text NOT NULL REFERENCES astra.businesses(id), project_id text NOT NULL,
 source_id text NOT NULL, external_id text NOT NULL, day text NOT NULL, lead_id text NOT NULL,
 signature text NOT NULL, data text NOT NULL, supersedes text,
 UNIQUE(business_id,source_id,external_id), UNIQUE(supersedes),
 FOREIGN KEY(supersedes) REFERENCES astra.journey_events(id)
);
CREATE INDEX journey_events_scope_day ON astra.journey_events(business_id,day,project_id);
CREATE INDEX journey_events_scope_lead ON astra.journey_events(business_id,lead_id);
CREATE TABLE astra.document_revisions(document_id text NOT NULL,version bigint NOT NULL,data text NOT NULL,at text NOT NULL,PRIMARY KEY(document_id,version));
CREATE OR REPLACE FUNCTION astra.record_document_revision() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=astra,pg_temp AS $$
BEGIN
 IF NEW.data <> 'null' THEN
 INSERT INTO astra.document_revisions VALUES(NEW.id,NEW.version,NEW.data,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION astra.record_document_revision() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION astra.record_document_revision() TO astra_runtime;
CREATE TRIGGER astra_record_revision AFTER INSERT OR UPDATE ON astra.documents FOR EACH ROW EXECUTE FUNCTION astra.record_document_revision();
INSERT INTO astra.document_revisions SELECT id,version,data,to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') FROM astra.documents WHERE data <> 'null' ON CONFLICT DO NOTHING;
ALTER TABLE astra.journey_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE astra.document_revisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY application_read ON astra.journey_events FOR SELECT TO astra_runtime USING(true);
CREATE POLICY application_insert ON astra.journey_events FOR INSERT TO astra_runtime WITH CHECK(true);
CREATE POLICY application_read ON astra.document_revisions FOR SELECT TO astra_runtime USING(true);
CREATE POLICY application_insert ON astra.document_revisions FOR INSERT TO astra_runtime WITH CHECK(true);
REVOKE ALL ON astra.journey_events,astra.document_revisions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON astra.journey_events,astra.document_revisions TO astra_runtime;
RESET search_path;
