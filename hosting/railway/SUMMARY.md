# Railway Deployment Research Summary

## Executive Summary

After comprehensive research of Railway's platform and analysis of Agenta's Docker Compose setup, here are the key findings and recommendations for hosting Agenta OSS on Railway.

---

## Key Findings

### 1. Railway Platform Changes (Recent Updates)

Railway has evolved significantly:

- **Multi-service templates** are now fully supported
- **Private networking** is automatic (IPv6-based)
- **Config-as-code** via railway.json/railway.toml
- **Managed databases** available (PostgreSQL, Redis, MongoDB, MySQL)
- **Automatic SSL/TLS** with Let's Encrypt
- **Template marketplace** with 50% revenue kickback for creators

### 2. Traefik is NOT Needed on Railway

**Current Setup (Docker Compose):**
```
Internet → Traefik → Services
```

**Why Traefik exists:**
- Path-based routing (/, /api, /services/*)
- SSL/TLS termination
- Load balancing
- Service discovery via Docker labels

**Railway eliminates need for:**
- ✅ SSL/TLS (Railway provides automatic HTTPS)
- ✅ Load balancing (Railway handles this)
- ✅ Service discovery (Railway provides *.railway.internal DNS)

**What Railway DOESN'T provide:**
- ❌ Path-based routing on single domain

**Solution: Use Nginx instead of Traefik**

### 3. Architecture Comparison

| Component | Docker Compose | Railway |
|-----------|----------------|---------|
| **Reverse Proxy** | Traefik (with Docker labels) | Nginx (custom config) |
| **Service Discovery** | Service name (DNS) | `<service>.railway.internal` |
| **SSL/TLS** | Traefik + Let's Encrypt | Railway (automatic) |
| **Networking** | Bridge network | IPv6 private network |
| **Public Access** | Via Traefik (all services) | Only nginx (single entry) |
| **Inter-service** | HTTP via service name | HTTP via *.railway.internal |
| **Port Binding** | IPv4 (0.0.0.0) | IPv6 (::) |

---

## Recommended Deployment Strategy

### Architecture

```
┌─────────────────────────────────────────────────┐
│              Railway Infrastructure             │
│                                                 │
│  Internet                                       │
│    ↓                                            │
│  Railway Public Domain                          │
│  (SSL/TLS automatic)                            │
│    ↓                                            │
│  ┌──────────────────────┐                       │
│  │  Nginx (Public)      │  ← ONLY public service│
│  │  Port 80             │                       │
│  └──────────────────────┘                       │
│            ↓                                    │
│  ┌─────────────────────────────────────┐        │
│  │  Railway Private Network (IPv6)     │        │
│  │                                     │        │
│  │  Web (3000)    API (8000)          │        │
│  │  Worker        Cron                │        │
│  │  Completion    Chat                │        │
│  │                                     │        │
│  │  Postgres      RabbitMQ            │        │
│  │  Redis         Cache               │        │
│  │  Supertokens                       │        │
│  └─────────────────────────────────────┘        │
└─────────────────────────────────────────────────┘
```

### Why This Approach?

**Advantages:**
1. ✅ Maintains current path-based routing
2. ✅ Single public domain (better UX)
3. ✅ Minimal code changes required
4. ✅ Full control over routing logic
5. ✅ Can add rate limiting, caching, security headers
6. ✅ Lower costs (private networking is free)

**Disadvantages:**
1. ❌ One additional service to manage (nginx)
2. ❌ Nginx becomes single point of failure (but Railway handles restarts)

### Alternative Approaches Considered

**Option 2: Separate Subdomains**
```
app.domain.com    → web
api.domain.com    → api
chat.domain.com   → chat
```
- ❌ Requires CORS configuration changes
- ❌ Multiple domains to manage
- ❌ Higher egress costs
- ✅ Native Railway approach
- ✅ Independently scalable

**Option 3: Next.js Rewrites**
- ❌ Frontend becomes API bottleneck
- ❌ Not suitable for high traffic
- ✅ No nginx needed
- ✅ Single domain

**Verdict: Option 1 (Nginx) is best for Agenta**

---

## Technical Requirements

### 1. IPv6 Support (CRITICAL)

Railway's private networking requires IPv6:

**✅ Correct:**
```python
# Python/FastAPI
uvicorn.run(app, host="::", port=8000)
```

```javascript
// Node.js
server.listen(port, '::');
```

**❌ Wrong:**
```python
uvicorn.run(app, host="0.0.0.0", port=8000)  # IPv4 only
```

### 2. Service Communication

**Docker Compose:**
```python
DATABASE_URL = "postgresql://user:pass@postgres:5432/db"
```

**Railway:**
```python
DATABASE_URL = "postgresql://user:pass@postgres.railway.internal:5432/db"
```

All internal connections use `<service>.railway.internal:<port>`

### 3. Public vs Private Services

**Only Nginx should be public:**
- Nginx: Public domain ✅
- All others: Private only ❌

This reduces costs and improves security.

### 4. Volumes for Stateful Services

Required volumes:
- `postgres`: `/var/lib/postgresql/data`
- `redis`: `/data`
- `cache`: `/data`
- `rabbitmq`: `/var/lib/rabbitmq`

**Important:** Volumes mount as root. Set `RAILWAY_RUN_UID=0` if needed.

---

## Migration Strategy

### Phase 1: Preparation
1. Create Railway account
2. Create Nginx configuration for Railway
3. Update service listen addresses to `::`
4. Prepare environment variables

### Phase 2: Infrastructure
1. Deploy PostgreSQL (use managed or custom)
2. Deploy Redis + Cache
3. Deploy RabbitMQ
4. Deploy Supertokens
5. Wait for all to be healthy

### Phase 3: Application
1. Deploy API (with pre-deploy migrations)
2. Deploy Worker
3. Deploy Cron
4. Deploy Web
5. Deploy Completion + Chat

### Phase 4: Reverse Proxy
1. Deploy Nginx
2. Enable public domain on Nginx only
3. Update environment variables with public URL

### Phase 5: Verification
1. Test all endpoints
2. Check service logs
3. Verify inter-service communication
4. Monitor resource usage

---

## Cost Analysis

### Production Deployment

**Railway Pro Plan:**
- Base: $20/month
- Nginx: ~$2-3/month
- Web: ~$5-8/month
- API: ~$8-12/month
- Worker: ~$5-8/month
- Cron: ~$2-3/month
- Completion: ~$3-5/month
- Chat: ~$3-5/month
- Postgres (managed): ~$10-15/month
- RabbitMQ: ~$5-8/month
- Redis: ~$3-5/month
- Cache: ~$2-3/month
- Supertokens: ~$3-5/month

**Total: ~$60-90/month**

### Development Deployment

**Railway Hobby Plan (with app sleeping):**
- Base: $5/month
- Reduced usage: ~$5-15/month

**Total: ~$10-20/month**

### Cost Optimization Tips
1. Use managed databases (better reliability, often cheaper)
2. Enable app sleeping for non-production
3. Use private networking (no egress charges)
4. Combine services where possible
5. Monitor and adjust resource limits

---

## Railway Template Creation

### Steps to Create Template

1. **Deploy successfully to Railway**
2. **Go to Project Settings** → "Create Template"
3. **Railway extracts:**
   - All services
   - Environment variable keys (not values)
   - Service configurations
4. **Add descriptions** for each env variable
5. **Add README** with setup instructions
6. **Publish to marketplace**

### Template Benefits

- **Ease of deployment** for users
- **Revenue sharing:** 50% kickback on template usage
- **Community visibility**
- **Automatic updates** (for GitHub-based templates)

---

## Key Challenges & Solutions

### Challenge 1: Path-Based Routing

**Problem:** Railway doesn't support native path-based routing.

**Solution:** Use Nginx as reverse proxy with custom configuration.

### Challenge 2: Traefik Dependencies

**Problem:** Current setup uses Traefik labels for routing.

**Solution:** Remove Traefik, replace with Nginx using Railway private networking.

### Challenge 3: IPv6 Requirement

**Problem:** Services listening on IPv4 won't work with Railway private networking.

**Solution:** Update all services to listen on `::` instead of `0.0.0.0`.

### Challenge 4: Service Dependencies

**Problem:** Docker Compose `depends_on` not available on Railway.

**Solution:**
- Use healthchecks
- Add connection retry logic in applications
- Deploy in correct order
- Use pre-deploy commands for migrations

### Challenge 5: Volume Permissions

**Problem:** Railway volumes mount as root.

**Solution:** Set `RAILWAY_RUN_UID=0` for services needing root access.

---

## Deliverables Created

### Documentation
1. **`RAILWAY_DEPLOYMENT_GUIDE.md`** - Comprehensive 13-section guide
2. **`hosting/railway/README.md`** - Railway-specific README
3. **`hosting/railway/QUICK_START.md`** - Quick reference guide
4. **`hosting/railway/SUMMARY.md`** - This summary

### Configuration Files
1. **`hosting/railway/nginx.conf`** - Nginx config for Railway
2. **`hosting/railway/Dockerfile.nginx`** - Nginx Dockerfile
3. **`hosting/railway/.env.railway.example`** - Environment variables template
4. **`hosting/railway/railway.toml.example`** - Config-as-code example
5. **`hosting/railway/services-config.json`** - Service configuration reference

---

## Next Steps

### Immediate Actions
1. ✅ Review all documentation
2. ⬜ Test Nginx configuration locally
3. ⬜ Verify IPv6 support in all services
4. ⬜ Create Railway account
5. ⬜ Deploy to Railway staging environment

### Short-term (1-2 weeks)
1. ⬜ Test full deployment on Railway
2. ⬜ Identify and fix any issues
3. ⬜ Optimize resource allocation
4. ⬜ Document any additional findings
5. ⬜ Create video walkthrough (optional)

### Long-term (1-2 months)
1. ⬜ Create official Railway template
2. ⬜ Publish to Railway marketplace
3. ⬜ Add Railway deployment to Agenta docs
4. ⬜ Monitor template usage and feedback
5. ⬜ Iterate based on user feedback

---

## Recommendations

### For Production

1. **Use Railway Managed Services:**
   - PostgreSQL: Use Railway PostgreSQL plugin
   - Redis: Use Railway Redis plugin
   - Benefits: Automatic backups, better reliability

2. **Enable Monitoring:**
   - Railway provides basic metrics
   - Consider adding external monitoring (Uptime Kuma)

3. **Set Up Custom Domain:**
   - Better branding
   - SSL is automatic

4. **Configure Alerts:**
   - Set up notifications for service failures
   - Monitor resource usage

### For Development

1. **Use App Sleeping:**
   - Saves costs on Hobby plan
   - Services wake on traffic

2. **Reduce Concurrency:**
   - Lower Celery worker concurrency
   - Reduce resource limits

3. **Use Smaller Instance Sizes:**
   - Railway allows resource customization

---

## Conclusion

**Railway is a viable hosting option for Agenta OSS** with the following approach:

✅ **Use Nginx as reverse proxy** (replaces Traefik)
✅ **Private networking** for all internal services
✅ **Managed databases** for better reliability
✅ **Railway template** for easy community deployment

**Key Success Factors:**
1. IPv6 support in all services
2. Proper use of private networking
3. Correct environment variable configuration
4. Strategic deployment order

**Estimated Effort:**
- Initial setup: 4-8 hours
- Testing and refinement: 4-8 hours
- Template creation: 2-4 hours
- **Total: 10-20 hours**

**Expected Outcome:**
- One-click deployment for Agenta OSS
- Production-ready Railway template
- Reduced deployment complexity for users
- Potential revenue from template kickbacks

---

## Resources

- **Railway Docs:** https://docs.railway.com
- **Agenta Docs:** https://docs.agenta.ai
- **Railway Templates:** https://railway.app/templates
- **Railway Discord:** https://discord.gg/railway

---

**Document Version:** 1.0
**Last Updated:** 2025-11-17
**Author:** Research and deployment strategy for Agenta on Railway
