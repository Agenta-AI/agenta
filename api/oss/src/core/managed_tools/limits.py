"""A per-organization rate limit on each shared provider, over the Redis token bucket."""

from typing import Optional
from uuid import UUID

from oss.src.core.managed_tools.dtos import ManagedActionRateLimit
from oss.src.core.managed_tools.interfaces import ManagedActionRateLimiterInterface
from oss.src.utils.throttling import FailureMode, check_throttle


class RedisManagedActionRateLimiter(ManagedActionRateLimiterInterface):
    async def acquire(
        self,
        *,
        provider: str,
        organization_id: UUID,
        limit: ManagedActionRateLimit,
    ) -> Optional[int]:
        # Fails open: the limit protects the shared key's capacity; admission, which
        # protects money, fails closed on its own.
        result = await check_throttle(
            {"managed": provider, "org": str(organization_id)},
            max_capacity=limit.burst,
            refill_rate=limit.per_minute,
            failure_mode=FailureMode.OPEN,
        )
        if result.allow:
            return None
        return max(1, result.retry_after_ms or 1)
