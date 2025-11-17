# Railway Deployment - Quick Start Guide

This is a condensed version of the full deployment guide for quick reference.

## Prerequisites

- Railway account (sign up at [railway.app](https://railway.app))
- Agenta repository (public or private on GitHub)

## Deployment Overview

Railway deployment uses **Nginx as a reverse proxy** with all other services on private networking.

```
Internet → Nginx (public) → Private Network → All other services
```

## Services Checklist

Create these 12 services in Railway:

### Public
- [ ] **nginx** - Reverse proxy (ONLY public service)

### Application
- [ ] **web** - Next.js frontend (port 3000)
- [ ] **api** - FastAPI backend (port 8000)
- [ ] **worker** - Celery worker
- [ ] **cron** - Scheduled tasks
- [ ] **completion** - Completion service (port 80)
- [ ] **chat** - Chat service (port 80)

### Infrastructure
- [ ] **postgres** - Database (port 5432) + volume
- [ ] **rabbitmq** - Message broker (port 5672) + volume
- [ ] **redis** - For Celery (port 6379) + volume
- [ ] **cache** - Redis cache (port 6378) + volume
- [ ] **supertokens** - Auth (port 3567)

## Step-by-Step

### 1. Create Project
```
railway.app → New Project → Empty Project
```

### 2. Add Infrastructure Services

**PostgreSQL (Option A - Managed, Recommended):**
```
New → Database → Add PostgreSQL
```

**PostgreSQL (Option B - Custom):**
```
New → Empty Service → Name: postgres
Settings → Image: postgres:16.2
Settings → Volume: /var/lib/postgresql/data
Variables: POSTGRES_PASSWORD, POSTGRES_USER, POSTGRES_DB
```

**RabbitMQ:**
```
New → Empty Service → Name: rabbitmq
Image: rabbitmq:3-management
Volume: /var/lib/rabbitmq
Variables:
  RABBITMQ_DEFAULT_USER=guest
  RABBITMQ_DEFAULT_PASS=<secure-password>
```

**Redis:**
```
New → Empty Service → Name: redis
Image: redis:latest
Volume: /data
```

**Cache (Redis):**
```
New → Empty Service → Name: cache
Image: redis:latest
Start Command: redis-server --port 6378 --appendonly no --save "" --maxmemory 128mb --maxmemory-policy allkeys-lru
Volume: /data
```

**Supertokens:**
```
New → Empty Service → Name: supertokens
Image: registry.supertokens.io/supertokens-postgresql
Variables:
  POSTGRESQL_CONNECTION_URI=postgresql://user:pass@postgres.railway.internal:5432/agenta_oss_supertokens
```

### 3. Add Application Services

For each service, configure:

**API:**
```
New → GitHub Repo → Select Agenta
Service Name: api
Root Directory: /api
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: uvicorn entrypoint:app --host :: --port $PORT --root-path /api
Pre-deploy Command: python -m oss.databases.postgres.migrations.runner
Healthcheck Path: /health
Public Domain: ❌ Disabled
```

**Web:**
```
Service Name: web
Root Directory: /web
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: node ./oss/server.js
Public Domain: ❌ Disabled
```

**Worker:**
```
Service Name: worker
Root Directory: /api
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: celery -A entrypoint.celery_app worker --concurrency=1 --max-tasks-per-child=1 --prefetch-multiplier=1
Public Domain: ❌ Disabled
```

**Cron:**
```
Service Name: cron
Root Directory: /api
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: cron -f
Public Domain: ❌ Disabled
```

**Completion:**
```
Service Name: completion
Root Directory: /services/completion
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: python oss/src/main.py
Public Domain: ❌ Disabled
```

**Chat:**
```
Service Name: chat
Root Directory: /services/chat
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: python oss/src/main.py
Public Domain: ❌ Disabled
```

### 4. Add Nginx Service

```
New → GitHub Repo → Select Agenta
Service Name: nginx
Root Directory: /
Dockerfile Path: hosting/railway/Dockerfile.nginx
Start Command: nginx -g 'daemon off;'
Healthcheck Path: /health
Public Domain: ✅ ENABLED (only service with public domain)
```

### 5. Configure Environment Variables

Use Railway's "Shared Variables" feature for project-wide variables:

**Required:**
```bash
AGENTA_LICENSE=oss
AGENTA_AUTH_KEY=<generate-32-char-random>
AGENTA_CRYPT_KEY=<generate-32-char-random>
POSTGRES_PASSWORD=<secure-password>
POSTGRES_USERNAME=agenta_user
RABBITMQ_DEFAULT_PASS=<secure-password>
```

**Database URIs (Railway Private Network):**
```bash
POSTGRES_URI_CORE=postgresql+asyncpg://agenta_user:password@postgres.railway.internal:5432/agenta_oss_core
POSTGRES_URI_TRACING=postgresql+asyncpg://agenta_user:password@postgres.railway.internal:5432/agenta_oss_tracing
POSTGRES_URI_SUPERTOKENS=postgresql://agenta_user:password@postgres.railway.internal:5432/agenta_oss_supertokens

REDIS_URL=redis://redis.railway.internal:6379/0
CELERY_BROKER_URL=amqp://guest:password@rabbitmq.railway.internal:5672//
CELERY_RESULT_BACKEND=redis://redis.railway.internal:6379/0
SUPERTOKENS_CONNECTION_URI=http://supertokens.railway.internal:3567
```

**URLs (after deploying nginx):**
```bash
# Use Railway reference variables
AGENTA_API_URL=https://${{nginx.RAILWAY_PUBLIC_DOMAIN}}/api
AGENTA_WEB_URL=https://${{nginx.RAILWAY_PUBLIC_DOMAIN}}
AGENTA_SERVICES_URL=https://${{nginx.RAILWAY_PUBLIC_DOMAIN}}/services
```

**Optional:**
```bash
AGENTA_AUTO_MIGRATIONS=true
AGENTA_TELEMETRY_ENABLED=true
OPENAI_API_KEY=<your-key>
# ... add other optional variables as needed
```

### 6. Deploy in Order

1. **Infrastructure first:** postgres → redis → cache → rabbitmq → supertokens
2. **Wait for healthy status**
3. **Application services:** api → worker → cron → web → completion → chat
4. **Finally:** nginx

### 7. Get Public Domain

Once nginx is deployed:
```
Nginx service → Settings → Generate Domain
```

You'll get: `your-app-production.up.railway.app`

Or add custom domain:
```
Settings → Domains → Add Domain → your-domain.com
Update DNS with provided CNAME
SSL is automatic
```

### 8. Verify

Visit your domain and check:
- [ ] Frontend loads: `https://your-app.up.railway.app`
- [ ] API works: `https://your-app.up.railway.app/api/health`
- [ ] Check all service logs in Railway dashboard
- [ ] No connection errors in logs

## Critical Configuration Points

### 1. IPv6 Support (REQUIRED)

All services MUST listen on IPv6 for Railway's private networking:

**Python:**
```python
uvicorn.run(app, host="::", port=PORT)
```

**Node.js:**
```javascript
server.listen(PORT, '::');
```

### 2. Private Networking

Services communicate via:
```
<service-name>.railway.internal:<port>
```

Examples:
- `api.railway.internal:8000`
- `postgres.railway.internal:5432`
- `redis.railway.internal:6379`

### 3. Only Nginx is Public

- ✅ Nginx: Public domain enabled
- ❌ All other services: Public domain disabled

This ensures:
- Single entry point
- Reduced costs (no egress for internal traffic)
- Better security

### 4. Volumes Required

Add volumes to these services:
- postgres: `/var/lib/postgresql/data`
- redis: `/data`
- cache: `/data`
- rabbitmq: `/var/lib/rabbitmq`

### 5. Health Checks

Configure for zero-downtime:
- API: `/health`
- Web: `/`
- Nginx: `/health`

## Common Issues

**"Connection refused" errors:**
- Check service is listening on `::` (IPv6)
- Verify `.railway.internal` domain usage
- Ensure service is running

**"Database not found":**
- Run migrations via pre-deploy command
- Or manually trigger alembic migration

**"502 Bad Gateway" from Nginx:**
- Backend service not running
- Check backend service logs
- Verify private networking

**High costs:**
- Disable public domains for all services except nginx
- Use private networking (free)
- Consider managed databases

## Estimated Costs

**Production (Pro Plan):**
- $20/month base + $40-70 usage = **~$60-90/month**

**Development (Hobby Plan with app sleeping):**
- $5/month base + $5-15 usage = **~$10-20/month**

## Next Steps

1. ✅ Deploy all services
2. ✅ Verify everything works
3. ⬜ Add custom domain
4. ⬜ Configure monitoring
5. ⬜ Set up automated backups
6. ⬜ Create Railway template for easy redeployment

## Need Help?

- **Full Guide:** `/RAILWAY_DEPLOYMENT_GUIDE.md`
- **Railway Docs:** https://docs.railway.com
- **Agenta Docs:** https://docs.agenta.ai

---

**Pro Tip:** Use Railway's CLI for faster deployment:
```bash
npm i -g @railway/cli
railway login
railway link
railway up
```
