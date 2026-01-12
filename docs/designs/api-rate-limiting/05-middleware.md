# Throttling Middleware Design

## Overview

Add throttling middleware right after auth middleware to enforce rate limits based on:
- **Principal**: organization_id (authenticated) or IP (unauthenticated)
- **Plan**: organization's subscription tier
- **Endpoint group**: which group the request belongs to

## Request Flow

```
Request
    │
    ▼
┌─────────────────────┐
│   Auth Middleware   │  ← Sets request.state.organization_id
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│ Throttle Middleware │  ← NEW: Enforces rate limits
└─────────────────────┘
    │
    ▼
┌─────────────────────┐
│      Handler        │
└─────────────────────┘
```

---

## Entitlement Expansion

### Current Entitlement Structure

```python
class Tracker(str, Enum):
    FLAGS = "flags"       # Boolean feature flags
    COUNTERS = "counters" # Usage counters (monthly)
    GAUGES = "gauges"     # Resource gauges (hard limits)
```

### New Tracker: THROTTLES

```python
class Tracker(str, Enum):
    FLAGS = "flags"
    COUNTERS = "counters"
    GAUGES = "gauges"
    THROTTLES = "throttles"  # NEW: Rate limit policies
```

### Throttle Type Definition

```python
class ThrottlePrincipal(str, Enum):
    ORG = "org"  # organization_id
    IP = "ip"    # client IP address


class ThrottleScope(str, Enum):
    ALL = "all"        # All endpoints
    NONE = "none"      # No endpoints (disabled)
    INCLUDE = "include"  # Only specified groups/endpoints
    EXCLUDE = "exclude"  # All except specified groups/endpoints


@dataclass
class Throttle:
    principal: ThrottlePrincipal
    scope: ThrottleScope
    groups: list[str] = field(default_factory=list)      # e.g., ["otlp", "queries"]
    endpoints: list[str] = field(default_factory=list)   # e.g., ["POST /v1/reset"]
    max_capacity: int = 100
    refill_rate: int = 60  # per minute
```

### Throttle Keys

Each throttle definition gets a unique key for identification:

| Key | Description |
|-----|-------------|
| `global` | Global rate limit for all endpoints |
| `otlp` | OTLP ingest endpoint |
| `queries` | Span and analytics queries |
| `public` | Public/unauthenticated endpoints |
| `auth` | Auth and supertokens endpoints |
| `registry` | Entity fetch/retrieve endpoints |

---

## Entitlements by Plan

### CLOUD_V0_HOBBY (Free)

```python
Tracker.THROTTLES: {
    "global": Throttle(
        principal=ThrottlePrincipal.ORG,
        scope=ThrottleScope.ALL,
        max_capacity=100,
        refill_rate=60,  # 60 RPM
    ),
    "otlp": Throttle(
        principal=ThrottlePrincipal.ORG,
        scope=ThrottleScope.INCLUDE,
        groups=["otlp"],
        max_capacity=50,
        refill_rate=30,  # 30 RPM for OTLP
    ),
    "queries": Throttle(
        principal=ThrottlePrincipal.ORG,
        scope=ThrottleScope.INCLUDE,
        groups=["queries"],
        max_capacity=20,
        refill_rate=10,  # 10 RPM for queries
    ),
    "auth": Throttle(
        principal=ThrottlePrincipal.IP,
        scope=ThrottleScope.INCLUDE,
        groups=["auth"],
        max_capacity=10,
        refill_rate=5,  # 5 RPM for auth (IP-based)
    ),
}
```

### CLOUD_V0_PRO

