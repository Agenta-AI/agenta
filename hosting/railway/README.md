# Deploy Agenta OSS on Railway

This directory contains configuration files for deploying Agenta OSS on [Railway](https://railway.app).

## Quick Start

### Option 1: Deploy via Railway Template (Coming Soon)

Once the Agenta Railway template is published, you can deploy with one click:

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/template/agenta-oss)

### Option 2: Manual Deployment

Follow the comprehensive guide in `/RAILWAY_DEPLOYMENT_GUIDE.md` at the root of this repository.

## Files in This Directory

- **`nginx.conf`** - Nginx configuration for Railway with private networking
- **`Dockerfile.nginx`** - Dockerfile for the Nginx reverse proxy service
- **`.env.railway.example`** - Example environment variables for Railway
- **`railway.toml.example`** - Example Railway config-as-code file
- **`README.md`** - This file

## Architecture Overview

```
Internet
   ↓
Railway Public Domain (*.up.railway.app)
   ↓
Nginx Service (public)
   ↓
┌──────────────────────────────────────┐
│  Railway Private Network (IPv6)      │
│                                      │
│  ┌─────────┐  ┌─────────┐          │
│  │   Web   │  │   API   │          │
│  │  :3000  │  │  :8000  │          │
│  └─────────┘  └─────────┘          │
│                                      │
│  ┌───────────┐  ┌───────────┐      │
│  │Completion │  │   Chat    │      │
│  │   :80     │  │   :80     │      │
│  └───────────┘  └───────────┘      │
│                                      │
│  ┌──────────┐  ┌──────────┐        │
│  │ Postgres │  │ RabbitMQ │        │
│  │  :5432   │  │  :5672   │        │
│  └──────────┘  └──────────┘        │
│                                      │
│  ┌──────────┐  ┌──────────┐        │
│  │  Redis   │  │  Cache   │        │
│  │  :6379   │  │  :6378   │        │
│  └──────────┘  └──────────┘        │
│                                      │
│  ┌────────────────┐                 │
│  │  Supertokens   │                 │
│  │     :3567      │                 │
│  └────────────────┘                 │
│                                      │
│  ┌──────────┐  ┌──────────┐        │
│  │  Worker  │  │   Cron   │        │
│  │ (Celery) │  │          │        │
│  └──────────┘  └──────────┘        │
└──────────────────────────────────────┘
```

## Key Differences from Docker Compose

| Aspect | Docker Compose | Railway |
|--------|----------------|---------|
| Reverse Proxy | Traefik | Nginx (custom) |
| Service Discovery | Service name | `<service>.railway.internal` |
| SSL/TLS | Manual (Traefik) | Automatic (Railway) |
| Networking | Bridge | IPv6 private network |
| Volumes | Named volumes | Railway volumes |
| Env Variables | `.env` files | Railway dashboard |

## Required Services

You need to create these services in Railway:

### Public Service (1)
1. **nginx** - Reverse proxy (only service with public domain)

### Application Services (6)
2. **web** - Next.js frontend
3. **api** - FastAPI backend
4. **worker** - Celery worker
5. **cron** - Scheduled tasks
6. **completion** - Completion service
7. **chat** - Chat service

### Infrastructure Services (5)
8. **postgres** - PostgreSQL database
9. **rabbitmq** - Message broker
10. **redis** - For Celery
11. **cache** - Redis cache
12. **supertokens** - Authentication

**Total: 12 services**

Note: The `alembic` migration service can run as a pre-deploy command in the API service.

## Service Configuration

### Nginx Service

```
Root Directory: /
Dockerfile Path: hosting/railway/Dockerfile.nginx
Start Command: nginx -g 'daemon off;'
Public Domain: ✅ Enabled
Healthcheck Path: /health
Port: 80
```

### Web Service (Next.js Frontend)

```
Root Directory: /web
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: node ./oss/server.js
Public Domain: ❌ Disabled (private only)
Port: 3000
```

**Important:** Ensure the server listens on IPv6 (`::`) for Railway's private networking.

### API Service (FastAPI Backend)

```
Root Directory: /api
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: uvicorn entrypoint:app --host :: --port $PORT --root-path /api
Pre-deploy Command: python -m oss.databases.postgres.migrations.runner
Public Domain: ❌ Disabled (private only)
Healthcheck Path: /health
Port: 8000
```

### Worker Service (Celery)

```
Root Directory: /api
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: celery -A entrypoint.celery_app worker --concurrency=1
Public Domain: ❌ Disabled
```

### Cron Service

```
Root Directory: /api
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: cron -f
Public Domain: ❌ Disabled
```

### Completion Service

```
Root Directory: /services/completion
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: python oss/src/main.py
Public Domain: ❌ Disabled
Port: 80
```

### Chat Service

```
Root Directory: /services/chat
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: python oss/src/main.py
Public Domain: ❌ Disabled
Port: 80
```

### PostgreSQL

```
Option A: Use Railway PostgreSQL Plugin (Recommended)
  - Click "New" → "Database" → "Add PostgreSQL"
  - Automatic backups included
  - Variables auto-populated

Option B: Custom Container
  - Image: postgres:16.2
  - Volume: /var/lib/postgresql/data (required)
  - Port: 5432
```

### RabbitMQ

