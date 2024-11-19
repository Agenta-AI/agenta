#!/bin/bash
set -e

# Restart docker compose without agenta-web
docker compose -f docker-compose.yml down
WEBSITE_DOMAIN_NAME=http://localhost:3000 docker compose -p agenta-oss -f docker-compose.yml up -d --build --no-deps $(docker compose -f docker-compose.yml config --services | grep -v agenta-web)

cd agenta-web
npm run dev:local
