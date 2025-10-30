# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agenta is an open-source LLMOps platform for building production-grade LLM applications. It provides integrated prompt management, evaluation, and observability features.

**This is a self-hosted OSS deployment** running in production at https://agenta.bravetech.io

**Key components:**
- **Web (Next.js 15):** React frontend
- **API (FastAPI):** Python backend
- **SDK (Python):** Client library for integrating Agenta into LLM applications
- **Services:** Completion and chat services for LLM interactions

## Repository Structure

```
agenta/
├── api/              # FastAPI backend
│   ├── oss/         # Open-source API implementation
│   └── entrypoint.py
├── web/              # Next.js frontend (pnpm monorepo)
│   ├── oss/         # Open-source web app
│   └── package.json # Workspace root
├── sdk/              # Python SDK for Agenta
├── services/         # Completion and chat services
├── hosting/          # Docker Compose deployment configs
│   └── docker-compose/
│       └── oss/     # Self-hosted deployment files
└── examples/         # Example applications
```

## Production Deployment

**Live Instance:** https://agenta.bravetech.io

**Server Details:**
- **Provider:** Hetzner CX23
- **IP:** 91.98.229.196
- **Location:** Nuremberg, Germany
- **Resources:** 2 vCPUs, 4GB RAM, 40GB SSD + 10GB Volume
- **OS:** Ubuntu 24.04 LTS

**Deployment Path:** `/opt/agenta`

**Configuration:**
- Docker Compose file: `docker-compose.gh.ssl.yml`
- Environment file: `.env.oss.gh`
- SSL: Automatic via Traefik + Let's Encrypt
- Reverse Proxy: Traefik (handles HTTPS, routing)

## Development Setup Commands

### Prerequisites
- Node.js >=18
- Python ^3.11 (API) / ^3.9 (SDK)
- Docker and Docker Compose
- pnpm 10.4.1 (web)
- Poetry (backend)

### Running Locally with Docker

**Start the full stack:**
```bash
docker compose -f hosting/docker-compose/oss/docker-compose.gh.yml \
  --env-file hosting/docker-compose/oss/.env.oss.gh \
  --profile with-web --profile with-traefik up -d
```

Access at `http://localhost`

**Start with SSL (production-like):**
```bash
docker compose -f hosting/docker-compose/oss/docker-compose.gh.ssl.yml \
  --env-file hosting/docker-compose/oss/.env.oss.gh \
  --profile with-web --profile with-traefik up -d
```

### Frontend (Web) Development

**Navigate to web directory:**
```bash
cd web
```

**Install dependencies:**
```bash
pnpm install
```

**Development:**
```bash
pnpm dev-oss
```

**Build:**
```bash
pnpm build-oss
```

**Linting:**
```bash
pnpm lint              # Check for issues
pnpm lint-fix          # Auto-fix issues
```

**Formatting:**
```bash
pnpm format            # Check formatting
pnpm format-fix        # Auto-fix formatting
```

**Tests (Data Layer):**
```bash
pnpm test:datalayer                    # Run all data layer tests
pnpm test:apps                         # Test apps
pnpm test:environments                 # Test environments
pnpm test:deployments                  # Test deployments
pnpm test:newPlayground                # Test playground
pnpm test:observability                # Test observability
```

**Regenerate Tailwind tokens (after updating Ant Design theme):**
```bash
pnpm generate:tailwind-tokens
```

### Backend (API) Development

**Navigate to API directory:**
```bash
cd api
```

**Install dependencies:**
```bash
poetry install
```

**Run tests:**
```bash
python run-tests.py --license oss --coverage smoke
# Options: --coverage [smoke]
# See pytest.ini for custom markers
```

**Formatting:**
```bash
black .               # Format code
```

**Run development server (requires database):**
```bash
uvicorn entrypoint:app --host 0.0.0.0 --port 8000 --reload --root-path /api
```

### SDK Development

**Navigate to SDK directory:**
```bash
cd sdk
```

**Install dependencies:**
```bash
poetry install
```

**Run tests:**
```bash
python run-tests.py
```

**Formatting:**
```bash
black .
```

### Database Migrations

**Alembic is used for database migrations:**

Migrations are located in:
- `api/oss/databases/postgres/migrations/core/`
- `api/oss/databases/postgres/migrations/tracing/`

**Auto-migrations are enabled by default** via `AGENTA_AUTO_MIGRATIONS=true` in the environment.

## Architecture

### Monorepo Structure
The project uses two monorepos:
1. **Web (pnpm workspaces):** Frontend packages and shared components
2. **API/SDK (Poetry):** Python packages for backend and SDK

### Web Architecture (Frontend)

**Technology Stack:**
- Next.js 15 with App Router (migrating from Pages Router)
- React 19
- TypeScript
- Ant Design 5 (UI components)
- TailwindCSS (styling)
- Jotai (state management)
- SWR (data fetching)

**Module-Based Organization:**
- Each feature/page is a "module" with its own components, hooks, and state
- Shared code is elevated to root-level directories
- Components follow a hierarchical structure (component → assets → hooks)

