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

from typing import Optional, Callable, Awaitable, Any, Union, TypeVar
import time
from enum import Enum

from pydantic import BaseModel
from redis.asyncio import Redis
from redis.exceptions import ResponseError

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
local rate_per_min = tonumber(ARGV[2])
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
    -- Calculate tokens to add: (elapsed_ms / 60000) * rate_per_min_scaled
    -- = (elapsed_ms * rate_per_min_scaled) / 60000
    -- This works correctly for any rate, including < 1 req/min
    tokens = tokens + (elapsed * rate_per_min) / 60000
    if tokens > max_cap then tokens = max_cap end
end

tokens = tokens - 1000
local allow = tokens >= 0 and 1 or 0

-- Calculate retry time in milliseconds
local retry = 0
if allow == 0 then
    -- How many milliseconds until we have enough tokens?
    -- Need: -tokens scaled tokens
    -- Rate: rate_per_min scaled tokens per 60000ms
    -- Time: (-tokens * 60000) / rate_per_min milliseconds
    retry = math.ceil((-tokens * 60000) / rate_per_min)
end

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


T = TypeVar("T")


async def _with_script_retry(
    operation: Callable[[], Awaitable[T]],
    operation_name: str = "script",
) -> T:
    """
    Execute a Redis Lua script operation with automatic NOSCRIPT retry.

    Args:
        operation: Async callable that executes the Redis operation
        operation_name: Name for logging (e.g., "script", "batch")

    Returns:
        Result from operation

    Raises:
        Exception: Re-raises non-NOSCRIPT exceptions
    """
    global _sha_tbra, _sha_gcra

    try:
        return await operation()

    except ResponseError as e:
        # Handle NOSCRIPT error (Redis script not loaded/evicted)
        if "NOSCRIPT" in str(e):
            _sha_tbra, _sha_gcra = None, None

            log.info(
                f"[throttle] [{operation_name}] NOSCRIPT detected, reloading scripts and retrying"
            )

            # Reload scripts and retry once
            await _ensure_scripts()

            return await operation()

        # Re-raise other Redis errors
        raise

    except Exception:
        # Unexpected errors (connection issues, etc.)
        log.error(f"[throttle] [{operation_name}] Unexpected error", exc_info=True)
        raise


async def _exec_script(sha: str, key: str, *args) -> list:
    """Execute single Lua script via evalsha with NOSCRIPT retry."""
    r = _get_redis()

    async def _do_exec():
        return await r.evalsha(sha, 1, key, *args)

    return await _with_script_retry(_do_exec, "single")


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
        rate: refill_rate * 1000 (scaled tokens per minute)

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


class ThrottleResult(BaseModel):
    key: str
    allow: bool
    tokens_remaining: Optional[float]
    retry_after_ms: Optional[int]

    @property
    def retry_after_seconds(self) -> float:
        if not self.retry_after_ms or self.retry_after_ms <= 0:
            return 0.0
        return self.retry_after_ms / 1000.0


def _key_to_str(key: Union[str, dict]) -> str:
    """
    Convert key to string representation.

    Args:
        key: Bucket key - str or dict

    Returns:
        String representation of key

    Examples:
        _key_to_str("global") -> "global"
        _key_to_str({"org": "abc123"}) -> "org:abc123"
        _key_to_str({"ep": "users", "org": "abc123"}) -> "ep:users:org:abc123"

    Raises:
        TypeError: If key is neither str nor dict
    """
    if isinstance(key, dict):
        return ":".join(f"{k}:{v}" for k, v in sorted(key.items()))
    elif isinstance(key, str):
        return key
    else:
        raise TypeError(f"key must be str or dict, got {type(key).__name__}")