```python
Tracker.THROTTLES: {
    "global": Throttle(
        principal=ThrottlePrincipal.ORG,
        scope=ThrottleScope.ALL,
        max_capacity=1000,
        refill_rate=500,  # 500 RPM
    ),
    "otlp": Throttle(
        principal=ThrottlePrincipal.ORG,
        scope=ThrottleScope.INCLUDE,
        groups=["otlp"],
        max_capacity=500,
        refill_rate=300,  # 300 RPM for OTLP
    ),
    "queries": Throttle(
        principal=ThrottlePrincipal.ORG,
        scope=ThrottleScope.INCLUDE,
        groups=["queries"],
        max_capacity=100,
        refill_rate=60,  # 60 RPM for queries
    ),
    "auth": Throttle(
        principal=ThrottlePrincipal.IP,
        scope=ThrottleScope.INCLUDE,
        groups=["auth"],
        max_capacity=20,
        refill_rate=10,  # 10 RPM for auth
    ),
}
```

### CLOUD_V0_BUSINESS / ENTERPRISE

```python
Tracker.THROTTLES: {
    "global": Throttle(
        principal=ThrottlePrincipal.ORG,
        scope=ThrottleScope.ALL,
        max_capacity=10000,
        refill_rate=5000,  # 5000 RPM
    ),
    # Higher limits for all groups...
}
```

---

## Endpoint Group Registry

```python
ENDPOINT_GROUPS: dict[str, list[str]] = {
    "otlp": [
        "POST /v1/otlp/traces",
    ],
    "queries": [
        "POST /v1/spans/query",
        "POST /v1/analytics/query",
    ],
    "public": [
        "GET /health",
        "GET /openapi.json",
        "GET /docs",
    ],
    "auth": [
        "POST /v1/auth/*",
        "POST /v1/supertokens/*",
        "GET /v1/supertokens/*",
    ],
    "registry": [
        "GET /v1/testsets/*",
        "GET /v1/apps/*",
        "GET /v1/evaluations/*",
        "GET /v1/traces/*",
    ],
}
```

### Group Resolution

```python
def resolve_endpoint_groups(method: str, path: str) -> list[str]:
    """Return list of groups this endpoint belongs to."""
    endpoint = f"{method} {path}"
    groups = []
    for group, patterns in ENDPOINT_GROUPS.items():
        for pattern in patterns:
            if _matches(endpoint, pattern):
                groups.append(group)
                break
    return groups
```

---

## Middleware Implementation

### ThrottleMiddleware

```python
class ThrottleMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # 1. Resolve principal
        org_id = getattr(request.state, "organization_id", None)
        client_ip = self._get_client_ip(request)

        # 2. Resolve endpoint groups
        endpoint_groups = resolve_endpoint_groups(request.method, request.url.path)

        # 3. Get throttle entitlements (cached)
        throttles = await self._get_throttles(org_id)

        # 4. Find applicable throttles
        applicable = self._filter_applicable(throttles, endpoint_groups)

        # 5. Build check list
        checks = []
        for key, throttle in applicable.items():
            principal_value = org_id if throttle.principal == "org" else client_ip
            if principal_value:
                checks.append((
                    {"t": key, "p": principal_value},  # key dict
                    throttle.max_capacity,
                    throttle.refill_rate,
                ))

        # 6. Execute throttle checks
        if checks:
            results = await check_throttles(checks)

            # 7. Find first denial
            for result in results:
                if not result.allowed:
                    return self._make_429_response(result)

        # 8. Proceed
        return await call_next(request)
```

### Get Throttles (Cached)

```python
async def _get_throttles(self, org_id: Optional[str]) -> dict[str, Throttle]:
    """Get throttle entitlements for organization, cached."""
    if not org_id:
        return DEFAULT_THROTTLES  # Anonymous/public throttles

    # Try cache first
    throttles = await get_cache(
        namespace="throttles",
        key={"org": org_id},
    )

    if throttles is not None:
        return throttles

    # Cache miss: fetch plan and get entitlements
    plan = await get_organization_plan(org_id)
    throttles = ENTITLEMENTS[plan][Tracker.THROTTLES]

    # Cache for 5 minutes
    await set_cache(
        namespace="throttles",
        key={"org": org_id},
        value=throttles,
    )

    return throttles
```

