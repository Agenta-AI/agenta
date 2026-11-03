"""Fakes for the managed tool executor's three ports."""

import asyncio
from typing import Any, Callable, Dict, List, Optional
from uuid import UUID, uuid4

from oss.src.core.managed_tools.dtos import (
    ManagedAction,
    ManagedActionContext,
    ManagedActionMeasurement,
    ManagedActionPrice,
    ManagedActionRateLimit,
    ManagedActionResponse,
)
from oss.src.core.managed_tools.interfaces import (
    ManagedActionBillingInterface,
    ManagedActionProviderInterface,
    ManagedActionRateLimiterInterface,
)


class FakeProvider(ManagedActionProviderInterface):
    def __init__(
        self,
        name: str,
        *,
        answer: Optional[Callable[..., Any]] = None,
        rate_limit: Optional[ManagedActionRateLimit] = None,
    ) -> None:
        self.name = name
        self.rate_limit = rate_limit
        self.calls: List[Dict[str, Any]] = []
        self._answer = answer

    async def invoke(self, *, operation, arguments, context) -> ManagedActionResponse:
        self.calls.append(
            {"operation": operation, "arguments": arguments, "context": context}
        )
        result = self._answer(operation=operation, arguments=arguments)
        if asyncio.iscoroutine(result):
            result = await result
        return result


class FakeBilling(ManagedActionBillingInterface):
    def __init__(
        self,
        *,
        allowed: bool = True,
        prices: Optional[Dict[str, ManagedActionPrice]] = None,
        admit_raises: Optional[BaseException] = None,
        admit_delay: float = 0.0,
        record_raises: Optional[BaseException] = None,
        record_delay: float = 0.0,
    ) -> None:
        self.allowed = allowed
        self._prices = prices or {}
        self.admit_raises = admit_raises
        self.admit_delay = admit_delay
        self.record_raises = record_raises
        self.record_delay = record_delay
        self.admitted: List[str] = []
        self.recorded: List[ManagedActionMeasurement] = []

    async def prices(self) -> Dict[str, ManagedActionPrice]:
        return self._prices

    async def admit(self, *, organization_id: UUID, action: ManagedAction) -> bool:
        self.admitted.append(action.key)
        if self.admit_delay:
            await asyncio.sleep(self.admit_delay)
        if self.admit_raises is not None:
            raise self.admit_raises
        return self.allowed

    async def record(self, *, measurement: ManagedActionMeasurement) -> None:
        if self.record_delay:
            await asyncio.sleep(self.record_delay)
        if self.record_raises is not None:
            raise self.record_raises
        self.recorded.append(measurement)


class FakeRateLimiter(ManagedActionRateLimiterInterface):
    def __init__(self, *, retry_after_ms: Optional[int] = None, raises=None) -> None:
        self.retry_after_ms = retry_after_ms
        self.raises = raises
        self.keys: List[tuple] = []

    async def acquire(self, *, provider, organization_id, limit) -> Optional[int]:
        self.keys.append((provider, organization_id))
        if self.raises is not None:
            raise self.raises
        return self.retry_after_ms


def context(**overrides) -> ManagedActionContext:
    values = dict(
        organization_id=uuid4(),
        project_id=uuid4(),
        user_id=uuid4(),
        run_id="run-1",
        session_id="session-1",
        agent_id=str(uuid4()),
    )
    values.update(overrides)
    return ManagedActionContext(**values)