**State Management:**
- **Local state:** For UI-only concerns
- **Jotai atoms:** For reactive state within and across components
- **Context:** For complex state with multiple consumers
- Global state lives in `web/oss/src/state/`
- Module-specific state lives in `web/oss/src/modules/[module]/store/`

**Data Fetching Best Practices:**
- Use SWR with Axios (configured globally)
- Avoid useEffect patterns for data fetching
- Use `useSWRMutation` for mutations
- Axios instance configured at `web/oss/src/lib/helpers/axios`

### API Architecture (Backend)

**Technology Stack:**
- FastAPI (web framework)
- SQLAlchemy 2.0 + asyncpg (async ORM)
- Alembic (migrations)
- Redis (caching)
- RabbitMQ + Celery (task queue)
- SuperTokens (authentication)
- LiteLLM (LLM provider abstraction)
- OpenTelemetry (observability/tracing)

**Structure:**
- `api/oss/src/routers/` - API route handlers
- `api/oss/src/services/` - Business logic
- `api/oss/src/models/` - Data models (Pydantic/SQLAlchemy)
- `api/oss/src/core/` - Core utilities and configurations
- `api/oss/src/dbs/` - Database connections
- `api/oss/src/utils/` - Utility functions

**Databases:**
- **PostgreSQL Core:** Main application database
- **PostgreSQL Tracing:** Observability/tracing data
- **PostgreSQL SuperTokens:** Authentication data
- **Redis:** Caching and Celery result backend
- **RabbitMQ:** Celery broker

### SDK Architecture

The Python SDK provides:
- Decorators for instrumenting LLM applications (`@agenta.instrument()`)
- Configuration management for prompts
- Tracing and observability integration (OpenTelemetry)
- Client for interacting with Agenta API

## Code Quality Standards

### Frontend
- **Linting:** ESLint (Next.js config)
- **Formatting:** Prettier
- **Type checking:** TypeScript strict mode
- Run `pnpm format-fix` before committing
- Avoid inline array props with JSX content (use `useMemo`)
- Prefer Jotai atoms over Context for simple state

### Backend
- **Formatting:** Black (89 line length)
- **Type hints:** Use Python type hints
- Run `black .` in `api/` or `sdk/` before committing
- Follow FastAPI best practices for async/await

## Testing

### Backend Tests (Pytest)

Tests use custom markers (defined in `api/pytest.ini`):
- **Coverage:** `smoke`, `full`
- **Lens:** `functional`, `performance`, `security`
- **Plan:** `hobby`, `pro`, `business`, `enterprise`
- **Role:** `owner`, `admin`, `editor`, `viewer`
- **Path:** `happy` (desired), `grumpy` (undesired)
- **Case:** `typical`, `edge`
- **Speed:** `fast`, `slow`

**Run tests:**
```bash
cd api
python run-tests.py --license oss --coverage smoke
```

### Frontend Tests

Data layer tests are located in `web/oss/tests/datalayer/`.

**Note:** Full test suite is currently being refactored.

## Common Workflows

### Making Changes to Frontend
1. Make changes in `web/oss/src/`
2. Run `pnpm format-fix` in `web/`
3. Run `pnpm lint-fix` to fix linting issues
4. If updating Ant Design tokens, run `pnpm generate:tailwind-tokens`
5. Test changes locally with `pnpm dev-oss`

### Making Changes to Backend/SDK
1. Make changes in `api/` or `sdk/`
2. Run `black .` in the appropriate directory
3. Add/update tests if needed
4. Run tests with `python run-tests.py`

### Creating Database Migrations
1. Navigate to `api/`
2. Modify SQLAlchemy models in `api/oss/src/models/`
3. Generate migration:
   ```bash
   # For core database
   alembic -c oss/databases/postgres/migrations/core/alembic.ini revision --autogenerate -m "description"

   # For tracing database
   alembic -c oss/databases/postgres/migrations/tracing/alembic.ini revision --autogenerate -m "description"
   ```
4. Review and edit generated migration file
5. Auto-migrations will apply on next API startup (or run manually via alembic)

### Adding a New Route
1. Create route handler in `api/oss/src/routers/`
2. Implement business logic in `api/oss/src/services/`
3. Define request/response models in `api/oss/src/models/`
4. Register router in `api/oss/src/__init__.py`
5. Add tests in `api/oss/tests/pytest/`

### Adding a New Frontend Module
1. Create module directory: `web/oss/src/modules/[ModuleName]/`
2. Add module-specific components, hooks, and state
3. Create module entry point: `[ModuleName].tsx`
4. If state is shared across modules, move it to `web/oss/src/state/`
5. If components are reusable, move them to `web/oss/src/components/`

## Environment Variables

Key environment variables (see `hosting/docker-compose/oss/env.oss.gh.example`):

