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
class Bucket(BaseModel):
    capacity: Optional[int] = None  # max tokens in the bucket
    rate: Optional[int] = None      # tokens added per minute
    algorithm: Optional[str] = None


class Mode(str, Enum):
    INCLUDE = "include"
    EXCLUDE = "exclude"


class Throttle(BaseModel):
    bucket: Bucket
    mode: Mode
    categories: list[Category] | None = None
    endpoints: list[tuple[Method, str]] | None = None
```

### Throttle Keys

Throttle keys are derived from the throttle definition:
- Categories → `cats:{comma-separated-category-values}`
- Endpoints → `eps:{comma-separated-method:path}`
- Fallback → `all`

---

## Entitlements by Plan

### CLOUD_V0_HOBBY (Free)

```python
Tracker.THROTTLES: [
    Throttle(
        categories=[Category.STANDARD],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=120, rate=120),
    ),
    Throttle(
        categories=[
            Category.CORE_FAST,
            Category.TRACING_FAST,
            Category.SERVICES_FAST,
        ],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=1200, rate=1200),
    ),
    Throttle(
        categories=[
            Category.CORE_SLOW,
            Category.TRACING_SLOW,
            Category.SERVICES_SLOW,
        ],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=120, rate=1),  # Burst of 120, then 1/min
    ),
]
```

### CLOUD_V0_PRO

```python
Tracker.THROTTLES: [
    Throttle(
        categories=[Category.STANDARD],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=360, rate=360),
    ),
    Throttle(
        categories=[
            Category.CORE_FAST,
            Category.TRACING_FAST,
            Category.SERVICES_FAST,
        ],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=3600, rate=3600),
    ),
    Throttle(
        categories=[
            Category.CORE_SLOW,
            Category.TRACING_SLOW,
            Category.SERVICES_SLOW,
        ],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=180, rate=1),  # Burst of 180, then 1/min
    ),
]
```

### CLOUD_V0_BUSINESS / ENTERPRISE

```python
Tracker.THROTTLES: [
    Throttle(
        categories=[Category.STANDARD],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=3600, rate=3600),
    ),
    Throttle(
        categories=[
            Category.CORE_FAST,
            Category.TRACING_FAST,
            Category.SERVICES_FAST,
        ],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=36000, rate=36000),
    ),
    Throttle(
        categories=[
            Category.CORE_SLOW,
            Category.TRACING_SLOW,
            Category.SERVICES_SLOW,
        ],
        mode=Mode.INCLUDE,
        bucket=Bucket(capacity=1800, rate=1),  # Burst of 1800, then 1/min
    ),
]
```

**Note on SLOW categories**: These endpoints (e.g., analytics queries, span queries) are expensive operations. The rate limit allows an initial burst but then restricts to 1 request per minute to prevent resource exhaustion.

---

## Endpoint Category Registry

```python
ENDPOINTS: dict[Category, list[tuple[Method, str]]] = {
    Category.CORE_FAST: [
        (Method.POST, "*/retrieve"),
    ],
    Category.TRACING_FAST: [
        (Method.POST, "/otlp/v1/traces"),
    ],
    Category.TRACING_SLOW: [
        (Method.POST, "/tracing/*/query"),
        (Method.POST, "/tracing/spans/analytics"),
    ],
    Category.SERVICES_FAST: [
        (Method.ANY, "/permissions/verify"),
    ],
    Category.STANDARD: [],
}
```

### Category Resolution

```python
def resolve_categories(method: str, path: str) -> set[Category]:
    categories = set()
    for category, endpoints in ENDPOINTS.items():
        for endpoint_method, endpoint_path in endpoints:
            if _matches_endpoint(method, path, endpoint_method, endpoint_path):
                categories.add(category)
                break

    if not categories:
        categories.add(Category.STANDARD)

    return categories
```

---

## Middleware Implementation

### Throttle Middleware (after auth)

```python
async def throttling_middleware(request: Request, call_next):
    org_id = getattr(request.state, "organization_id", None)
    if not org_id:
        return await call_next(request)

    # Plan resolution (cached)
    plan = await get_cached_plan(org_id)
    throttles = ENTITLEMENTS[plan][Tracker.THROTTLES]

    # Resolve categories for this endpoint
    categories = resolve_categories(request.method.lower(), request.url.path)

    # Build checks using ThrottleParamsResolver
    checks = []
    for throttle in throttles:
        if throttle_applies(throttle, categories, request):
            resolver = build_params_resolver(org_id, throttle)
            checks.append(await resolver(request))

    # Execute throttle checks
    results = await check_throttles(checks)
    for result in results:
        if not result.allow:
            return make_429(result)

    return await call_next(request)
```

### Plan Resolution (Cached)

Plan is cached per organization using `entitlements:subscription`:

```python
subscription_data = await get_cache(
    namespace="entitlements:subscription",
    key={"organization_id": org_id},
)

if subscription_data is None:
    subscription = await subscriptions_service.read(organization_id=org_id)
    subscription_data = {"plan": subscription.plan.value, "anchor": subscription.anchor}
    await set_cache(
        namespace="entitlements:subscription",
        key={"organization_id": org_id},
        value=subscription_data,
    )
```

### 429 Response

```python
return JSONResponse(
    status_code=429,
    content={"detail": "rate_limit_exceeded"},
    headers={"Retry-After": str(int(result.retry_after_seconds) + 1)},
)
```

---

## Bucket Key Format

```
throttle:organization:{org_id}:plan:{plan}:policy:{slug}
```

Examples:
- `throttle:organization:org_abc123:plan:cloud_v0_pro:policy:cats:core_fast,services_fast,tracing_fast`
- `throttle:organization:org_abc123:plan:cloud_v0_hobby:policy:cats:standard`

Using dict key in check_throttle:
```python
{"organization": org_id, "plan": plan, "policy": "cats:standard"}  → "throttle:organization:org_abc123:plan:cloud_v0_hobby:policy:cats:standard"
```

### Policy Slug

The policy slug serves as a unique identifier for logging and metrics. It is derived from the throttle definition:
- Categories → `cats:{comma-separated-sorted-category-values}`
- Endpoints → `epts:{comma-separated-sorted-method:path}`
- Fallback (no categories or endpoints) → `all`

---

## Registration

```python
app.middleware("http")(authentication_middleware)
app.middleware("http")(throttling_middleware)  # right after auth
```

---

## File Structure

```
agenta/api/
├── oss/src/
│   └── utils/
│       └── throttling.py        # check_throttle / check_throttles
└── ee/src/
    └── core/
        ├── entitlements/
        │   └── types.py         # Tracker.THROTTLES definitions
        └── throttle/
            └── middleware.py    # throttling_middleware
```

---

## Summary

| Component | Location | Purpose |
|-----------|----------|---------|
| `Throttle` type | `ee/src/core/entitlements/types.py` | Define throttle policy structure |
| `ENDPOINTS` | `ee/src/core/entitlements/types.py` | Map endpoints to categories |
| `throttling_middleware` | `ee/src/core/throttle/middleware.py` | Enforce rate limits |
| `Tracker.THROTTLES` | `ee/src/core/entitlements/types.py` | Throttles per plan |
