"""
API Rate Limiting (Throttling) via Redis.

Operates at millisecond precision for accurate high-rate throttling.

Three-layer architecture:

Layer 1 (Scripts): Raw Redis Lua execution
    Methods:
    - execute_tbra(key, capacity, rate)
    - execute_gcra(key, interval, tolerance)
    Details:
    - All time values in milliseconds
    - Computes current time internally

Layer 2 (Library): Public API with precomputation
    Methods:
    - check_throttle(key, max_capacity, refill_rate, ...)
    Details:
    - Accepts key as str or dict
    - Converts user-friendly rates (req/min) to algorithm-specific params
    - Handles failures

Layer 3 (User code): Middleware/decorators that resolve:
    Methods:
    -
    Details:
    - key: from endpoint, org_id, user_id, headers, etc
    - params: from plan lookup, config, callbacks, etc

Usage (simple - global limit):
    result = await check_throttle("global", max_capacity=1000, refill_rate=100)

Usage (with dict key):
    result = await check_throttle({"org": org_id}, max_capacity=100, refill_rate=60)

Usage (with multiple dimensions):
    result = await check_throttle({"ep": endpoint, "org": org_id}, ...)
"""

import time
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Callable, Awaitable, Any, Union

from redis.asyncio import Redis

from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

log = get_module_logger(__name__)


# =============================================================================
# Configuration
# =============================================================================

THROTTLE_DEBUG = False
THROTTLE_SOCKET_TIMEOUT = 0.1

# Fixed-point scale for TBRA (tokens scaled by 1000 for sub-token precision)
_SCALE = 1000

# TTL: 60 minutes
_TTL_MS = 3600000

# Redis client
_redis: Optional[Redis] = None


def _get_redis() -> Redis:
    global _redis
    if _redis is None:
        _redis = Redis.from_url(
            url=env.redis.uri_volatile,
            decode_responses=False,
            socket_timeout=THROTTLE_SOCKET_TIMEOUT,
        )
    return _redis


def _now_ms() -> int:
    """Current time in milliseconds since epoch."""
    return int(time.time() * 1000)


# =============================================================================
# Layer 1: Lua Scripts (raw Redis execution)
# =============================================================================

_LUA_TBRA = """
local key = KEYS[1]
local max_cap = tonumber(ARGV[1])
local rate = tonumber(ARGV[2])
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
    tokens = tokens + elapsed * rate
    if tokens > max_cap then tokens = max_cap end
end

tokens = tokens - 1000
local allow = tokens >= 0 and 1 or 0
local retry = allow == 1 and 0 or math.ceil(-tokens / rate)

redis.call('SET', key, tokens .. '|' .. now, 'PX', 3600000)

return {allow, tokens, retry}
"""

_LUA_GCRA = """
local key = KEYS[1]
local interval = tonumber(ARGV[1])
local tolerance = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

local tat = tonumber(redis.call('GET', key)) or now

local limit = tat - tolerance
local allow, retry, new_tat, remaining

if now < limit then
    allow = 0
    retry = limit - now
    new_tat = tat
    remaining = 0
else
    allow = 1
    retry = 0
    new_tat = (tat > now and tat or now) + interval
    -- Remaining burst capacity: how many more requests before hitting the limit
    -- remaining = (tolerance - (new_tat - now)) / interval
    local used = new_tat - now
    if used < tolerance then
        remaining = math.floor((tolerance - used) / interval)
    else
        remaining = 0
    end
end

redis.call('SET', key, new_tat, 'PX', 3600000)

return {allow, remaining, retry}
"""

_sha_tbra: Optional[str] = None
_sha_gcra: Optional[str] = None


async def _ensure_scripts() -> tuple[str, str]:
    global _sha_tbra, _sha_gcra

    r = _get_redis()

    if _sha_tbra is None or _sha_gcra is None:
        _sha_tbra = await r.script_load(_LUA_TBRA)
        _sha_gcra = await r.script_load(_LUA_GCRA)

    return str(_sha_tbra), str(_sha_gcra)


