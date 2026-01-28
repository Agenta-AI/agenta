# Webhooks for Config Sync - Planning Workspace

## Overview
Research and planning for implementing webhooks in Agenta to enable real-time notifications when configuration changes occur (e.g., config deployed to production).

## Problem Statement
Users want automatic sync to GitHub when a PM saves/deploys a new config version. Currently, they must either:
- Fetch config via API at deploy time
- Run scheduled GitHub Actions to sync
- Use runtime fetch with caching

**Gap**: No real-time notification when config changes.

---

## Documents

| File | Description |
|------|-------------|
| [research.md](./research.md) | Industry research: Stripe, GitHub, and other webhook patterns |
| [architecture.md](./architecture.md) | Architecture options analysis leveraging existing infrastructure |
| [api-design.md](./api-design.md) | Proposed API endpoints and payload formats |
| [schema.md](./schema.md) | Database schema proposal for webhooks |
| [context.md](./context.md) | Codebase context, existing infrastructure, integration points |
| [plan.md](./plan.md) | Implementation plan with phases and timeline |

---

## Key Decisions

### 1. Architecture: Taskiq + Redis Streams
**Why**: Agenta already uses this pattern for evaluations (`EvaluationsWorker`). Zero new infrastructure needed.

### 2. Existing Infrastructure Leveraged
| Component | Purpose |
|-----------|---------|
| `redis-durable:6381` | Taskiq broker (Redis Streams) |
| PostgreSQL | Webhooks & deliveries tables |
| Cron container | Cleanup & stuck retry jobs |
| Taskiq | Task queue with built-in retries |

### 3. MVP Scope
- Single event: `config.deployed`
- Project-level webhooks
- HMAC-SHA256 signatures
- Automatic retries (6 attempts)
- Delivery history (30 days)

### 4. Security: HMAC-SHA256 (Industry Standard)
```
X-Agenta-Signature: t=1705318200,v1=5d2c3b1a...
```
Same pattern as Stripe and GitHub.

---

## Quick Reference

### Webhook Payload Format
```json
{
  "id": "event-uuid",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "type": "config.deployed",
  "api_version": "2024-01",
  "project_id": "project-uuid",
  "data": {
    "application": { "id": "...", "name": "my-app" },
    "variant": { "id": "...", "slug": "gpt4", "version": 5 },
    "environment": { "id": "...", "name": "production" },
    "config": { "params": { ... } },
    "deployed_by": { "id": "...", "email": "..." }
  }
}
```

### New Files Structure
```
api/
├── entrypoints/
│   └── worker_webhooks.py                    # Worker entrypoint
├── oss/src/
│   ├── routers/webhooks_router.py            # CRUD API
│   ├── services/webhook_service.py           # Event emission
│   ├── tasks/taskiq/webhooks/worker.py       # Taskiq tasks
│   ├── models/api/webhook_models.py          # Pydantic models
│   └── crons/
│       ├── webhooks.txt                      # Crontab
│       ├── webhooks-cleanup.sh
│       └── webhooks-retry.sh
└── hosting/docker-compose/                   # Add worker service
```

### Timeline
**~3-4 weeks** (13-17 dev days)

---

## Status

- [x] Research complete (Stripe, GitHub, and industry patterns)
- [x] Architecture decided (Taskiq + Redis Streams)
- [x] API design complete
- [x] Database schema designed
- [x] Implementation plan created
- [ ] RFC review
- [ ] Implementation started