def _build_key(key: Union[str, dict]) -> str:
    """
    Build Redis key from str or dict by prepending 'throttle:' prefix.

    Args:
        key: Bucket key - str or dict

    Returns:
        Full Redis key with 'throttle:' prefix

    Examples:
        _build_key("global") -> "throttle:global"
        _build_key({"org": "abc123"}) -> "throttle:org:abc123"
        _build_key({"ep": "users", "org": "abc123"}) -> "throttle:ep:users:org:abc123"

    Raises:
        TypeError: If key is neither str nor dict
    """
    return f"throttle:{_key_to_str(key)}"


def _to_tbra_params(max_capacity: int, refill_rate: int) -> tuple[int, int]:
    """
    Convert to TBRA params.

    Args:
        max_capacity: Burst size (tokens)
        refill_rate: Tokens per minute

    Returns:
        (capacity_scaled, rate_per_min_scaled)
        - capacity_scaled: Max tokens * 1000 (for fractional precision)
        - rate_per_min_scaled: Refill rate * 1000 (passed directly to Lua)

    Note:
        The Lua script now uses rate_per_min directly instead of rate_per_ms,
        allowing accurate handling of any rate including < 1 req/min.
    """
    # New algorithm: Pass rate per minute directly (scaled by 1000)
    # Lua calculates: tokens += (elapsed_ms * rate_per_min_scaled) / 60000
    # This works for ANY rate, even sub-1 req/min:
    #   0.1 req/min: (1000ms * 100) / 60000 = 1.67 scaled tokens/sec ✅
    #   1 req/min: (1000ms * 1000) / 60000 = 16.67 scaled tokens/sec ✅
    #   60 req/min: (1000ms * 60000) / 60000 = 1000 scaled tokens/sec ✅
    #   1200 req/min: (1000ms * 1200000) / 60000 = 20000 scaled tokens/sec ✅

    rate_per_min_scaled = refill_rate * _SCALE
    capacity_scaled = max_capacity * _SCALE

    return capacity_scaled, rate_per_min_scaled


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
        max_capacity: Burst size / max tokens (must be > 0)
        refill_rate: Tokens per minute (must be > 0)
        algorithm: TBRA or GCRA
        failure_mode: OPEN (allow) or CLOSED (deny) on Redis failure

    Returns:
        ThrottleResult with decision and timing

    Raises:
        ValueError: If max_capacity or refill_rate is <= 0
    """
    # Validate parameters
    if max_capacity <= 0:
        raise ValueError(f"max_capacity must be positive, got {max_capacity}")
    if refill_rate <= 0:
        raise ValueError(f"refill_rate must be positive, got {refill_rate}")

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
        log.error("[throttle] Unexpected error", key=key_str, exc_info=True)

        return _failure_result(key_str, failure_mode)


# =============================================================================
# Layer 2: Batch API
# =============================================================================


async def _execute_batch_pipeline(
    processed: list[tuple[str, str, int, int]],
    algorithm: Algorithm,
) -> list[ThrottleResult]:
    """
    Execute batch throttle check pipeline.

    Args:
        processed: List of (full_key, key_str, max_capacity, refill_rate)
        algorithm: TBRA or GCRA

    Returns:
        List of ThrottleResult
    """
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

    # Optimization: Single check bypasses pipeline
    if len(checks) == 1:
        key, max_capacity, refill_rate = checks[0]
        result = await check_throttle(
            key, max_capacity, refill_rate, algorithm, failure_mode
        )
        return [result]

    # Pre-process keys
    processed = []

    for key, max_capacity, refill_rate in checks:
        full_key = _build_key(key)
        key_str = _key_to_str(key)

        processed.append((full_key, key_str, max_capacity, refill_rate))

    try:

        async def _do_batch():
            return await _execute_batch_pipeline(processed, algorithm)

        return await _with_script_retry(_do_batch, "batch")

    except Exception:
        log.error("[throttle] [batch] Unexpected error", exc_info=True)

        return [_failure_result(ks, failure_mode) for _, ks, _, _ in processed]


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
DEFAULT_REFILL_RATE = 120  # per minute
DEFAULT_ALGORITHM = Algorithm.TBRA
