-- Run only when creating a new empty installation. No user or activity records.
INSERT INTO astra.companies(id,name) VALUES('company','会社') ON CONFLICT DO NOTHING;
INSERT INTO astra.businesses(id,name,created_at) VALUES('default','最初の事業',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ON CONFLICT DO NOTHING;
