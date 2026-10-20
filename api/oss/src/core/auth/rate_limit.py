import asyncio

from supertokens_python.framework.request import BaseRequest

from oss.src.core.auth.turnstile import get_client_ip
from oss.src.dbs.redis.shared.engine import get_cache_engine
from oss.src.utils.env import env
from oss.src.utils.exceptions import TooManyRequestsException
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

AUTH_CODE_RATE_LIMIT_MESSAGE = "Too many sign-in attempts. Try again in a few minutes."

_KEY_PREFIX = "auth:code:rate_limit:"

# The most time the check adds to a sign-in request. redis-py retries a failed command with
# backoff, so without a bound a Redis outage would add seconds to every sign-in.
_REDIS_TIMEOUT_SECONDS = 0.5

# True while Redis is failing, so an outage logs one warning and not one per request.
_redis_failing = False

# INCR and the first EXPIRE in one step, so a worker that dies between the two cannot
# leave a counter that never expires.
_INCR_WITH_WINDOW = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
"""


async def enforce_auth_code_rate_limit(
    *,
    request: BaseRequest,
    api_name: str,
) -> None:
    """Allow at most `requests_per_window` calls per client IP per `window_seconds`.

    The counter is shared by every endpoint that calls this, so the limit covers them
    together. The window is fixed: it starts at the first request and the counter is
    dropped when it expires. When Redis cannot be reached or is slow the request is
    allowed, and the outage is logged once.
    """
    global _redis_failing

    config = env.agenta.auth_code_rate_limit
    if not config.enabled:
        return

    client_ip = get_client_ip(request)
    if not client_ip:
        return

    try:
        count = await asyncio.wait_for(
            get_cache_engine().eval(
                _INCR_WITH_WINDOW,
                1,
                _KEY_PREFIX + client_ip,
                config.window_seconds,
            ),
            timeout=_REDIS_TIMEOUT_SECONDS,
        )
    except Exception:
        if not _redis_failing:
            _redis_failing = True
            log.warning(
                "[AUTH] Auth code rate limit skipped until Redis answers again api_name=%s reason=redis_unavailable",
                api_name,
                exc_info=True,
            )
        return

    if _redis_failing:
        _redis_failing = False
        log.info("[AUTH] Auth code rate limit active again, Redis answers")

    if int(count) <= config.requests_per_window:
        return

    log.warning(
        "[AUTH] Auth code rate limit exceeded api_name=%s client_ip=%s count=%s limit=%s window_seconds=%s",
        api_name,
        client_ip,
        count,
        config.requests_per_window,
        config.window_seconds,
    )
    raise TooManyRequestsException(message=AUTH_CODE_RATE_LIMIT_MESSAGE)
