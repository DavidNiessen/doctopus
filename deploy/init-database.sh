#!/bin/sh
set -eu
# Docker invokes this only when initializing an empty PostgreSQL data volume.
owner_password=$(cat /run/secrets/owner_password)
runtime_password=$(cat /run/secrets/runtime_password)
# Passwords are supplied through stdin and escaped as SQL literals, never CLI args.
owner_password=$(printf '%s' "$owner_password" | sed "s/'/''/g")
runtime_password=$(printf '%s' "$runtime_password" | sed "s/'/''/g")
psql --username "$POSTGRES_USER" --dbname doctopus --set ON_ERROR_STOP=1 <<SQL
CREATE ROLE doctopus_owner LOGIN PASSWORD '$owner_password';
CREATE ROLE doctopus_runtime LOGIN PASSWORD '$runtime_password';
ALTER DATABASE doctopus OWNER TO doctopus_owner;
ALTER SCHEMA public OWNER TO doctopus_owner;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
SQL