async def _exec_script(sha: str, key: str, *args) -> list:
    global _sha_tbra, _sha_gcra

    r = _get_redis()

    try:
        return await r.evalsha(sha, 1, key, *args)

    except Exception as e:
        if "NOSCRIPT" in str(e):
            _sha_tbra, _sha_gcra = None, None

            await _ensure_scripts()

            return await r.evalsha(sha, 1, key, *args)

        raise


async def execute_tbra(
    key: str,
    capacity: int,
    rate: int,
) -> tuple[bool, float, int]:
    """
    Layer 1: Execute TBRA script.

    Args:
        key: Full Redis key
        capacity: capacity * 1000 (scaled tokens)
        rate: tokens per millisecond * 1000 (scaled rate)

    Returns:
        (allow, tokens_remaining, retry_ms)
    """
    sha_tbra, _ = await _ensure_scripts()

    now_ms = _now_ms()

    result = await _exec_script(sha_tbra, key, capacity, rate, now_ms)

    allow, tokens_scaled, retry_ms = result

    return bool(allow), tokens_scaled / _SCALE, int(retry_ms)


async def execute_gcra(
    key: str,
    interval: int,
    tolerance: int,
) -> tuple[bool, float, int]:
    """
    Layer 1: Execute GCRA script.

    Args:
        key: Full Redis key
        interval: Milliseconds between requests at steady rate
        tolerance: Burst tolerance in milliseconds

    Returns:
        (allow, tokens_remaining, retry_ms)
    """
    _, sha_gcra = await _ensure_scripts()

    now_ms = _now_ms()

    result = await _exec_script(sha_gcra, key, interval, tolerance, now_ms)

    allow, tokens_remaining, retry_ms = result

    return bool(allow), float(tokens_remaining), int(retry_ms)


# =============================================================================
# Layer 2: Library API
# =============================================================================


class Algorithm(Enum):
    TBRA = "tbra"
    GCRA = "gcra"


class FailureMode(Enum):
    OPEN = "open"
    CLOSED = "closed"


@dataclass(frozen=True)
class ThrottleResult:
    key: str
    allow: bool
    tokens_remaining: Optional[float]
    retry_after_ms: Optional[int]

    @property
    def retry_after_seconds(self) -> float:
        if not self.retry_after_ms or self.retry_after_ms <= 0:
            return 0.0
        return self.retry_after_ms / 1000.0


def _build_key(key: Union[str, dict]) -> str:
    """
    Build Redis key from str or dict.

    If str: use as-is
    If dict: join sorted key-value pairs with ':'

    Examples:
        _build_key("global") -> "throttle:global"
        _build_key({"org": "abc123"}) -> "throttle:org:abc123"
        _build_key({"ep": "users", "org": "abc123"}) -> "throttle:ep:users:org:abc123"
    """
    if isinstance(key, dict):
        key_str = ":".join(f"{k}:{v}" for k, v in sorted(key.items()))
    elif isinstance(key, str):
        key_str = key
    else:
        raise TypeError("key must be str or dict")

    return f"throttle:{key_str}"


def _key_to_str(key: Union[str, dict]) -> str:
    """Convert key to string for result/logging."""
    if isinstance(key, dict):
        return ":".join(f"{k}:{v}" for k, v in sorted(key.items()))

    return key


def _to_tbra_params(max_capacity: int, refill_rate: int) -> tuple[int, int]:
    """
    Convert to TBRA params.

    Args:
        max_capacity: Burst size (tokens)
        refill_rate: Tokens per minute

    Returns:
        (capacity_scaled, rate_scaled_per_ms)
        - capacity_scaled: Max tokens * 1000 (for fractional precision)
        - rate_scaled_per_ms: Tokens added per millisecond * 1000
    """
    # Rate = tokens added per millisecond (scaled by 1000)
    # For 120 req/min: (120 * 1000) / 60000 = 2 scaled tokens/ms
    # For 1200 req/min: (1200 * 1000) / 60000 = 20 scaled tokens/ms
    rate = (refill_rate * _SCALE) // 60000

    if rate < 1:
        rate = 1

    capacity = max_capacity * _SCALE

    return capacity, rate


