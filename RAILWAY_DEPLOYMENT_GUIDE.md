# Railway Deployment Guide for Agenta OSS

## Executive Summary

This guide provides a comprehensive strategy for deploying Agenta OSS on Railway, including analysis of the platform, architectural considerations, and detailed deployment steps.

---

## 1. Railway Platform Overview

### Key Features

**Automatic Infrastructure Management**
- Built-in SSL/TLS with Let's Encrypt (automatic renewal every 30 days)
- Automatic load balancing and request routing
- Zero-downtime deployments with healthchecks
- 10GB ephemeral storage per deployment
- IPv6 private networking between services

**Deployment Capabilities**
- Multi-service projects from monorepos
- Docker and Nixpacks build support
- Config-as-code via railway.json/railway.toml
- Volume support for persistent storage
- Environment variable management with reference variables

**Networking**
- Public domains (*.up.railway.app) with custom domain support
- Private networking via railway.internal DNS (IPv6 only)
- Services communicate via `<service>.railway.internal:<port>`
- Automatic SSL/TLS for all public domains

**Limitations**
- No native path-based routing (unlike Traefik)
- Each service typically gets one public domain
- Volumes mount as root (set `RAILWAY_RUN_UID=0` for non-root containers)
- Serverless (app sleeping) on free tier after 10 minutes of inactivity

---

## 2. Current Agenta Architecture Analysis

### Services Overview

| Service | Purpose | Port | Dependencies | Storage |
|---------|---------|------|--------------|---------|
| **web** | Next.js frontend | 3000 | API | None |
| **api** | FastAPI backend | 8000 | postgres, redis, rabbitmq, supertokens | None |
| **worker** | Celery background jobs | - | postgres, redis, rabbitmq | None |
| **cron** | Scheduled tasks | - | postgres, api | None |
| **alembic** | DB migrations (one-time) | - | postgres | None |
| **completion** | Completion service | 80 | - | None |
| **chat** | Chat service | 80 | - | None |
| **postgres** | Database | 5432 | - | Volume |
| **rabbitmq** | Message broker | 5672, 15672 | - | Volume |
| **redis** | Celery backend | 6379 | - | Volume |
| **cache** | Redis cache | 6378 | - | Volume |
| **supertokens** | Authentication | 3567 | postgres | None |

### Current Routing (Traefik/Nginx)

The current setup uses Traefik or Nginx for path-based routing:

```
/                      → web:3000 (frontend)
/api/*                 → api:8000 (backend, strips /api prefix)
/services/completion/* → completion:80 (strips prefix)
/services/chat/*       → chat:80 (strips prefix)
```

**Why this won't work directly on Railway:**
- Railway doesn't provide path-based routing out of the box
- Each Railway service gets its own domain (e.g., api-production.up.railway.app)
- Traefik is not needed since Railway handles SSL/TLS and load balancing

---

## 3. Railway Deployment Strategy

### Recommended Approach: Nginx as Single Entry Point

**Why this approach:**
- Maintains current path-based routing architecture
- Single public domain for the entire application
- Internal services communicate via private networking
- Minimal changes to existing codebase

### Architecture Diagram

```
Internet → Railway Public Domain → Nginx (public)
                                     ↓
                    ┌────────────────┼─────────────────┐
                    ↓                ↓                 ↓
                  Web:3000      API:8000      Services:80
                (private)       (private)      (private)
                                     ↓
        ┌────────────────────────────┼────────────────────┐
        ↓            ↓               ↓                    ↓
    Postgres:5432  RabbitMQ:5672  Redis:6379  Supertokens:3567
     (private)      (private)      (private)    (private)
```

### Service Configuration

#### Railway Services (13 total)

1. **nginx** (Public-facing)
   - Only service with public domain
   - Routes traffic to internal services
   - Handles rate limiting, security headers, compression

