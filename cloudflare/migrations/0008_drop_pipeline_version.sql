-- The v1 single-stage processor has been removed; every user now goes through
-- the multi-stage pipeline. Drop the per-user toggle column.
ALTER TABLE users DROP COLUMN pipeline_version;