def _to_gcra_params(max_capacity: int, refill_rate: int) -> tuple[int, int]:
    """
    Convert to GCRA params.

    Args:
        max_capacity: Burst tolerance (requests)
        refill_rate: Requests per minute

    Returns:
        (interval_ms, tolerance_ms)
        - interval_ms: Milliseconds between requests at steady rate
        - tolerance_ms: Burst tolerance in milliseconds
    """
    # Interval = milliseconds between requests
    # For 120 req/min: 60000/120 = 500ms between requests
    # For 1200 req/min: 60000/1200 = 50ms between requests
    interval = 60000 // refill_rate if refill_rate > 0 else 1

    if interval < 1:
        interval = 1

    tolerance = max_capacity * interval

    return interval, tolerance


def _failure_result(key: str, failure_mode: FailureMode) -> ThrottleResult:
    return ThrottleResult(
        allow=(failure_mode == FailureMode.OPEN),
        tokens_remaining=None,
        retry_after_ms=None,
        key=key,
    )


async def check_throttle(
    key: Union[str, dict],
    max_capacity: int,
    refill_rate: int,
    algorithm: Algorithm = Algorithm.TBRA,
    failure_mode: FailureMode = FailureMode.OPEN,
) -> ThrottleResult:
    """
    Layer 2: Check rate limit and consume one token.

    Args:
        key: Bucket key - str or dict
            str: "global", "org:123", "ep:users:org:123"
            dict: {"org": "123"}, {"ep": "users", "org": "123"}
        max_capacity: Burst size / max tokens
        refill_rate: Tokens per minute
        algorithm: TBRA or GCRA
        failure_mode: OPEN (allow) or CLOSED (deny) on Redis failure

    Returns:
        ThrottleResult with decision and timing
    """
    full_key = _build_key(key)
    key_str = _key_to_str(key)

    try:
        if algorithm == Algorithm.TBRA:
            max_cap_s, refill_s = _to_tbra_params(
                max_capacity,
                refill_rate,
            )

            allow, tokens, retry_ms = await execute_tbra(
                full_key,
                max_cap_s,
                refill_s,
            )

            return ThrottleResult(
                allow=allow,
                tokens_remaining=max(0.0, tokens),
                retry_after_ms=retry_ms,
                key=key_str,
            )

        elif algorithm == Algorithm.GCRA:
            interval, tolerance = _to_gcra_params(
                max_capacity,
                refill_rate,
            )

            allow, tokens_remaining, retry_ms = await execute_gcra(
                full_key,
                interval,
                tolerance,
            )

            return ThrottleResult(
                allow=allow,
                tokens_remaining=tokens_remaining,
                retry_after_ms=retry_ms,
                key=key_str,
            )

        else:
            log.warning("[throttle] Unknown algorithm", algorithm=algorithm)

            return _failure_result(key_str, failure_mode)

    except Exception:
        log.warning("[throttle] Unexpected error", key=key_str, exc_info=True)

        return _failure_result(key_str, failure_mode)


# =============================================================================
# Layer 2: Batch API
# =============================================================================