2. **web, api, worker, cron, completion, chat** (Application services)
   - Private networking only
   - Communicate via railway.internal domains
   - Listen on IPv6 (`::`)**3. **postgres, rabbitmq, redis, cache, supertokens** (Infrastructure services)
   - Private networking only
   - Persistent volumes for data storage
   - Railway-managed databases could be used as alternative

4. **alembic** (Migration job)
   - Runs as Railway "init container" or cron job
   - Executes once before API starts

---

## 4. Routing Solutions Comparison

### Option 1: Nginx as Reverse Proxy (RECOMMENDED)

**Pros:**
- Maintains current architecture
- Single public domain
- Full control over routing
- Can add rate limiting, caching, security headers
- Minimal code changes

**Cons:**
- Additional service to manage
- Nginx becomes a single point of failure

**Configuration:**
```nginx
# Nginx routes to private Railway domains
location /api/ {
    proxy_pass http://api.railway.internal:8000/;
}
```

### Option 2: Separate Subdomains

**Pros:**
- Native Railway approach
- Each service independently scalable
- No reverse proxy needed

**Cons:**
- Requires code changes (CORS configuration)
- Multiple domains to manage
- Not ideal for monolithic frontend

**Example:**
```
app.yourdomain.com    → web
api.yourdomain.com    → api
chat.yourdomain.com   → chat
```

### Option 3: Next.js Rewrites (Frontend Proxy)

**Pros:**
- No Nginx needed
- Next.js handles API proxying
- Single domain

**Cons:**
- Frontend becomes a bottleneck for API traffic
- Requires changes to Next.js config
- Not suitable for large-scale traffic

---

## 5. Step-by-Step Deployment Guide

### Prerequisites

1. Railway account (sign up at railway.app)
2. GitHub repository with Agenta code (public or private)
3. Railway CLI installed (optional, for local development)

### Method 1: Using Railway UI (Recommended for first deployment)

#### Step 1: Create a New Project

1. Log into Railway dashboard
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Authorize Railway to access your repository
5. Select the Agenta repository

#### Step 2: Add Services

Since Agenta is a monorepo, you'll need to add multiple services from the same repository.

**Add PostgreSQL:**
1. Click "New" → "Database" → "Add PostgreSQL"
2. Railway will provision a managed PostgreSQL instance
3. Note: This creates a managed database with automatic backups

**Alternatively, use custom Postgres:**
1. Click "New" → "Empty Service"
2. Name it "postgres"
3. Go to Settings → Image → Use "postgres:16.2"
4. Add volume: `/var/lib/postgresql/data` (mount path)
5. Set environment variables (see below)

**Add each application service:**

For each service (web, api, worker, cron, completion, chat, nginx):

1. Click "New" → "GitHub Repo"
2. Select your Agenta repository
3. Configure service settings:
   - **Service name:** (e.g., "api")
   - **Root Directory:** Set appropriately
     - api: `/api`
     - web: `/web`
     - completion: `/services/completion`
     - chat: `/services/chat`
     - nginx: `/hosting/docker-compose/oss/nginx`
   - **Build settings:**
     - Builder: DOCKERFILE
     - Dockerfile Path: Specify the correct path
       - api: `oss/docker/Dockerfile.gh`
       - web: `oss/docker/Dockerfile.gh`
   - **Start Command:** (see specific commands below)

4. Add environment variables (see section below)

#### Step 3: Configure Service Details

**API Service:**
```
Root Directory: /api
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: uvicorn entrypoint:app --host :: --port $PORT --root-path /api
Healthcheck Path: /health
PORT: 8000 (will be overridden by Railway)
```

**Web Service:**
```
Root Directory: /web
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: node ./oss/server.js
PORT: 3000
Listen on IPv6: Ensure app listens on ::
```

**Worker Service:**
```
Root Directory: /api
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: celery -A entrypoint.celery_app worker --concurrency=1 --max-tasks-per-child=1 --prefetch-multiplier=1
No public domain needed
```

