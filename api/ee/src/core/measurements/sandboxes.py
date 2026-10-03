"""Sandbox time on the platform's own provider account, as interval measurements.

The runner measures a sandbox from outside it and reports each interval it ran. This
module admits a turn that would start a sandbox, and turns a reported interval into a
`MeasurementCommandV1` on `streams:measurements`, where the measurement worker prices it
like any other measurement.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

from oss.src.utils.context import AuthScope
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

from ee.src.core.measurements.components import (
    MEMORY_GIB_SECONDS,
    SANDBOX_SECONDS,
    VCPU_SECONDS,
)
from ee.src.core.measurements.rate_card import (
    SANDBOX_STANDARD,
    sandbox_rate_tier,
    sandbox_rates_for,
)
from ee.src.core.wallets.admission import admit_in_mode, measured
from ee.src.core.wallets.caps import (
    CONCURRENT_TURNS_LIMIT_CODE,
    TURN_SLOT_TTL_SECONDS,
    WALLET_BALANCE_EXHAUSTED_CODE,
    TurnAdmission,
    TurnLimit,
    SessionTurnHoldsInterface,
    TurnSlotsInterface,
    concurrent_turns_message,
    credit_exhausted_message,
    turn_caps_for,
    turn_length_message,
)
from ee.src.core.wallets.contracts import (
    GatewayKind,
    MeasurementCommandV1,
    MeasurementComponentV1,
)
from ee.src.core.wallets.interfaces import WalletCheckPort
from ee.src.core.wallets.streaming import MeasurementPublisher

log = get_module_logger(__name__)

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
    rate_tier: str = SANDBOX_STANDARD,
) -> MeasurementCommandV1:
    """The measurement for one reported interval. Deterministic in its inputs, so a
    retried report is the same measurement and is priced once. The rate tier is the
    plan's when the interval is recorded, so later processing cannot change its price.

    The organization and project come from the caller's credential, never the report,
    and the project is part of the id, so one tenant cannot claim another's interval.
    """
    if sandbox_rates_for(provider=interval.provider, tier=rate_tier) is None:
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
            "rate_tier": rate_tier,
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
    def __init__(
        self,
        *,
        wallet: WalletCheckPort,
        publisher: MeasurementPublisher,
        turn_slots: TurnSlotsInterface,
        session_holds: SessionTurnHoldsInterface,
        plan_for: Callable[[UUID], Awaitable[Optional[str]]],
    ):
        self.wallet = wallet
        self.publisher = publisher
        self.turn_slots = turn_slots
        self.session_holds = session_holds
        self.plan_for = plan_for

    async def admit(
        self,
        *,
        scope: AuthScope,
        turn_id: Optional[str] = None,
        session_id: Optional[str] = None,
    ) -> TurnAdmission:
        """Whether a turn that runs a platform sandbox may start, and the limits it runs
        under. The same spendable check as a `builtin` gateway call; nothing is reserved,
        and a turn already running is never stopped for its balance. Its plan caps how
        many such turns the organization runs at once and how long each runs.

        Nothing is capped for an organization whose wallet is `off`. A plan or slot store
        that cannot answer admits uncapped: a metering outage must not stop agents.
        """
        organization_id = scope.organization_id
        # Caps apply exactly where usage is measured: `shadow` and `enforce`.
        if not await measured(organization_id):
            return TurnAdmission(allowed=True)
        try:
            plan = await self.plan_for(organization_id)
        except Exception:  # noqa: BLE001 - an unknown plan admits uncapped
            log.warning(
                "[wallets] plan unavailable; turn admitted uncapped",
                organization_id=str(organization_id),
                exc_info=True,
            )
            plan = None
        if not await admit_in_mode(
            organization_id=organization_id,
            point="sandbox",
            check=lambda: self.wallet.check(organization_id=organization_id),
        ):
            return TurnAdmission(
                allowed=False,
                code=WALLET_BALANCE_EXHAUSTED_CODE,
                message=credit_exhausted_message(plan),
            )
        caps = turn_caps_for(plan)
        if caps is None:
            # A plan with no turn cap is bounded by the gateway credential's lifetime,
            # the longest any turn can reach the gateway at all.
            await self._hold_session(
                organization_id=organization_id,
                session_id=session_id,
                turn_id=turn_id,
                ttl_seconds=env.gateway_credentials.ttl_seconds,
            )
            return TurnAdmission(allowed=True)
        slot_held = False
        if turn_id:
            try:
                slot_held = await self.turn_slots.acquire(
                    organization_id=organization_id,
                    turn_id=turn_id,
                    limit=caps.concurrent_turns,
                    ttl_seconds=TURN_SLOT_TTL_SECONDS,
                )
            except Exception:  # noqa: BLE001 - the count is a cap, not a ledger
                log.warning(
                    "[wallets] running turns unavailable; turn admitted uncounted",
                    organization_id=str(organization_id),
                    exc_info=True,
                )
            else:
                if not slot_held:
                    return TurnAdmission(
                        allowed=False,
                        code=CONCURRENT_TURNS_LIMIT_CODE,
                        message=concurrent_turns_message(plan, caps),
                    )
        await self._hold_session(
            organization_id=organization_id,
            session_id=session_id,
            turn_id=turn_id,
            ttl_seconds=caps.max_turn_seconds,
        )
        return TurnAdmission(
            allowed=True,
            turn_limit=TurnLimit(
                seconds=caps.max_turn_seconds,
                message=turn_length_message(plan, caps),
            ),
            slot_held=slot_held,
        )

    async def renew_turn(self, *, scope: AuthScope, turn_id: str) -> None:
        await self.turn_slots.renew(
            organization_id=scope.organization_id,
            turn_id=turn_id,
            ttl_seconds=TURN_SLOT_TTL_SECONDS,
        )

    async def release_turn(
        self, *, scope: AuthScope, turn_id: str, session_id: Optional[str] = None
    ) -> None:
        # The session hold is let go even when the slot release fails: a hold that
        # outlives its turn serves model calls past zero until it expires.
        try:
            await self.turn_slots.release(
                organization_id=scope.organization_id, turn_id=turn_id
            )
        finally:
            if session_id:
                await self.session_holds.release(
                    organization_id=scope.organization_id,
                    session_id=session_id,
                    turn_id=turn_id,
                )

    async def _hold_session(
        self,
        *,
        organization_id: UUID,
        session_id: Optional[str],
        turn_id: Optional[str],
        ttl_seconds: int,
    ) -> None:
        """Let the gateway serve this turn's platform-funded model calls without a
        balance check until the turn ends or its limit passes: an admitted turn is never
        stopped for its balance (caps.md). A hold that cannot be written leaves the
        turn's calls checked one by one, as does a turn that names no session."""
        if not (session_id and turn_id):
            return
        try:
            await self.session_holds.hold(
                organization_id=organization_id,
                session_id=session_id,
                turn_id=turn_id,
                ttl_seconds=ttl_seconds,
            )
        except Exception:  # noqa: BLE001
            log.warning(
                "[wallets] session hold unavailable; the turn's model calls stay checked",
                organization_id=str(organization_id),
                exc_info=True,
            )

    async def record(
        self,
        *,
        scope: AuthScope,
        interval: SandboxUsageInterval,
    ) -> Optional[str]:
        """The measurement id, or None for an organization whose wallet is `off`: its
        interval is acknowledged and dropped, so the runner does not report it again."""
        # Validated first, so a report for an unmetered provider is refused in any mode.
        sandbox_measurement(scope=scope, interval=interval)
        if not await measured(scope.organization_id):
            return None
        try:
            plan = await self.plan_for(scope.organization_id)
        except Exception as exc:  # noqa: BLE001 - the runner reports the interval again
            raise SandboxUsageNotRecordedError() from exc
        command = sandbox_measurement(
            scope=scope, interval=interval, rate_tier=sandbox_rate_tier(plan)
        )
        if not await self.publisher.publish(command):
            raise SandboxUsageNotRecordedError()
        return command.measurement_id