async def check_throttles(
    checks: list[tuple[Union[str, dict], int, int]],
    algorithm: Algorithm = Algorithm.TBRA,
    failure_mode: FailureMode = FailureMode.OPEN,
) -> list[ThrottleResult]:
    """
    Check multiple rate limits in a pipeline.

    Args:
        checks: List of (key, max_capacity, refill_rate) where key is str or dict
        algorithm: TBRA or GCRA
        failure_mode: OPEN or CLOSED on failure

    Returns:
        List of ThrottleResult
    """
    if not checks:
        return []

    if algorithm not in (Algorithm.TBRA, Algorithm.GCRA):
        log.warning("[throttle] [batch] Unknown algorithm", algorithm=algorithm)

        return [_failure_result(_key_to_str(key), failure_mode) for key, _, _ in checks]

    # Pre-process keys
    processed = []

    for key, max_capacity, refill_rate in checks:
        full_key = _build_key(key)
        key_str = _key_to_str(key)

        processed.append((full_key, key_str, max_capacity, refill_rate))

    try:
        r = _get_redis()

        sha_tbra, sha_gcra = await _ensure_scripts()

        sha = sha_tbra if algorithm == Algorithm.TBRA else sha_gcra

        now_ms = _now_ms()

        pipe = r.pipeline(transaction=False)

        for full_key, _, max_capacity, refill_rate in processed:
            if algorithm == Algorithm.TBRA:
                max_cap_s, refill_s = _to_tbra_params(max_capacity, refill_rate)
                pipe.evalsha(sha, 1, full_key, max_cap_s, refill_s, now_ms)

            elif algorithm == Algorithm.GCRA:
                interval, tolerance = _to_gcra_params(max_capacity, refill_rate)
                pipe.evalsha(sha, 1, full_key, interval, tolerance, now_ms)

        raw_results = await pipe.execute()

        results = []

        for (_, key_str, max_capacity, _), raw in zip(processed, raw_results):
            if algorithm == Algorithm.TBRA:
                allow, tokens_scaled, retry_ms = raw
                results.append(
                    ThrottleResult(
                        allow=bool(allow),
                        tokens_remaining=max(0.0, tokens_scaled / _SCALE),
                        retry_after_ms=int(retry_ms),
                        key=key_str,
                    )
                )

            elif algorithm == Algorithm.GCRA:
                allow, tokens_remaining, retry_ms = raw
                results.append(
                    ThrottleResult(
                        allow=bool(allow),
                        tokens_remaining=float(tokens_remaining),
                        retry_after_ms=int(retry_ms),
                        key=key_str,
                    )
                )

        return results

    except Exception:
        log.warning("[throttle] [batch] Unexpected error", exc_info=True)

        return [_failure_result(ks, failure_mode) for _, ks, _, _ in processed]


# =============================================================================
# Layer 2: Utilities
# =============================================================================


async def peek_throttle(key: Union[str, dict]) -> Optional[dict]:
    """View bucket state without consuming."""
    try:
        r = _get_redis()

        full_key = _build_key(key)
        val = await r.get(full_key)

        if not val:
            return None

        val_str = val.decode() if isinstance(val, bytes) else val

        if "|" in val_str:
            tokens_str, ts_str = val_str.split("|")

            return {"tokens": float(tokens_str) / _SCALE, "last_step": int(ts_str)}

        else:
            return {"tat": int(val_str)}

    except Exception as e:
        log.warning("[throttle] PEEK ERROR", error=str(e))

        return None


async def reset_throttle(key: Union[str, dict]) -> bool:
    """Delete bucket."""
    try:
        r = _get_redis()

        full_key = _build_key(key)

        return await r.delete(full_key) > 0

    except Exception as e:
        log.warning("[throttle] RESET ERROR", error=str(e))

        return False


# =============================================================================
# Layer 3 Helpers: For building middleware/decorators
# =============================================================================

# Type for param resolver callback
ThrottleParamsResolver = Callable[
    [Any],  # request or context
    Awaitable[tuple[Union[str, dict], int, int]],  # (key, max_capacity, refill_rate)
]

# Default params for simple usage
DEFAULT_MAX_CAPACITY = 1000
DEFAULT_REFILL_RATE = 100  # per minute
DEFAULT_ALGORITHM = Algorithm.TBRA
