# Agenta Production Deployment Guide

> **Live Deployment:** https://agenta.bravetech.io
> **Server:** Hetzner CX23 (91.98.229.196)
> **Deployed:** October 2025

## Table of Contents

- [Overview](#overview)
- [Server Information](#server-information)
- [Architecture](#architecture)
- [Access Information](#access-information)
- [Management](#management)
- [Updates](#updates)
- [Troubleshooting](#troubleshooting)
- [Backup & Recovery](#backup--recovery)
- [Security](#security)

---

## Overview

This document describes our production deployment of Agenta on a Hetzner VPS using Docker Compose with SSL/HTTPS via Traefik and Let's Encrypt.

### Key Features

- ✅ Full SSL/HTTPS with automatic certificate renewal
- ✅ Pre-built Docker images (no building required)
- ✅ Automatic HTTP → HTTPS redirect
- ✅ All services containerized
- ✅ Production-ready configuration

---

## Server Information

### Hetzner Server Details

- **Name:** agenta-service
- **Type:** CX23
- **IP Address:** `91.98.229.196`
- **IPv6:** `2a01:4f8:1c:6807::64`
- **Location:** Nuremberg, Germany (nbg1-dc3)
- **Resources:** 2 vCPUs, 4GB RAM, 40GB SSD + 10GB Volume
- **Domain:** `agenta.bravetech.io`
- **OS:** Ubuntu 24.04 LTS

### DNS Configuration

**DNS Provider:** Namecheap

```
Type: A
Host: agenta
Value: 91.98.229.196
TTL: Automatic
```

**Verify DNS:**
```bash
dig agenta.bravetech.io +short
# Should return: 91.98.229.196
```

---

## Architecture

### Services

All services run in Docker containers managed by Docker Compose:

| Service | Description | Port | Access |
|---------|-------------|------|--------|
| **web** | Next.js Frontend | 3000 | https://agenta.bravetech.io |
| **api** | FastAPI Backend | 8000 | https://agenta.bravetech.io/api |
| **postgres** | PostgreSQL 16.2 | 5432 | Internal only |
| **redis** | Cache & Sessions | 6379 | Internal only |
| **cache** | Redis Cache | 6378 | Internal only |
| **rabbitmq** | Message Queue | 5672, 15672 | http://91.98.229.196:15672 |
| **supertokens** | Authentication | 3567 | Internal only |
| **traefik** | Reverse Proxy | 80, 443, 8080 | Port 443 (HTTPS) |
| **worker** | Celery Worker | - | Background tasks |
| **completion** | LLM Completion | 80 | /services/completion/ |
| **chat** | LLM Chat | 80 | /services/chat/ |

### Deployed Configuration

- **Repository:** https://github.com/The-Edgar/agenta (fork)
- **Docker Compose:** `docker-compose.gh.ssl.yml`
- **Environment File:** `.env.oss.gh`
- **Deployment Path:** `/opt/agenta`

---

## Access Information

### Web Interfaces

**Main Application:**
```
https://agenta.bravetech.io
```

**API Documentation:**
```
https://agenta.bravetech.io/api/docs
```

**API Health Check:**
```bash
curl https://agenta.bravetech.io/api/health
# Returns: {"status":"ok"}
```

### Admin Interfaces

**Traefik Dashboard:**
```
http://91.98.229.196:8080
```

**RabbitMQ Management:**
```
http://91.98.229.196:15672
Default credentials: guest/guest (change in production!)
```

### SSH Access

```bash
ssh root@91.98.229.196
```

**Recommended: Set up SSH alias**

Add to `~/.ssh/config`:
```
Host agenta
    HostName 91.98.229.196
    User root
    IdentityFile ~/.ssh/your_key
```

Then connect with: `ssh agenta`

---

## Management

### Service Management

**Navigate to deployment directory:**
```bash
cd /opt/agenta/hosting/docker-compose/oss
```

**Check status of all services:**
```bash
docker compose -f docker-compose.gh.ssl.yml ps
```

**View logs (all services):**
```bash
docker compose -f docker-compose.gh.ssl.yml logs -f
```

**View logs (specific service):**
```bash
docker compose -f docker-compose.gh.ssl.yml logs -f api
docker compose -f docker-compose.gh.ssl.yml logs -f web
docker compose -f docker-compose.gh.ssl.yml logs -f traefik
docker compose -f docker-compose.gh.ssl.yml logs -f worker
```

**Restart all services:**
```bash
docker compose -f docker-compose.gh.ssl.yml restart
```

**Restart specific service:**
```bash
docker compose -f docker-compose.gh.ssl.yml restart api
docker compose -f docker-compose.gh.ssl.yml restart web
```

**Stop all services:**
```bash
docker compose -f docker-compose.gh.ssl.yml down
```

**Start all services:**
```bash
docker compose -f docker-compose.gh.ssl.yml \
  --env-file .env.oss.gh \
  --profile with-web \
  --profile with-traefik \
  up -d
```

### Environment Configuration

**Edit environment variables:**
```bash
vim /opt/agenta/hosting/docker-compose/oss/.env.oss.gh
```

**After editing, restart services:**
```bash
cd /opt/agenta/hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml restart
```

### Resource Monitoring

**Check Docker stats (live):**
```bash
docker stats
```

**Check disk usage:**
```bash
df -h
docker system df
```

**Check memory:**
```bash
free -h
```

**Check running containers:**
```bash
docker ps
```

---

## Updates

### Update Agenta to Latest Version

```bash
# 1. Navigate to agenta directory
cd /opt/agenta

# 2. Pull latest code from your fork
git pull origin main

# 3. Navigate to docker-compose directory
cd hosting/docker-compose/oss

# 4. Pull latest Docker images
docker compose -f docker-compose.gh.ssl.yml pull

# 5. Restart services with new images
docker compose -f docker-compose.gh.ssl.yml \
  --env-file .env.oss.gh \
  --profile with-web \
  --profile with-traefik \
  up -d

# 6. Monitor logs for issues
docker compose -f docker-compose.gh.ssl.yml logs -f
```

### Update Specific Service

```bash
# Pull latest image for specific service
docker compose -f docker-compose.gh.ssl.yml pull api

# Restart the service
docker compose -f docker-compose.gh.ssl.yml up -d api

# Check logs
docker compose -f docker-compose.gh.ssl.yml logs -f api
```

### Rollback to Previous Version

```bash
# If update fails, roll back to specific image version
cd /opt/agenta/hosting/docker-compose/oss

# Edit .env.oss.gh and add version tags:
# AGENTA_WEB_IMAGE_TAG=v0.59.3
# AGENTA_API_IMAGE_TAG=v0.59.3

# Restart with specific versions
docker compose -f docker-compose.gh.ssl.yml down
docker compose -f docker-compose.gh.ssl.yml \
  --env-file .env.oss.gh \
  --profile with-web \
  --profile with-traefik \
  up -d
```

---

## Troubleshooting

### Common Issues & Solutions

#### 1. SSL Certificate Not Working

**Symptoms:**
- Cannot access https://agenta.bravetech.io
- Browser shows SSL error
- Port 443 connection refused

**Solutions:**

```bash
# Check Traefik logs for SSL issues
docker compose -f docker-compose.gh.ssl.yml logs traefik | grep -i "certificate\|acme\|error"

# Verify ports are open
ufw status

# Check acme.json permissions (must be 600)
ls -la /opt/agenta/ssl_certificates/acme.json
chmod 600 /opt/agenta/ssl_certificates/acme.json

# Force certificate renewal
docker compose -f docker-compose.gh.ssl.yml down
rm /opt/agenta/ssl_certificates/acme.json
touch /opt/agenta/ssl_certificates/acme.json
chmod 600 /opt/agenta/ssl_certificates/acme.json
docker compose -f docker-compose.gh.ssl.yml \
  --env-file .env.oss.gh \
  --profile with-web \
  --profile with-traefik \
  up -d
```

#### 2. Database Migration Failures

**Symptoms:**
- `alembic` container exits with error
- Services fail to start
- Error: "invalid literal for int() with base 10"

**Solution:**

```bash
# Check for empty environment variables
cd /opt/agenta/hosting/docker-compose/oss
grep '^[A-Z_]*=$' .env.oss.gh

# Remove duplicate or empty env vars
# Common issue: REDIS_CACHE_PORT=
sed -i '/^REDIS_CACHE_PORT=$/d' .env.oss.gh

# Restart services
docker compose -f docker-compose.gh.ssl.yml \
  --env-file .env.oss.gh \
  --profile with-web \
  --profile with-traefik \
  up -d
```

#### 3. Web Service Returns 404

**Symptoms:**
- API works but web interface shows "404 page not found"
- HTTPS works but no content

**Solutions:**

```bash
# Check if web service is running
docker compose -f docker-compose.gh.ssl.yml ps web

# Check web service logs
docker compose -f docker-compose.gh.ssl.yml logs web

# Verify TRAEFIK_DOMAIN is set
cat .env.oss.gh | grep TRAEFIK_DOMAIN

# Remove conflicting old containers
docker ps -a | grep agenta-oss-gh-web
docker stop agenta-oss-gh-web-1 && docker rm agenta-oss-gh-web-1

# Restart Traefik to pick up routing
docker compose -f docker-compose.gh.ssl.yml restart traefik web
```

#### 4. Port 80/443 Already in Use

**Symptoms:**
- Error: "Bind for :::80 failed: port is already allocated"
- Traefik won't start

**Solution:**

```bash
# Find process using port 80
docker ps -a | grep traefik

# Stop conflicting containers
docker stop $(docker ps -q --filter "publish=80")
docker stop $(docker ps -q --filter "publish=443")

# Clean up old networks
docker network prune

# Restart deployment
docker compose -f docker-compose.gh.ssl.yml \
  --env-file .env.oss.gh \
  --profile with-web \
  --profile with-traefik \
  up -d
```

#### 5. Services Not Connecting to Database

**Symptoms:**
- API fails to start
- Connection refused errors
- Database timeout errors

**Solutions:**

```bash
# Check postgres is healthy
docker compose -f docker-compose.gh.ssl.yml ps postgres

# Check postgres logs
docker compose -f docker-compose.gh.ssl.yml logs postgres

# Verify database credentials in .env.oss.gh
cat .env.oss.gh | grep POSTGRES

# Test database connection
docker compose -f docker-compose.gh.ssl.yml exec postgres \
  psql -U agenta_admin -d agenta_oss_core -c "SELECT 1;"
```

#### 6. Out of Disk Space

**Symptoms:**
- Services won't start
- No space left on device errors

**Solutions:**

```bash
# Check disk usage
df -h
docker system df

# Clean up Docker resources
docker image prune -a  # Remove unused images
docker container prune  # Remove stopped containers
docker volume prune  # Remove unused volumes (CAREFUL!)
docker builder prune  # Remove build cache

# Check and clean logs
journalctl --vacuum-time=7d
```

### Checking Service Health

```bash
# Quick health check of all services
cd /opt/agenta/hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml ps

# Check which services are healthy
docker compose -f docker-compose.gh.ssl.yml ps | grep healthy

# Test API endpoint
curl https://agenta.bravetech.io/api/health

# Test web interface
curl -I https://agenta.bravetech.io/
```

### Debug Mode

**Enable debug logging for Traefik:**

Edit `/opt/agenta/hosting/docker-compose/oss/ssl/traefik.yml`:
```yaml
log:
  level: DEBUG  # Change from INFO to DEBUG
```

Then restart:
```bash
docker compose -f docker-compose.gh.ssl.yml restart traefik
```

---

## Backup & Recovery

### Database Backup

**Create backup:**
```bash
# Navigate to deployment directory
cd /opt/agenta/hosting/docker-compose/oss

# Create backup directory
mkdir -p /root/backups

# Backup all databases
docker compose -f docker-compose.gh.ssl.yml exec postgres \
  pg_dumpall -U agenta_admin > /root/backups/agenta_backup_$(date +%Y%m%d).sql

# Backup specific database
docker compose -f docker-compose.gh.ssl.yml exec postgres \
  pg_dump -U agenta_admin agenta_oss_core > /root/backups/agenta_core_$(date +%Y%m%d).sql
```

**Restore from backup:**
```bash
# Stop services
cd /opt/agenta/hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml down

# Start only postgres
docker compose -f docker-compose.gh.ssl.yml up -d postgres

# Wait for postgres to be ready
sleep 10

# Restore database
cat /root/backups/agenta_backup_20251022.sql | \
  docker compose -f docker-compose.gh.ssl.yml exec -T postgres \
  psql -U agenta_admin

# Restart all services
docker compose -f docker-compose.gh.ssl.yml \
  --env-file .env.oss.gh \
  --profile with-web \
  --profile with-traefik \
  up -d
```

### Automated Backup Script

**Create automated backup script:**
```bash
cat > /root/backup-agenta.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/root/backups"
DATE=$(date +%Y%m%d_%H%M%S)
KEEP_DAYS=7

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup database
cd /opt/agenta/hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml exec -T postgres \
  pg_dumpall -U agenta_admin | gzip > $BACKUP_DIR/agenta_$DATE.sql.gz

# Backup environment file
cp /opt/agenta/hosting/docker-compose/oss/.env.oss.gh $BACKUP_DIR/env_$DATE.backup

# Delete old backups
find $BACKUP_DIR -name "agenta_*.sql.gz" -mtime +$KEEP_DAYS -delete
find $BACKUP_DIR -name "env_*.backup" -mtime +$KEEP_DAYS -delete

echo "Backup completed: agenta_$DATE.sql.gz"
EOF

chmod +x /root/backup-agenta.sh
```

**Set up daily automated backup (cron):**
```bash
# Add to crontab
crontab -e

# Add this line (runs daily at 2 AM):
0 2 * * * /root/backup-agenta.sh >> /var/log/agenta-backup.log 2>&1
```

### Volume Backup

**Backup Docker volumes:**
```bash
# List volumes
docker volume ls | grep agenta

# Backup postgres volume
docker run --rm \
  -v agenta-gh-ssl_postgres-data:/data \
  -v /root/backups:/backup \
  alpine tar czf /backup/postgres-volume-$(date +%Y%m%d).tar.gz -C /data .

# Backup Redis volume
docker run --rm \
  -v agenta-gh-ssl_redis-data:/data \
  -v /root/backups:/backup \
  alpine tar czf /backup/redis-volume-$(date +%Y%m%d).tar.gz -C /data .
```

---

## Security

### Secrets Management

**IMPORTANT: All secrets must be kept local and never committed to git.**

**Environment Files (Contains Secrets):**
```
/opt/agenta/hosting/docker-compose/oss/.env.oss.gh   (Production server)
./hosting/docker-compose/oss/.env.oss.gh              (Local development)
./scripts/.env                                         (Local scripts)
```

**Protected by .gitignore:**
```
**/*.env*                    # All environment files
ssl_certificates/            # SSL certificates and ACME data
**/acme.json                # Let's Encrypt certificate data
**/docker-compose.override.yml  # Production-specific overrides
```

**Deploying Secrets to Production:**

1. **Never commit secrets to git** - Use the example file as a template:
   ```bash
   # On local machine, copy example to .env.oss.gh
   cp hosting/docker-compose/oss/env.oss.gh.example hosting/docker-compose/oss/.env.oss.gh
   # Fill in actual secrets locally
   ```

2. **Transfer secrets to production securely:**
   ```bash
   # Option 1: Copy via SCP (recommended)
   scp hosting/docker-compose/oss/.env.oss.gh root@91.98.229.196:/opt/agenta/hosting/docker-compose/oss/

   # Option 2: Edit directly on server
   ssh root@91.98.229.196
   cd /opt/agenta/hosting/docker-compose/oss
   vim .env.oss.gh
   ```

3. **Verify secrets are not tracked:**
   ```bash
   # Should show .env files as ignored
   git status --ignored
   ```

**Key Secrets in .env.oss.gh:**
- `AGENTA_AUTH_KEY` - Authentication key for Agenta API
- `AGENTA_CRYPT_KEY` - Encryption key for sensitive data
- Database passwords (PostgreSQL, Redis)
- API keys (OpenAI, Anthropic, etc.)
- SuperTokens connection URI

**Security Best Practices:**
1. Use strong, unique passwords for all services
2. Rotate credentials regularly
3. Keep local .env files backed up securely (encrypted)
4. Never share secrets via Slack, email, or other channels
5. Use environment-specific secrets (dev vs prod)

### Firewall Configuration

**Current UFW rules:**
```bash
# Check firewall status
ufw status

# Output:
# 22/tcp    ALLOW       (SSH)
# 80/tcp    ALLOW       (HTTP)
# 443/tcp   ALLOW       (HTTPS)
```

**Modify firewall:**
```bash
# Allow new port
ufw allow 1234/tcp

# Remove rule
ufw delete allow 1234/tcp

# Disable firewall (NOT recommended)
ufw disable

# Enable firewall
ufw enable
```

### Security Recommendations

**1. Create non-root user:**
```bash
# Create user
adduser agenta
usermod -aG sudo agenta
usermod -aG docker agenta

# Copy SSH keys
rsync --archive --chown=agenta:agenta ~/.ssh /home/agenta

# Disable root SSH login
vim /etc/ssh/sshd_config
# Set: PermitRootLogin no
systemctl restart sshd
```

**2. Change default RabbitMQ credentials:**

Edit `.env.oss.gh`:
```bash
RABBITMQ_DEFAULT_USER=your_username
RABBITMQ_DEFAULT_PASS=your_secure_password
```

Restart:
```bash
docker compose -f docker-compose.gh.ssl.yml restart rabbitmq
```

**3. Secure Traefik Dashboard:**

Either disable it or add authentication. Edit `ssl/traefik.yml`:
```yaml
api:
  dashboard: false  # Disable dashboard
  insecure: false
```

**4. Enable automatic security updates:**
```bash
apt install -y unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades
```

**5. Monitor logs for suspicious activity:**
```bash
# Check auth logs
tail -f /var/log/auth.log

# Check failed login attempts
grep "Failed password" /var/log/auth.log
```

### SSL Certificate Management

**Certificates are managed automatically by Traefik + Let's Encrypt.**

**Certificate location:**
```
/opt/agenta/ssl_certificates/acme.json
```

**Certificate renewal:**
- Automatic renewal happens 30 days before expiry
- Traefik handles this automatically
- No manual intervention needed

**Check certificate expiry:**
```bash
# View certificate details
openssl s_client -connect agenta.bravetech.io:443 -servername agenta.bravetech.io \
  </dev/null 2>/dev/null | openssl x509 -noout -dates
```

---

## Important Files & Paths

### Configuration Files

```
/opt/agenta/hosting/docker-compose/oss/.env.oss.gh
  ↳ Environment variables (domain, credentials, URLs)

/opt/agenta/hosting/docker-compose/oss/docker-compose.gh.ssl.yml
  ↳ Docker Compose configuration

/opt/agenta/hosting/docker-compose/oss/ssl/traefik.yml
  ↳ Traefik configuration (SSL, routing)

/opt/agenta/ssl_certificates/acme.json
  ↳ SSL certificates (auto-managed by Let's Encrypt)
```

### Data Directories (Docker Volumes)

```bash
# List all volumes
docker volume ls | grep agenta-gh-ssl

# Volumes:
# - agenta-gh-ssl_postgres-data (PostgreSQL data)
# - agenta-gh-ssl_redis-data (Redis data)
# - agenta-gh-ssl_rabbitmq-data (RabbitMQ data)
# - agenta-gh-ssl_cache-data (Cache data)
```

### Logs

```bash
# Docker container logs
docker compose -f docker-compose.gh.ssl.yml logs

# System logs
journalctl -u docker
/var/log/syslog
/var/log/auth.log
```

---

## Quick Reference

### Most Used Commands

```bash
# SSH into server
ssh root@91.98.229.196

# Navigate to deployment
cd /opt/agenta/hosting/docker-compose/oss

# Check status
docker compose -f docker-compose.gh.ssl.yml ps

# View logs
docker compose -f docker-compose.gh.ssl.yml logs -f

# Restart all
docker compose -f docker-compose.gh.ssl.yml restart

# Update and restart
docker compose -f docker-compose.gh.ssl.yml pull
docker compose -f docker-compose.gh.ssl.yml up -d

# Check resources
docker stats
free -h
df -h
```

### Emergency Procedures

**Complete restart:**
```bash
cd /opt/agenta/hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml down
docker compose -f docker-compose.gh.ssl.yml \
  --env-file .env.oss.gh \
  --profile with-web \
  --profile with-traefik \
  up -d
```

**Clean restart (removes containers, keeps data):**
```bash
cd /opt/agenta/hosting/docker-compose/oss
docker compose -f docker-compose.gh.ssl.yml down
docker system prune
docker compose -f docker-compose.gh.ssl.yml \
  --env-file .env.oss.gh \
  --profile with-web \
  --profile with-traefik \
  up -d
```

---

## Support & Resources

- **Agenta Documentation:** https://docs.agenta.ai
- **Agenta GitHub:** https://github.com/Agenta-AI/agenta
- **Our Fork:** https://github.com/The-Edgar/agenta
- **Agenta Slack:** https://join.slack.com/t/agenta-hq/shared_invite/...

---

## Deployment History

**Initial Deployment:** October 22, 2025
- Server: Hetzner CX23
- Domain: agenta.bravetech.io
- SSL: Let's Encrypt via Traefik
- Version: Based on v0.59.3+

**Key Decisions:**
1. Used pre-built images instead of building from source
2. Used `docker-compose.gh.ssl.yml` for SSL support
3. Modified web service to use pre-built image (`ghcr.io/agenta-ai/agenta-web:latest`)
4. DNS configured via Namecheap
5. Email for SSL: edgar@bravetech.io

---

## License

This deployment guide is specific to our Agenta instance. Agenta itself is licensed under the Apache License 2.0.

---

**Last Updated:** October 22, 2025
**Maintained By:** Edgar @ BraveTech