**Cron Service:**
```
Root Directory: /api
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: cron -f
No public domain needed
```

**Completion Service:**
```
Root Directory: /services/completion
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: python oss/src/main.py
PORT: 80
Listen on IPv6: Ensure app listens on ::
```

**Chat Service:**
```
Root Directory: /services/chat
Dockerfile Path: oss/docker/Dockerfile.gh
Start Command: python oss/src/main.py
PORT: 80
Listen on IPv6: Ensure app listens on ::
```

**Nginx Service:**
```
Root Directory: /
Dockerfile: Create custom Dockerfile for Nginx
Start Command: nginx -g 'daemon off;'
PORT: 80
Public Domain: Enabled (this is the only public-facing service)
```

**RabbitMQ:**
```
Image: rabbitmq:3-management
Volume: /var/lib/rabbitmq
Environment Variables: See below
Ports: 5672 (AMQP), 15672 (Management UI)
```

**Redis:**
```
Image: redis:latest
Volume: /data
```

**Cache (Redis):**
```
Image: redis:latest
Start Command: redis-server --port 6378 --appendonly no --appendfsync no --save "" --maxmemory 128mb --maxmemory-policy allkeys-lru
Volume: /data
```

**Supertokens:**
```
Image: registry.supertokens.io/supertokens-postgresql
Depends on: postgres
Environment Variables: See below
```

#### Step 4: Configure Environment Variables

Railway supports shared variables and reference variables. Here's how to set them up:

**Shared Variables (Project-level):**

```bash
# License and URLs (will be updated after deployment)
AGENTA_LICENSE=oss
AGENTA_API_URL=https://${{nginx.RAILWAY_PUBLIC_DOMAIN}}/api
AGENTA_WEB_URL=https://${{nginx.RAILWAY_PUBLIC_DOMAIN}}
AGENTA_SERVICES_URL=https://${{nginx.RAILWAY_PUBLIC_DOMAIN}}/services

# Security (IMPORTANT: Generate secure random strings)
AGENTA_AUTH_KEY=${{secret(32)}}
AGENTA_CRYPT_KEY=${{secret(32)}}

# Database (if using Railway PostgreSQL)
POSTGRES_PASSWORD=${{POSTGRES.POSTGRES_PASSWORD}}
POSTGRES_USERNAME=${{POSTGRES.POSTGRES_USER}}

# Or if using custom Postgres:
POSTGRES_PASSWORD=<generate-secure-password>
POSTGRES_USERNAME=agenta_user

# Database URIs
POSTGRES_URI_SUPERTOKENS=postgresql://${{POSTGRES_USERNAME}}:${{POSTGRES_PASSWORD}}@postgres.railway.internal:5432/agenta_oss_supertokens
POSTGRES_URI_CORE=postgresql+asyncpg://${{POSTGRES_USERNAME}}:${{POSTGRES_PASSWORD}}@postgres.railway.internal:5432/agenta_oss_core
POSTGRES_URI_TRACING=postgresql+asyncpg://${{POSTGRES_USERNAME}}:${{POSTGRES_PASSWORD}}@postgres.railway.internal:5432/agenta_oss_tracing

# Redis URLs (using private networking)
REDIS_URL=redis://redis.railway.internal:6379/0
CELERY_BROKER_URL=amqp://guest:guest@rabbitmq.railway.internal:5672//
CELERY_RESULT_BACKEND=redis://redis.railway.internal:6379/0

# Supertokens
SUPERTOKENS_CONNECTION_URI=http://supertokens.railway.internal:3567

# RabbitMQ
RABBITMQ_DEFAULT_USER=guest
RABBITMQ_DEFAULT_PASS=<generate-secure-password>

# Optional features
AGENTA_AUTO_MIGRATIONS=true
AGENTA_TELEMETRY_ENABLED=true
AGENTA_SERVICE_MIDDLEWARE_CACHE_ENABLED=true

# PostHog (analytics - optional)
POSTHOG_API_KEY=phc_hmVSxIjTW1REBHXgj2aw4HW9X6CXb6FzerBgP9XenC7

# Email (optional)
AGENTA_SEND_EMAIL_FROM_ADDRESS=mail@example.com

# OAuth (optional)
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GITHUB_OAUTH_CLIENT_ID=
GITHUB_OAUTH_CLIENT_SECRET=

# LLM API Keys (optional)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
# ... add others as needed
```

