-- Ensure we are connected to the default postgres database before creating new databases
\c postgres

-- Create the 'username' role with a password if it doesn't exist
SELECT 'CREATE ROLE username WITH LOGIN PASSWORD ''password'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'username')\gexec

-- Create the 'agenta_ee_core' database if it doesn't exist
SELECT 'CREATE DATABASE agenta_ee_core'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agenta_ee_core')\gexec

-- Create the 'agenta_ee_tracing' database if it doesn't exist
SELECT 'CREATE DATABASE agenta_ee_tracing'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agenta_ee_tracing')\gexec

-- Create the 'agenta_ee_supertokens' database if it doesn't exist
SELECT 'CREATE DATABASE agenta_ee_supertokens'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agenta_ee_supertokens')\gexec

-- Grant necessary permissions to 'username' for both databases
GRANT ALL PRIVILEGES ON DATABASE agenta_ee_core TO username;
GRANT ALL PRIVILEGES ON DATABASE agenta_ee_tracing TO username;
GRANT ALL PRIVILEGES ON DATABASE agenta_ee_supertokens TO username;


-- Switch to 'agenta_ee_core' and grant schema permissions
\c agenta_ee_core
GRANT ALL ON SCHEMA public TO username;

-- Switch to 'agenta_ee_tracing' and grant schema permissions
\c agenta_ee_tracing
GRANT ALL ON SCHEMA public TO username;

-- Switch to 'agenta_ee_supertokens' and grant schema permissions
\c agenta_ee_supertokens
GRANT ALL ON SCHEMA public TO username;

-- Return to postgres
\c postgres
