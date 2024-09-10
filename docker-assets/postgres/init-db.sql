DO $$ 
BEGIN
   IF NOT EXISTS (
      SELECT 
      FROM   pg_catalog.pg_database 
      WHERE  datname = 'agenta_oss') THEN
      CREATE DATABASE agenta_oss;
   END IF;
END
$$;

-- Create the username role with a password
DO $$
BEGIN
   IF NOT EXISTS (
      SELECT 
      FROM   pg_catalog.pg_roles 
      WHERE  rolname = 'username') THEN
      CREATE ROLE username WITH LOGIN PASSWORD 'password';
   END IF;
END
$$;

-- Grant necessary permissions to username
GRANT ALL PRIVILEGES ON DATABASE agenta_oss TO username;

-- Connect to the agenta_oss database
\c agenta_oss

-- Grant schema permissions to username
GRANT ALL ON SCHEMA public TO username;