### Filter Applicable Throttles

```python
def _filter_applicable(
    self,
    throttles: dict[str, Throttle],
    endpoint_groups: list[str],
) -> dict[str, Throttle]:
    """Filter throttles that apply to this request."""
    applicable = {}

    for key, throttle in throttles.items():
        if throttle.scope == ThrottleScope.NONE:
            continue

        if throttle.scope == ThrottleScope.ALL:
            applicable[key] = throttle
            continue

        if throttle.scope == ThrottleScope.INCLUDE:
            # Only if endpoint is in specified groups
            if any(g in endpoint_groups for g in throttle.groups):
                applicable[key] = throttle
            continue

        if throttle.scope == ThrottleScope.EXCLUDE:
            # Only if endpoint is NOT in specified groups
            if not any(g in endpoint_groups for g in throttle.groups):
                applicable[key] = throttle
            continue

    return applicable
```

### 429 Response

```python
def _make_429_response(self, result: ThrottleResult) -> JSONResponse:
    retry_after = int(result.retry_after_seconds) + 1

    return JSONResponse(
        status_code=429,
        content={
            "error": "rate_limit_exceeded",
            "message": "Too many requests",
            "retry_after_seconds": result.retry_after_seconds,
        },
        headers={
            "Retry-After": str(retry_after),
            "X-RateLimit-Remaining": "0",
        },
    )
```

### Client IP Resolution

```python
def _get_client_ip(self, request: Request) -> str:
    """Get client IP, handling proxies."""
    # Check X-Forwarded-For (from load balancer/proxy)
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()

    # Check X-Real-IP
    real_ip = request.headers.get("X-Real-IP")
    if real_ip:
        return real_ip

    # Fallback to direct connection
    if request.client:
        return request.client.host

    return "unknown"
```

---

## Bucket Key Format

```
arl:{throttle_key}:{principal_type}:{principal_value}
```

Examples:
- `arl:t:global:p:org_abc123` — global limit for org
- `arl:t:otlp:p:org_abc123` — OTLP limit for org
- `arl:t:auth:p:192.168.1.100` — auth limit for IP

Using dict key in check_throttle:
```python
{"t": "global", "p": org_id}  → "arl:p:org_abc123:t:global"
{"t": "auth", "p": client_ip}  → "arl:p:192.168.1.100:t:auth"
```

---

## Registration

```python
# In main.py or app factory

from oss.src.core.throttle.middleware import ThrottleMiddleware

# Order matters: throttle AFTER auth
app.add_middleware(ThrottleMiddleware)
app.add_middleware(OrganizationPolicyMiddleware)  # Auth middleware
```

---

## File Structure

```
agenta/api/
├── oss/src/
│   ├── core/
│   │   └── throttle/
│   │       ├── __init__.py
│   │       ├── middleware.py    # ThrottleMiddleware
│   │       ├── groups.py        # ENDPOINT_GROUPS registry
│   │       └── types.py         # Throttle, ThrottlePrincipal, ThrottleScope
│   └── utils/
│       └── throttling.py        # check_throttle (already exists)
└── ee/src/
    └── core/
        └── entitlements/
            └── types.py         # Add Tracker.THROTTLES
```

---

## Summary

| Component | Location | Purpose |
|-----------|----------|---------|
| `Throttle` type | `oss/src/core/throttle/types.py` | Define throttle policy structure |
| `ENDPOINT_GROUPS` | `oss/src/core/throttle/groups.py` | Map endpoints to groups |
| `ThrottleMiddleware` | `oss/src/core/throttle/middleware.py` | Enforce rate limits |
| `Tracker.THROTTLES` | `ee/src/core/entitlements/types.py` | Add throttles to entitlements |
| `ENTITLEMENTS` | `ee/src/core/entitlements/types.py` | Define throttles per plan |
