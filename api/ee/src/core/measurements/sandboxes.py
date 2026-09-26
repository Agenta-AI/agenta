"""Sandbox time on the platform's own provider account, as interval measurements.

The runner measures a sandbox from outside it and reports each interval it ran. This
module admits a turn that would start a sandbox, and turns a reported interval into a
`MeasurementCommandV1` on `streams:measurements`, where the measurement worker prices it
like any other measurement.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from oss.src.utils.context import AuthScope

from ee.src.core.measurements.components import (
    MEMORY_GIB_SECONDS,
    SANDBOX_SECONDS,
    VCPU_SECONDS,
)
from ee.src.core.measurements.rate_card import sandbox_rates_for
from ee.src.core.wallets.contracts import (
    GatewayKind,
    MeasurementCommandV1,
    MeasurementComponentV1,
)
from ee.src.core.wallets.interfaces import WalletCheckPort
from ee.src.core.wallets.streaming import MeasurementPublisher

# The runner reports every minute, so an interval this long is a bug, not a sandbox.
MAX_INTERVAL = timedelta(hours=1)

# Platform-funded, as a `builtin` gateway call is: the runner reports only sandboxes on
# the platform's own provider account.
SANDBOX_ENDPOINT_KIND = "builtin"


class SandboxIntervalInvalidError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


class SandboxUsageNotRecordedError(Exception):
    """The interval was valid but could not be handed to the measurement stream. The
    runner keeps it and reports it again; the measurement id makes that safe."""

    def __init__(self, message: str = "The sandbox interval could not be recorded."):
        self.message = message
        super().__init__(message)


class SandboxUsageInterval(BaseModel):
    """One interval a sandbox ran, with the resources it had while running."""

    provider: str = Field(min_length=1, max_length=32)
    sandbox_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    start_time: datetime
    end_time: datetime
    vcpu: int = Field(ge=1, le=64)
    memory_gib: int = Field(ge=1, le=512)
    session_id: Optional[str] = Field(default=None, max_length=128)
    agent_id: Optional[UUID] = None

    @model_validator(mode="after")
    def _a_positive_whole_second_span(self) -> "SandboxUsageInterval":
        # Whole seconds keep the measurement id and its values exact on every retry.
        for moment in (self.start_time, self.end_time):
            if moment.tzinfo is None or moment.microsecond:
                raise ValueError("interval bounds must be timezone-aware whole seconds")
        span = self.end_time - self.start_time
        if span <= timedelta(0) or span > MAX_INTERVAL:
            raise ValueError("interval must be longer than zero and at most an hour")
        return self

    @property
    def seconds(self) -> int:
        return int((self.end_time - self.start_time).total_seconds())


def sandbox_measurement(
    *,
    scope: AuthScope,
    interval: SandboxUsageInterval,
) -> MeasurementCommandV1:
    """The measurement for one reported interval. Deterministic in its inputs, so a
    retried report is the same measurement and is priced once.

    The organization and project come from the caller's credential, never the report,
    and the project is part of the id, so one tenant cannot claim another's interval.
    """
    if sandbox_rates_for(provider=interval.provider) is None:
        raise SandboxIntervalInvalidError(
            f"Sandbox provider {interval.provider!r} is not metered."
        )
    start = int(interval.start_time.timestamp())
    measurement_id = (
        f"sbx:{scope.project_id}:{interval.provider}:{interval.sandbox_id}:{start}"
    )
    seconds = interval.seconds
    references: Dict[str, Any] = {}
    if interval.session_id:
        references["session"] = {"id": interval.session_id}
    return MeasurementCommandV1(
        measurement_id=measurement_id,
        organization_id=scope.organization_id,
        project_id=scope.project_id,
        user_id=scope.user_id,
        agent_id=interval.agent_id,
        gateway_kind=GatewayKind.SBX,
        request_id=measurement_id,
        resource_key=f"sbx:{interval.provider}",
        resource_locator={
            "provider": interval.provider,
            "sandbox_id": interval.sandbox_id,
            "vcpu": interval.vcpu,
            "memory_gib": interval.memory_gib,
        },
        endpoint_kind=SANDBOX_ENDPOINT_KIND,
        start_time=interval.start_time,
        end_time=interval.end_time,
        components=[
            MeasurementComponentV1(key=SANDBOX_SECONDS, value=seconds),
            MeasurementComponentV1(key=VCPU_SECONDS, value=seconds * interval.vcpu),
            MeasurementComponentV1(
                key=MEMORY_GIB_SECONDS, value=seconds * interval.memory_gib
            ),
        ],
        references=references,
        created_at=datetime.now(timezone.utc),
    )


class SandboxUsageService:
    def __init__(self, *, wallet: WalletCheckPort, publisher: MeasurementPublisher):
        self.wallet = wallet
        self.publisher = publisher

    async def admit(self, *, scope: AuthScope) -> bool:
        """Whether a turn that runs a platform sandbox may start. The same spendable
        check as a `builtin` gateway call; nothing is reserved, and a turn already
        running is never stopped by it."""
        return await self.wallet.check(organization_id=scope.organization_id)

    async def record(
        self,
        *,
        scope: AuthScope,
        interval: SandboxUsageInterval,
    ) -> str:
        command = sandbox_measurement(scope=scope, interval=interval)
        if not await self.publisher.publish(command):
            raise SandboxUsageNotRecordedError()
        return command.measurement_id