**Core:**
- `AGENTA_LICENSE=oss` - License type (always oss)
- `AGENTA_API_URL` - API base URL (production: https://agenta.bravetech.io/api)
- `AGENTA_WEB_URL` - Web app base URL (production: https://agenta.bravetech.io)
- `AGENTA_AUTH_KEY` - Authentication key
- `AGENTA_CRYPT_KEY` - Encryption key
- `AGENTA_AUTO_MIGRATIONS` - Auto-run database migrations (true/false)

**Database:**
- `POSTGRES_URI_CORE` - Core database connection string
- `POSTGRES_URI_TRACING` - Tracing database connection string
- `POSTGRES_URI_SUPERTOKENS` - SuperTokens database connection string

**Caching & Queue:**
- `REDIS_URL` - Redis connection string
- `CELERY_BROKER_URL` - RabbitMQ broker URL
- `CELERY_RESULT_BACKEND` - Celery result backend (Redis)

**Traefik (Reverse Proxy):**
- `TRAEFIK_DOMAIN` - Domain name (production: agenta.bravetech.io)
- `TRAEFIK_PORT` - HTTP port (80)
- `TRAEFIK_HTTPS_PORT` - HTTPS port (443)
- `TRAEFIK_PROTOCOL` - Protocol (http/https)
- `TRAEFIK_UI_PORT` - Dashboard port (8080)

## Production Management

### Connecting to Production Server

**SSH Access:**
```bash
ssh root@91.98.229.196
```

**Navigate to deployment:**
```bash
cd /opt/agenta/hosting/docker-compose/oss
```

### Managing Production Services

**Check status:**
```bash
docker compose -f docker-compose.gh.ssl.yml ps
```

**View logs:**
```bash
docker compose -f docker-compose.gh.ssl.yml logs -f
docker compose -f docker-compose.gh.ssl.yml logs -f api    # API only
docker compose -f docker-compose.gh.ssl.yml logs -f web    # Web only
```

**Restart services:**
```bash
docker compose -f docker-compose.gh.ssl.yml restart
docker compose -f docker-compose.gh.ssl.yml restart api    # API only
```

**Update to latest version:**
```bash
cd /opt/agenta
git pull origin main
cd hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml pull
docker compose -f docker-compose.gh.ssl.yml up -d
```

### Database Backup

**Create backup:**
```bash
cd /opt/agenta/hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml exec postgres \
  pg_dumpall -U agenta_admin > /root/backups/agenta_backup_$(date +%Y%m%d).sql
```

### Monitoring

**Check resources:**
```bash
docker stats                    # Live container stats
free -h                        # Memory usage
df -h                          # Disk usage
```

**Health checks:**
```bash
curl https://agenta.bravetech.io/api/health
curl -I https://agenta.bravetech.io/
```

### Querying Production Database

**Database query tools are available in `scripts/db/`** for querying the production database from your local machine without SSH/Docker complexity.

**Quick query script:**
```bash
cd scripts/db

# Query core database (apps, users, projects)
./agenta-db-query.sh core "SELECT COUNT(*) FROM app_db;"

# Query tracing database (observability data)
./agenta-db-query.sh tracing "SELECT tree_id, created_at FROM nodes ORDER BY created_at DESC LIMIT 5;"

# List all tables
./agenta-db-query.sh core "\dt"
```

**Interactive menu with common queries:**
```bash
cd scripts/db
./agenta-quick-queries.sh
```

**Available databases:**
- `core` - Application data (apps, users, projects)
- `tracing` - Observability data (traces, spans, nodes)
- `supertokens` - Authentication data

**Common queries:**
```bash
# List all applications
./agenta-db-query.sh core "SELECT app_name, created_at FROM app_db ORDER BY created_at DESC;"

# Recent traces for a specific app
./agenta-db-query.sh tracing "
SELECT tree_id, node_name, created_at
FROM nodes
WHERE refs->>'application.slug' = 'your-app-name'
ORDER BY created_at DESC
LIMIT 20;"

# Count traces in last 24 hours
./agenta-db-query.sh tracing "
SELECT COUNT(DISTINCT tree_id) as traces_24h
FROM nodes
WHERE created_at > NOW() - INTERVAL '24 hours';"
```

**For more query examples and detailed documentation, see:**
- `scripts/db/README-AGENTA-DB.md` - Complete usage guide
- `scripts/db/agenta-sql-snippets.md` - SQL query reference library

### Important Notes

### Web Workspaces
The web directory uses pnpm workspaces:
- `@agenta/oss` - Main web application
- `@agenta/web-tests` - Shared tests
- Shared dependencies managed at workspace root

### API/SDK Poetry
Both API and SDK use Poetry for dependency management. They are independent packages but share similar structure.

### LLM Provider Support
The platform uses LiteLLM (v1.76.0) for unified access to 50+ LLM providers (OpenAI, Anthropic, etc.).

### Observability
Built-in OpenTelemetry support for tracing LLM applications. Compatible with OpenLLMetry and OpenInference standards.

## Useful Resources

- **Production Instance:** https://agenta.bravetech.io
- **Production API:** https://agenta.bravetech.io/api/docs
- **Upstream Documentation:** https://docs.agenta.ai
- **Architecture Guide:** https://docs.agenta.ai/guides/how_does_agenta_work
- **Self-hosting Guide:** https://docs.agenta.ai/self-host/quick-start
- **Deployment Documentation:** See `README_DEPLOYMENT.md` in this repository
