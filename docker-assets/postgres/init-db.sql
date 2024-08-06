-- Create the username role with a password
CREATE ROLE username WITH LOGIN PASSWORD 'password';

-- Grant necessary permissions to username
GRANT ALL PRIVILEGES ON DATABASE agenta_oss TO username;

-- Connect to the agenta_oss database
\c agenta_oss

-- Grant schema permissions to username
GRANT ALL ON SCHEMA public TO username;