**Reference Variable Syntax:**
```bash
# Reference another service's variable
DATABASE_URL=${{postgres.DATABASE_URL}}

# Reference shared variable
API_URL=${{shared.AGENTA_API_URL}}

# Generate random secret
SECRET_KEY=${{secret(32)}}
```

#### Step 5: Configure Nginx for Railway

Create a custom Nginx configuration for Railway:

**Create: `/hosting/railway/nginx.conf`**

```nginx
events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    access_log /dev/stdout;
    error_log /dev/stderr;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/xml+rss application/json;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;

    server {
        listen 80;
        server_name _;

        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

        # Client max body size
        client_max_body_size 10M;

        # Health check endpoint for Railway
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }

        # Proxy to FastAPI backend (using Railway private networking)
        location /api/ {
            limit_req zone=api burst=20 nodelay;

            # Railway private networking uses IPv6
            proxy_pass http://api.railway.internal:8000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Timeouts
            proxy_connect_timeout 60s;
            proxy_send_timeout 60s;
            proxy_read_timeout 60s;
        }

        # Proxy to completion service
        location /services/completion/ {
            proxy_pass http://completion.railway.internal:80/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Proxy to chat service
        location /services/chat/ {
            proxy_pass http://chat.railway.internal:80/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Proxy to Next.js frontend (catch-all, must be last)
        location / {
            proxy_pass http://web.railway.internal:3000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # WebSocket support
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
```

**Create: `/hosting/railway/Dockerfile.nginx`**

```dockerfile
FROM nginx:alpine

# Copy custom nginx configuration
COPY hosting/railway/nginx.conf /etc/nginx/nginx.conf

# Expose port 80
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost/health || exit 1

CMD ["nginx", "-g", "daemon off;"]
```

#### Step 6: Ensure IPv6 Support

Railway's private networking requires services to listen on IPv6. Update your services:

**Python/FastAPI (API, Completion, Chat):**
```python
# In your main.py or entrypoint
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="::", port=int(os.getenv("PORT", 8000)))
```

**Node.js/Next.js (Web):**
```javascript
// In your server.js
const server = app.listen(port, '::', () => {
  console.log(`Server listening on [::]:${port}`);
});
```

#### Step 7: Configure Service Dependencies

In Railway, you can't explicitly set depends_on like Docker Compose, but you can:

1. **Use healthchecks** to ensure services are ready
2. **Add connection retry logic** in your application code
3. **Deploy services in order:**
   - First: postgres, redis, rabbitmq
   - Second: supertokens (wait for postgres)
   - Third: alembic (run migrations)
   - Fourth: api, worker, cron
   - Fifth: web, completion, chat
   - Last: nginx

#### Step 8: Run Database Migrations

**Option 1: Use Railway's Pre-Deploy Command**

In the API service settings:
```
Pre-deploy Command: python -m oss.databases.postgres.migrations.runner
```

**Option 2: Create a separate migration service**

Create a service that runs once:
```
Service: alembic
Command: python -m oss.databases.postgres.migrations.runner
Cron Schedule: @once (or leave empty and trigger manually)
```

#### Step 9: Configure Public Domain

