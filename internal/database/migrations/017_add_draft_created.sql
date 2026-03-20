-- +migrate Up
ALTER TABLE emails ADD COLUMN draft_created BOOLEAN NOT NULL DEFAULT FALSE;

-- +migrate Down
ALTER TABLE emails DROP COLUMN draft_created;
