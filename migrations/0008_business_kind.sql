ALTER TABLE businesses ADD COLUMN kind TEXT NOT NULL DEFAULT 'content' CHECK(kind IN ('content','affiliate'));
UPDATE businesses SET kind='affiliate' WHERE id='affiliate';
