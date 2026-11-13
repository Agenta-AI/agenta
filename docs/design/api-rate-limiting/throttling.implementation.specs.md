# Implementation

Three-layer architecture for rate limiting with Redis.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: User Code (Middleware/Decorators)                  │
│   - Resolves key from request context                       │
│   - Resolves params from plan lookup                        │
│   - Handles 429 response                                    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Library API                                        │
│   check_throttle(key, max_capacity, refill_rate, ...)       │
│   - Accepts key as str or dict                              │
│   - Converts to algorithm-specific params                   │
│   - Handles Redis failures                                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Lua Scripts                                        │
│   _exec_tbra(key, max_cap_scaled, refill_scaled)            │
│   _exec_gcra(key, interval, tolerance)                      │
│   - Uses current time from caller                           │
│   - Atomic read-modify-write                                │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
                    ┌───────────────┐
                    │     Redis     │
                    └───────────────┘
```

---

## Layer 1: Lua Scripts

### TBRA Script

```lua
local key = KEYS[1]
local max_cap = tonumber(ARGV[1])
local refill = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local val = redis.call('GET', key)
local tokens, last

if val then
    local sep = string.find(val, '|')
    tokens = tonumber(string.sub(val, 1, sep - 1))
    last = tonumber(string.sub(val, sep + 1))
else
    tokens = max_cap
    last = now
end

local elapsed = now - last
if elapsed > 0 then
    tokens = tokens + elapsed * refill
    if tokens > max_cap then tokens = max_cap end
end

tokens = tokens - 1000
local allow = tokens >= 0 and 1 or 0
local retry = allow == 1 and 0 or math.ceil(-tokens / refill)

redis.call('SET', key, tokens .. '|' .. now, 'PX', 3600000)

return {allow, tokens, retry}
```

### GCRA Script

```lua
local key = KEYS[1]
local interval = tonumber(ARGV[1])
local tolerance = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local tat = tonumber(redis.call('GET', key)) or now

local limit = tat - tolerance
local allow, retry, new_tat

if now < limit then
    allow = 0
    retry = limit - now
    new_tat = tat
else
    allow = 1
    retry = 0
    new_tat = (tat > now and tat or now) + interval
end

redis.call('SET', key, new_tat, 'PX', 3600000)

return {allow, retry}
```

### Script Loading

Scripts are loaded lazily with SCRIPT LOAD and invoked via EVALSHA:

```python
async def _ensure_scripts() -> tuple[str, str]:
    global _sha_tb, _sha_gcra
    if _sha_tb is None or _sha_gcra is None:
        r = _get_redis()
        _sha_tb = await r.script_load(_LUA_TBRA)
        _sha_gcra = await r.script_load(_LUA_GCRA)
    return str(_sha_tb), str(_sha_gcra)
```

### NOSCRIPT Handling

When Redis restarts, scripts are flushed. Handle NOSCRIPT by reloading:

```python
async def _exec_script(sha: str, key: str, *args) -> list:
    try:
        return await r.evalsha(sha, 1, key, *args)
    except Exception as e:
        if "NOSCRIPT" in str(e):
            _sha_tb, _sha_gcra = None, None
            await _ensure_scripts()
            return await r.evalsha(sha, 1, key, *args)
        raise
```

---

## Layer 2: Library API

### Key Building

Keys can be `str` or `dict`:

```python
def _build_key(key: Union[str, dict]) -> str:
    if isinstance(key, dict):
        key_str = ":".join(f"{k}:{v}" for k, v in sorted(key.items()))
    elif isinstance(key, str):
        key_str = key
    else:
        raise TypeError("key must be str or dict")
    return f"throttle:{key_str}"
```

Examples:
- `"global"` → `throttle:global`
- `{"org": "abc123"}` → `throttle:org:abc123`
- `{"group": "llm", "org": "abc123"}` → `throttle:group:llm:org:abc123`

### Parameter Conversion

Convert user-friendly params to algorithm-specific:

```python
def _to_tbra_params(max_capacity: int, refill_rate: int) -> tuple[int, int]:
    max_cap_scaled = max_capacity * _SCALE
    refill_per_step_scaled = (refill_rate * TIME_STEP_MS * _SCALE) // 60000
    if refill_per_step_scaled < 1:
        refill_per_step_scaled = 1
    return max_cap_scaled, refill_per_step_scaled

def _to_gcra_params(max_capacity: int, refill_rate: int) -> tuple[int, int]:
    interval = 60000 // (refill_rate * TIME_STEP_MS) if refill_rate > 0 else 1
    if interval < 1:
        interval = 1
    tolerance = max_capacity * interval
    return interval, tolerance
