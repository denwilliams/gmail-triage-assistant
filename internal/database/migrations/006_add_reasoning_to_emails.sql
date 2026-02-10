-- Add AI reasoning field to emails table
ALTER TABLE emails ADD COLUMN IF NOT EXISTS reasoning TEXT NOT NULL DEFAULT '';
