-- Ensure we are connected to the default postgres database before creating new databases
\c postgres

-- Create the 'username' role with a password if it doesn't exist
SELECT 'CREATE ROLE username WITH LOGIN PASSWORD ''password'''
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'username')\gexec

-- Create the 'agenta_oss' database if it doesn't exist
SELECT 'CREATE DATABASE agenta_oss'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'agenta_oss')\gexec

-- Create the 'supertokens_oss' database if it doesn't exist
SELECT 'CREATE DATABASE supertokens_oss'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'supertokens_oss')\gexec

-- Grant necessary permissions to 'username' for both databases
GRANT ALL PRIVILEGES ON DATABASE agenta_oss TO username;
GRANT ALL PRIVILEGES ON DATABASE supertokens_oss TO username;

-- Switch to 'agenta_oss' and grant schema permissions
\c agenta_oss
GRANT ALL ON SCHEMA public TO username;

-- Switch to 'supertokens_oss' and grant schema permissions
\c supertokens_oss
GRANT ALL ON SCHEMA public TO username;

-- Return to postgres
\c postgres