```

### Public API

```python
async def check_throttle(
    key: Union[str, dict],
    max_capacity: int,
    refill_rate: int,
    algorithm: Algorithm = Algorithm.TBRA,
    failure_mode: FailureMode = FailureMode.OPEN,
) -> ThrottleResult:
    """
    Check rate limit and consume one token.

    Args:
        key: Bucket key - str or dict
        max_capacity: Burst size / max tokens
        refill_rate: Tokens per minute
        algorithm: TBRA or GCRA
        failure_mode: OPEN (allow) or CLOSED (deny) on Redis failure

    Returns:
        ThrottleResult with decision and timing
    """
```

### Result Type

```python
@dataclass(frozen=True)
class ThrottleResult:
    allow: bool
    tokens_remaining: Optional[float]  # None for GCRA
    retry_after_ms: Optional[int]
    key: str

    @property
    def retry_after_seconds(self) -> float:
        return self.retry_after_ms / 1000.0 if self.retry_after_ms and self.retry_after_ms > 0 else 0.0
```

### Batch API

Check multiple limits in a single pipeline:

```python
async def check_throttles(
    checks: list[tuple[Union[str, dict], int, int]],
    algorithm: Algorithm = Algorithm.TBRA,
    failure_mode: FailureMode = FailureMode.OPEN,
) -> list[ThrottleResult]:
```

### Utilities

```python
async def peek_throttle(key: Union[str, dict]) -> Optional[dict]:
    """View bucket state without consuming."""

async def reset_throttle(key: Union[str, dict]) -> bool:
    """Delete bucket."""
```

---

## Layer 3: Middleware

User code resolves key and params from request context:

```python
from oss.src.utils.throttling import check_throttle, Algorithm, FailureMode

async def rate_limit_middleware(request, call_next):
    # 1. Resolve principal
    org_id = request.state.organization_id

    # 2. Resolve plan and get params
    plan = await get_plan(org_id)
    params = get_rate_limit_params(plan)

    # 3. Check throttle
    result = await check_throttle(
        key={"org": org_id},
        max_capacity=params.capacity,
        refill_rate=params.refill_rate,
    )

    # 4. Handle denial
    if not result.allow:
        return JSONResponse(
            status_code=429,
            content={"error": "rate_limit_exceeded"},
            headers={"Retry-After": str(int(result.retry_after_seconds) + 1)},
        )

    # 5. Proceed
    return await call_next(request)
```

### Multi-Policy Enforcement

```python
async def check_all_policies(org_id: str, endpoint_groups: list[str]):
    checks = []

    # Global limit
    checks.append(({"org": org_id}, 1000, 500))

    # Group-specific limits
    if "llm" in endpoint_groups:
        checks.append(({"group": "llm", "org": org_id}, 500, 300))

    results = await check_throttles(checks)

    # Deny if any denies
    for result in results:
        if not result.allow:
            return result  # Return first denial

    return None  # All allowed
```

---

## Configuration

### Constants

```python
# Time step: 1 second
TIME_STEP_MS = 1000

# Fixed-point scale for TBRA
_SCALE = 1000

# TTL: 60 minutes (hardcoded in scripts)
_TTL_MS = 3600000

# Redis socket timeout
THROTTLE_SOCKET_TIMEOUT = 0.1
```

### Redis Client

```python
def _get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(
            url=env.redis.uri_volatile,
            decode_responses=False,
            socket_timeout=THROTTLE_SOCKET_TIMEOUT,
        )
    return _redis
```

---

## Failure Handling

### Fail-Open (Default)

When Redis is unavailable, allow the request:

```python
if failure_mode == FailureMode.OPEN:
    return ThrottleResult(
        allow=True,
        tokens_remaining=None,
        retry_after_ms=None,
        key=key_str,
    )
```

### Fail-Closed

When Redis is unavailable, deny the request:

```python
if failure_mode == FailureMode.CLOSED:
    return ThrottleResult(
        allow=False,
        tokens_remaining=None,
        retry_after_ms=None,
        key=key_str,
    )
```

---

## Response Headers

On 429 response, include:

```python
headers = {
    "Retry-After": str(int(result.retry_after_seconds) + 1),
    "X-RateLimit-Limit": str(max_capacity),
    "X-RateLimit-Remaining": str(int(result.tokens_remaining or 0)),
}
```

For TBRA, `tokens_remaining` provides a meaningful value.
For GCRA, omit `X-RateLimit-Remaining` or set to 0.

---

## Testing

### Unit Tests

- Algorithm math (refill, cap, consume)
- Retry-after correctness
- Edge cases: zero refill, capacity=0
- Key building (str and dict)

### Integration Tests

- Concurrent requests from multiple workers
- Atomicity under contention
- NOSCRIPT recovery after Redis restart

### Load Tests

- High QPS, verify Redis latency
- Multiple policies per request
- Hot key behavior
