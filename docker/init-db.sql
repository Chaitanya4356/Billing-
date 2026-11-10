-- Runs once on first container start. The `billing` database is created by
-- POSTGRES_DB in docker-compose.yml; this adds the integration/e2e test database.
CREATE DATABASE billing_test;