1. Go to Nginx service settings
2. Click "Generate Domain" to get a Railway domain (e.g., `your-app.up.railway.app`)
3. Or add a custom domain:
   - Click "Settings" → "Domains"
   - Add your custom domain (e.g., `agenta.yourdomain.com`)
   - Update your DNS with the provided CNAME record
   - Railway will automatically provision SSL certificate

#### Step 10: Update Environment Variables with Domain

Once you have your public domain:

```bash
AGENTA_API_URL=https://your-app.up.railway.app/api
AGENTA_WEB_URL=https://your-app.up.railway.app
AGENTA_SERVICES_URL=https://your-app.up.railway.app/services
```

#### Step 11: Deploy and Monitor

1. Click "Deploy" on each service
2. Monitor build logs for errors
3. Check deployment status in Railway dashboard
4. Test the application:
   - Visit `https://your-app.up.railway.app`
   - Check API: `https://your-app.up.railway.app/api/health`
   - Verify services are communicating

### Method 2: Using Railway CLI

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Create new project
railway init

# Link to project
railway link

# Add services (do this for each service)
railway service create api
railway service create web
railway service create postgres
# ... etc

# Set environment variables
railway variables set AGENTA_LICENSE=oss

# Deploy
railway up
```

### Method 3: Using Config-as-Code (Railway.toml)

Create `railway.toml` files in each service directory:

**Example: `/api/railway.toml`**

```toml
[build]
builder = "DOCKERFILE"
dockerfilePath = "oss/docker/Dockerfile.gh"

[deploy]
startCommand = "uvicorn entrypoint:app --host :: --port $PORT --root-path /api"
healthcheckPath = "/health"
healthcheckTimeout = 300
restartPolicyType = "ALWAYS"

# Pre-deploy migrations
preDeployCommand = "python -m oss.databases.postgres.migrations.runner"
```

---

## 6. Creating a Railway Template

To make Agenta easily deployable by others, create a Railway template:

### Option 1: Via Railway Button

1. Deploy Agenta to Railway following the steps above
2. Once working, go to Project Settings
3. Click "Create Template from Project"
4. Railway will extract:
   - All services
   - Environment variable keys (not values)
   - Service configurations
5. Add descriptions for environment variables
6. Add a README with deployment instructions
7. Publish to Railway marketplace

### Option 2: Via GitHub Repository

1. Create a dedicated repository for the Railway template
2. Include necessary files:
   ```
   agenta-railway-template/
   ├── README.md (deployment instructions)
   ├── railway.json (template configuration)
   ├── nginx/
   │   ├── Dockerfile
   │   └── nginx.conf
   └── .env.example
   ```

3. Create `railway.json`:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "services": {
    "web": {
      "source": {
        "repo": "Agenta-AI/agenta",
        "rootDirectory": "/web"
      },
      "build": {
        "builder": "DOCKERFILE",
        "dockerfilePath": "oss/docker/Dockerfile.gh"
      },
      "deploy": {
        "startCommand": "node ./oss/server.js",
        "healthcheckPath": "/",
        "healthcheckTimeout": 300
      }
    },
    "api": {
      "source": {
        "repo": "Agenta-AI/agenta",
        "rootDirectory": "/api"
      },
      "build": {
        "builder": "DOCKERFILE",
        "dockerfilePath": "oss/docker/Dockerfile.gh"
      },
      "deploy": {
        "startCommand": "uvicorn entrypoint:app --host :: --port $PORT --root-path /api",
        "healthcheckPath": "/health",
        "preDeployCommand": "python -m oss.databases.postgres.migrations.runner"
      }
    }
  }
}
```

**Note:** The above is a simplified example. Railway's template format may require using their UI-based template creator for complex multi-service setups.

### Template Best Practices (per Railway docs)

1. **Use Private Networking:** Route service-to-service communication through `*.railway.internal` instead of public domains
2. **Generate Secrets:** Use `${{secret(32)}}` for sensitive values instead of hardcoding
3. **Add Variable Descriptions:** Help users understand what each variable is for
4. **Include Health Checks:** Enable zero-downtime deployments
5. **Add Volumes:** For stateful services (databases)
6. **Minimize Repository:** Keep template repo clean with only essential files
7. **Document Well:** Include comprehensive README with setup instructions

