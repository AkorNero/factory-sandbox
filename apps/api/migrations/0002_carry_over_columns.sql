-- 0002 Carry-over (#29): two columns on tasks. A volume made from the #28 schema does not have them.
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS carried_on text;                -- the day the midnight job last carried it to; the overnight banner lists these
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS carried_from_event_id text;     -- the Event whose Placement Carry-over cleared: it keeps showing a missed slot
