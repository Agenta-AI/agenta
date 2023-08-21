#!/bin/bash

# Generate the encryption key
ENCRYPTION_KEY=$(openssl rand -hex 16)
# Create a JSON file with the encryption key
echo "{\"encryption_key\": \"$ENCRYPTION_KEY\"}" > encryption_key.json
