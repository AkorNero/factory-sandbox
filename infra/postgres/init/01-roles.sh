#!/bin/sh
# Roles, the bucket-storage database and the logical-replication publication.
# Runs once, on an empty volume, before 02-schema.sql. Passwords come from the compose environment.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v storage_pw="$PS_STORAGE_PASSWORD" -v repl_pw="$PS_REPL_PASSWORD" -v api_pw="$API_DB_PASSWORD" <<'SQL'
-- PowerSync bucket storage: its own database and user (PowerSync creates its own schema in it).
CREATE USER powersync_storage_user WITH PASSWORD :'storage_pw';
CREATE DATABASE powersync_storage OWNER powersync_storage_user;

-- Replication role for the source database.
CREATE ROLE powersync_role WITH REPLICATION BYPASSRLS LOGIN PASSWORD :'repl_pw';

-- The Node API's role: read and write rows, nothing else.
CREATE ROLE api_user WITH LOGIN PASSWORD :'api_pw';

\connect dayplanner
-- 02-schema.sql creates the tables as postgres afterwards, so default privileges cover them.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO powersync_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO api_user;
GRANT USAGE ON SCHEMA public TO powersync_role, api_user;
-- The publication MUST be named "powersync".
CREATE PUBLICATION powersync FOR ALL TABLES;
SQL
