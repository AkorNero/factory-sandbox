-- 0003 Tombstones for the upload endpoint: a DELETE hard-deletes the row and writes its id here, so a PUT or PATCH
-- that is resent afterwards cannot bring the row back ("deletes win over updates", and operations may be resent).
-- Internal: not synced to devices (the sync stream lists its tables) and not reachable through the upload endpoint.
CREATE TABLE IF NOT EXISTS deleted_rows (
  table_name text NOT NULL,
  id         text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (table_name, id)
);
