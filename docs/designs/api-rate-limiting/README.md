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
| [throttling.concepts.specs.md](throttling.concepts.specs.md) | Core vocabulary: principals, categories, plans, enforcement |
| [throttling.policies.specs.md](throttling.policies.specs.md) | PAR(C) policy model, scoping modes, examples |
| [throttling.algorithms.specs.md](throttling.algorithms.specs.md) | TBRA vs GCRA algorithms, trade-offs, parameters |
| [throttling.implementation.specs.md](throttling.implementation.specs.md) | Three-layer architecture, Lua scripts, Python API |
| [throttling.middleware.specs.md](throttling.middleware.specs.md) | Middleware design, entitlements integration, plan-based limits |

## Quick Start

```python
from oss.src.utils.throttling import check_throttle, Algorithm

# Simple usage
result = await check_throttle("global", max_capacity=100, refill_rate=60)

# With dict key
result = await check_throttle({"org": org_id}, max_capacity=100, refill_rate=60)

# With GCRA algorithm (default)
result = await check_throttle(
    {"org": org_id, "policy": "cats:standard"},
    max_capacity=50,
    refill_rate=30,
    algorithm=Algorithm.GCRA,
)

if not result.allow:
    # Return 429 with Retry-After header
    retry_after = result.retry_after_seconds
```

## Key Concepts

**Principal**: Who is being limited (organization_id; IP not yet implemented)

**Categories**: Named endpoint groups (STANDARD, CORE_FAST, TRACING_SLOW, etc.)

**Plan**: Subscription tier that determines limits (HOBBY, PRO, BUSINESS)

**Policy**: PAR(C) rule mapping principal + plan + categories → bucket parameters

## Bucket Key Format

```
throttle:organization:{org_id}:plan:{plan}:policy:{slug}
```

Examples:
- `throttle:organization:org_abc123:plan:cloud_v0_pro:policy:cats:standard`
- `throttle:organization:org_abc123:plan:cloud_v0_hobby:policy:cats:core_fast,services_fast,tracing_fast`

## Response Headers

On 429 response:
```
Retry-After: 2
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
```

## Design Principles

1. **Redis is enforcement, not billing** — billing-grade quotas exist elsewhere
2. **Organization-first** — primary identifier is org_id, not user_id
3. **Fail-open by default** — allow requests when Redis is unavailable
4. **Atomic operations** — Lua scripts ensure correctness under concurrency
5. **GCRA by default** — smooth scheduling, minimal state, predictable behavior