```
Image: rabbitmq:3-management
Volume: /var/lib/rabbitmq (required)
Environment:
  - RABBITMQ_DEFAULT_USER=guest
  - RABBITMQ_DEFAULT_PASS=<secure-password>
Ports: 5672 (AMQP), 15672 (Management UI)
```

### Redis

```
Image: redis:latest
Volume: /data (required)
Port: 6379
```

### Cache (Redis)

```
Image: redis:latest
Start Command: redis-server --port 6378 --appendonly no --save "" --maxmemory 128mb --maxmemory-policy allkeys-lru
Volume: /data (required)
Port: 6378
```

### Supertokens

```
Image: registry.supertokens.io/supertokens-postgresql
Environment:
  - POSTGRESQL_CONNECTION_URI=<postgres-uri>
Port: 3567
Depends on: postgres
```

## Environment Variables

Copy `.env.railway.example` and fill in the values. Key variables:

### Required

```bash
AGENTA_LICENSE=oss
AGENTA_AUTH_KEY=<generate-random-32-chars>
AGENTA_CRYPT_KEY=<generate-random-32-chars>
POSTGRES_PASSWORD=<secure-password>
RABBITMQ_DEFAULT_PASS=<secure-password>
```

### Auto-configured (after nginx deployment)

```bash
AGENTA_API_URL=https://${{nginx.RAILWAY_PUBLIC_DOMAIN}}/api
AGENTA_WEB_URL=https://${{nginx.RAILWAY_PUBLIC_DOMAIN}}
AGENTA_SERVICES_URL=https://${{nginx.RAILWAY_PUBLIC_DOMAIN}}/services
```

### Connection Strings (Railway Private Networking)

```bash
POSTGRES_URI_CORE=postgresql+asyncpg://user:pass@postgres.railway.internal:5432/agenta_oss_core
REDIS_URL=redis://redis.railway.internal:6379/0
CELERY_BROKER_URL=amqp://guest:pass@rabbitmq.railway.internal:5672//
SUPERTOKENS_CONNECTION_URI=http://supertokens.railway.internal:3567
```

## Railway-Specific Considerations

### IPv6 Support

Railway's private networking requires IPv6. Ensure your services listen on `::`:

**Python/FastAPI:**
```python
uvicorn.run(app, host="::", port=8000)
```

**Node.js:**
```javascript
server.listen(port, '::');
```

### Private Networking

Services communicate via `<service-name>.railway.internal:<port>`:

```
api.railway.internal:8000
postgres.railway.internal:5432
redis.railway.internal:6379
rabbitmq.railway.internal:5672
```

### Volumes

Create volumes for stateful services:
- postgres: `/var/lib/postgresql/data`
- redis: `/data`
- cache: `/data`
- rabbitmq: `/var/lib/rabbitmq`

**Important:** Volumes mount as root. Set `RAILWAY_RUN_UID=0` if your container runs as non-root.

### Health Checks

Configure health checks for zero-downtime deployments:

```
API: /health
Web: /
Nginx: /health
```

## Deployment Steps

1. **Create Railway Project**
   - Go to railway.app
   - Click "New Project"
   - Select "Empty Project"

2. **Add Services**
   - Add all 12 services (see list above)
   - Configure each service (root directory, dockerfile, etc.)

3. **Set Environment Variables**
   - Copy from `.env.railway.example`
   - Use Railway's reference variables where possible
   - Generate secure random keys

4. **Create Volumes**
   - Add volumes for postgres, redis, cache, rabbitmq
   - Mount to correct paths

5. **Configure Nginx Public Domain**
   - Only enable public domain for nginx service
   - Generate Railway domain or add custom domain
   - SSL is automatic

6. **Deploy Services**
   - Deploy infrastructure services first (postgres, redis, rabbitmq)
   - Then application services (api, web, worker, etc.)
   - Finally nginx

7. **Verify Deployment**
   - Check all services are running
   - Visit your Railway domain
   - Test API endpoints
   - Check logs for errors

## Troubleshooting

### Services can't connect to each other

- Ensure services listen on `::` (IPv6)
- Use `<service>.railway.internal` for internal connections
- Check that service names match Railway service names

### Nginx can't reach backend services

- Verify private networking is enabled (automatic on Railway)
- Check DNS resolution: `nslookup api.railway.internal`
- Ensure backend services are running

### Database connection errors

- Ensure postgres is healthy before starting dependent services
- Check connection string format
- Verify credentials

### High costs

- Use Railway's managed databases
- Enable app sleeping for non-production
- Use private networking (free) instead of public networking

## Cost Estimation

**Production deployment (Pro plan):**
- Base: $20/month
- Usage: ~$40-70/month
- **Total: ~$60-90/month**

**Development/Staging (Hobby plan with app sleeping):**
- Base: $5/month
- Usage: ~$5-15/month
- **Total: ~$10-20/month**

## Support

- Railway Documentation: https://docs.railway.com
- Agenta Documentation: https://docs.agenta.ai
- Community: https://discord.gg/agenta

## Next Steps

1. Deploy to Railway using this guide
2. Test thoroughly in staging environment
3. Configure custom domain for production
4. Set up monitoring and alerts
5. Create Railway template for easy community deployments

## Contributing

Found an issue or improvement? Please open a PR or issue in the Agenta repository.
