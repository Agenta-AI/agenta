DO $$ 
BEGIN
   IF NOT EXISTS (
      SELECT 
      FROM   pg_catalog.pg_database 
      WHERE  datname = 'agenta_cloud_dev') THEN
      CREATE DATABASE agenta_cloud_dev;
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
GRANT ALL PRIVILEGES ON DATABASE agenta_cloud_dev TO username;

-- Connect to the agenta_cloud_dev database
\c agenta_cloud_dev

-- Grant schema permissions to username
GRANT ALL ON SCHEMA public TO username;
