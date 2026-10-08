ALTER TABLE businesses ADD COLUMN revenue_models TEXT NOT NULL DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN acquisition_channels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE businesses ADD COLUMN profile_version INTEGER NOT NULL DEFAULT 0;
-- Preserve the existing declared method; do not infer acquisition channels.
UPDATE businesses SET revenue_models = CASE WHEN kind = 'affiliate' THEN '["affiliate"]' ELSE '["content"]' END;
