-- SEIP database bootstrap — ADR-0012 §4. Run ONCE per database by the platform
-- administrator (RDS master user, or the `postgres` superuser in Docker/CI).
-- Everything after this runs WITHOUT superuser:
--   seip_migrator  owns the schema; `prisma migrate deploy` connects as it
--   seip_app       the API/worker role; DML only, owns nothing
-- Neither role is SUPERUSER or BYPASSRLS, so a migration that only works under a
-- superuser fails in CI instead of on the first real deployment (the MySQL
-- ERROR 1419 lesson, ADR-0012 Context).
--
-- psql variables (defaults are the dev/CI values — override in any real env):
--   psql -v migrator_password=... -v app_password=... -v db=seip -f bootstrap-roles.sql
\if :{?migrator_password} \else \set migrator_password 'seip_migrator_dev' \endif
\if :{?app_password} \else \set app_password 'seip_app_dev' \endif
\if :{?db} \else \set db 'seip' \endif

SELECT 'CREATE ROLE seip_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seip_migrator') \gexec
SELECT 'CREATE ROLE seip_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seip_app') \gexec
ALTER ROLE seip_migrator PASSWORD :'migrator_password';
ALTER ROLE seip_app PASSWORD :'app_password';

ALTER DATABASE :"db" OWNER TO seip_migrator;
\connect :"db"
ALTER SCHEMA public OWNER TO seip_migrator;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO seip_app;

-- pgvector is not a trusted extension, so the administrator creates it here.
CREATE EXTENSION IF NOT EXISTS vector;

-- Tables the migrator creates later are usable by the app without a GRANT per
-- migration. Narrower revokes (audit_event) live in the migrations themselves.
ALTER DEFAULT PRIVILEGES FOR ROLE seip_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO seip_app;
ALTER DEFAULT PRIVILEGES FOR ROLE seip_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO seip_app;