---

## 7. Troubleshooting

### Common Issues

**Services can't communicate:**
- Ensure services listen on IPv6 (`::`), not IPv4 (`0.0.0.0`)
- Use `<service>.railway.internal:<port>` for internal communication
- Check that `PORT` environment variable is used correctly

**Database connection failures:**
- Verify postgres is healthy before starting dependent services
- Use Railway's reference variables for dynamic connection strings
- Check that database initialization script ran successfully

**Nginx can't reach services:**
- Verify private networking is enabled (it's automatic)
- Check service names match Railway service names
- Ensure DNS resolution: `<service-name>.railway.internal`

**Migrations not running:**
- Use pre-deploy command in API service
- Or create a separate migration service with `@once` cron schedule
- Check migration logs for errors

**High memory usage:**
- Railway free tier has memory limits
- Optimize Celery concurrency settings
- Consider using Railway's managed database instead of self-hosted Postgres

**Slow builds:**
- Use Docker layer caching
- Optimize Dockerfile (multi-stage builds)
- Consider pre-building and pushing images to GitHub Container Registry

---

## 8. Cost Optimization

### Railway Pricing Overview

- **Hobby Plan:** $5/month + usage
- **Pro Plan:** $20/month + usage
- **Usage costs:** Based on CPU, memory, network egress

### Optimization Strategies

1. **Use Managed Databases:** Railway's managed Postgres includes backups and is often cheaper
2. **Enable App Sleeping:** Free/Hobby plans - services sleep after 10 minutes inactivity
3. **Private Networking:** Internal communication is free (no egress charges)
4. **Optimize Workers:** Reduce Celery worker concurrency if possible
5. **Resource Limits:** Set appropriate CPU/memory limits per service
6. **Combine Services:** Consider combining cron + worker if feasible

### Estimated Monthly Cost

For a production Agenta deployment:

```
Nginx:       ~$2-3/month
Web:         ~$5-8/month
API:         ~$8-12/month
Worker:      ~$5-8/month
Cron:        ~$2-3/month
Completion:  ~$3-5/month
Chat:        ~$3-5/month
Postgres:    ~$10-15/month (managed) or ~$8-12/month (self-hosted)
RabbitMQ:    ~$5-8/month
Redis:       ~$3-5/month
Cache:       ~$2-3/month
Supertokens: ~$3-5/month

Total: ~$59-92/month (Pro plan + usage)
```

**For development/testing:** Use Hobby plan with app sleeping: ~$10-20/month

---

## 9. Alternative Architectures

### Option A: Using Railway Managed Services

Replace self-hosted infrastructure with Railway's managed services:

- **PostgreSQL:** Use Railway PostgreSQL plugin
- **Redis:** Use Railway Redis plugin
- **RabbitMQ:** Keep self-hosted (Railway doesn't offer managed RabbitMQ)

**Pros:**
- Automatic backups
- Better reliability
- Less management overhead
- Often better performance

**Cons:**
- Slightly higher cost
- Less control over configuration

### Option B: Subdomain-based Routing

Skip Nginx and use separate subdomains:

```
app.yourdomain.com     → web
api.yourdomain.com     → api
chat.yourdomain.com    → chat service
completion.yourdomain.com → completion service
```

**Required changes:**
- Update CORS configuration in API
- Update frontend API client to use api.yourdomain.com
- Configure custom domains in Railway for each service

**Pros:**
- No Nginx needed
- Native Railway approach
- Easier to scale individual services

**Cons:**
- Requires code changes
- More domains to manage
- Higher egress costs (each service serves public traffic)

### Option C: Next.js as API Gateway

Use Next.js rewrites to proxy API requests:

**In `next.config.js`:**
```javascript
module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: process.env.API_URL + '/:path*'
      },
      {
        source: '/services/completion/:path*',
        destination: process.env.COMPLETION_URL + '/:path*'
      }
    ]
  }
}
```

**Pros:**
- No Nginx needed
- Single domain
- Leverages Next.js capabilities

**Cons:**
- Frontend becomes bottleneck
- Not suitable for high API traffic
- Potential performance issues

---

## 10. Migration Checklist

Use this checklist when migrating from Docker Compose to Railway:

- [ ] Create Railway account and project
- [ ] Set up all required services (13 total)
- [ ] Configure environment variables with Railway reference syntax
- [ ] Update connection strings to use `*.railway.internal` domains
- [ ] Ensure all services listen on IPv6 (`::`)**- [ ] Create and configure Nginx service with Railway-specific config
- [ ] Set up volumes for stateful services (postgres, redis, rabbitmq)
- [ ] Configure healthchecks for all web services
- [ ] Set up database migration strategy (pre-deploy command)
- [ ] Configure only Nginx with public domain
- [ ] Test private networking between services
- [ ] Set up custom domain (if needed)
- [ ] Configure environment-specific variables
- [ ] Test complete deployment flow
- [ ] Set up monitoring/logging (Railway provides basic metrics)
- [ ] Document any custom configurations
- [ ] Create Railway template (optional, for easy redeployment)

---

## 11. Key Differences: Docker Compose vs Railway

| Aspect | Docker Compose | Railway |
|--------|----------------|---------|
| **Networking** | Custom bridge network | Automatic private IPv6 network |
| **Service Discovery** | Service name | `<service>.railway.internal` |
| **Reverse Proxy** | Traefik with labels | Not included, use Nginx or subdomains |
| **SSL/TLS** | Manual (Let's Encrypt) | Automatic |
| **Volumes** | Named volumes | Railway volumes (must create separately) |
| **Environment Variables** | .env files | Railway UI or reference variables |
| **Dependencies** | `depends_on` | Healthchecks + connection retry logic |
| **Scaling** | Docker Compose scale | Railway replicas (Pro plan) |
| **Logs** | `docker logs` | Railway dashboard or CLI |
| **Cost** | Self-hosting costs | $5-20/month + usage |

---

## 12. Next Steps

1. **Test Deployment:**
   - Deploy to Railway using the recommended Nginx approach
   - Test all functionality
   - Monitor performance and costs

2. **Optimize:**
   - Fine-tune resource allocation
   - Enable app sleeping for non-production environments
   - Consider managed services for production

3. **Create Template:**
   - Once deployment is stable, create a Railway template
   - Publish to marketplace for easy community deployments
   - Set up template with kickback program (earn 50% of usage)

4. **Document:**
   - Add Railway deployment docs to Agenta repository
   - Create video tutorial (optional)
   - Share with community

---

## 13. Conclusion

**Recommended Deployment Strategy:**

1. ✅ Use **Nginx as single entry point** (Option 1)
2. ✅ Use **Railway private networking** for inter-service communication
3. ✅ Use **Railway managed PostgreSQL** for easier management
4. ✅ Configure **healthchecks** for zero-downtime deployments
5. ✅ Use **environment reference variables** for dynamic configuration
6. ✅ Create **Railway template** for easy deployment

**Key Takeaways:**

- **Traefik is not needed** - Railway handles SSL/TLS and load balancing
- **Path-based routing requires Nginx** - Railway doesn't support it natively
- **Private networking is crucial** - Saves costs and improves security
- **IPv6 support is required** - Ensure all services listen on `::`
- **Template creation is valuable** - Makes deployment easy for users and generates kickback revenue

This guide provides everything needed to successfully deploy Agenta OSS on Railway. The Nginx-based approach maintains the current architecture while leveraging Railway's infrastructure benefits.
