# API Rate Limiting

Redis-based rate limiting for API protection with support for multiple algorithms and flexible policy definitions.

## Overview

This system provides distributed rate limiting using Redis with:
- **Two algorithms**: TBRA (Token Bucket) and GCRA (Generic Cell Rate Algorithm)
- **PAR(C) policies**: Principal, Action, Resource, Condition model
- **Three-layer architecture**: Scripts → Library → Middleware
- **Fail-safe modes**: Open or closed on Redis failure

## Documentation

| Document | Description |
|----------|-------------|
| [01-concepts.md](01-concepts.md) | Core vocabulary: principals, groups, plans, enforcement |
| [02-policies.md](02-policies.md) | PAR(C) policy model, scoping modes, examples |
| [03-algorithms.md](03-algorithms.md) | TBRA vs GCRA algorithms, trade-offs, parameters |
| [04-implementation.md](04-implementation.md) | Three-layer architecture, Lua scripts, Python API |

## Quick Start

```python
from oss.src.utils.throttling import check_throttle, Algorithm

# Simple usage
result = await check_throttle("global", max_capacity=100, refill_rate=60)

# With dict key
result = await check_throttle({"org": org_id}, max_capacity=100, refill_rate=60)

# With GCRA algorithm
result = await check_throttle(
    {"org": org_id, "group": "llm"},
    max_capacity=50,
    refill_rate=30,
    algorithm=Algorithm.GCRA,
)

if not result.allow:
    # Return 429 with Retry-After header
    retry_after = result.retry_after_seconds
```

## Key Concepts

**Principal**: Who is being limited (organization_id or IP)

**Endpoint Groups**: Named collections of endpoints (llm, auth, exports)

**Plan**: Subscription tier that determines limits (free, pro, enterprise)

**Policy**: PAR(C) rule mapping principal + plan + scope → bucket parameters

## Bucket Key Format

```
throttle:{key-components}
```

Examples:
- `throttle:global` — global limit
- `throttle:org:abc123` — organization limit
- `throttle:group:llm:org:abc123` — organization limit for LLM group

## Response Headers

On 429 response:
```
Retry-After: 2
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1704672000
```

## Design Principles

1. **Redis is enforcement, not billing** — billing-grade quotas exist elsewhere
2. **Organization-first** — primary identifier is org_id, not user_id
3. **Fail-open by default** — allow requests when Redis is unavailable
4. **Atomic operations** — Lua scripts ensure correctness under concurrency
5. **Time computed in application** — avoids extra Redis time call per request
