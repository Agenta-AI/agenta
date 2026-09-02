"""The direct-call control-delivery adapter.

The API posts the command to the runner's own `/cancel`, over the same authenticated hop that
already carries hard kill. There is no held connection, no poll loop and no per-session Redis
channel: one runner process, one request.

WHAT THIS ADAPTER IS NOT ALLOWED TO DO. Durability, authorization, idempotency, the state
machine and terminal settlement all live in `SessionCommandsService`. This file is transport.
Replacing it with a long-poll adapter must change no route, no data shape and no transition.

THE ORDER IS NOT NEGOTIABLE. The command row is committed BEFORE `deliver` is called. Calling
first and recording afterwards would give back every failure the record exists to close: a crash
between the call and the insert leaves an aborted execution with no terminal outcome written
anywhere.

WHERE IT FAILS. `env.runner.internal_url` is one service address. Behind a load balancer with
two runner replicas the call reaches the right process only by luck. That failure is quiet at
the transport level, because the wrong process honestly answers "I do not hold that session" —
the same answer a session that really ended gives. Two things make it loud:

  * Refuse up front. When more than one replica has heartbeated inside the census window, this
    adapter answers `unreachable` with a reason instead of calling, so the command stays durable
    and the settlement sweep gives the user a terminal state.
  * Disambiguate afterwards. A `not_held` for a session whose row says alive with a fresh
    heartbeat is the wrong-replica failure and nothing else produces it. That test needs the
    session row, so it lives in the service, next to the settlement it decides.
"""

from uuid import UUID

from oss.src.core.sessions.commands.dtos import SessionCommand
from oss.src.core.sessions.commands.interfaces import (
    ControlDeliveryPort,
    DeliveryReceipt,
)
from oss.src.core.sessions.streams.runner_client import (
    RunnerCancelResult,
    cancel_runner_execution,
)
from oss.src.dbs.redis.shared.engine import LockEngine
from oss.src.dbs.redis.sessions.replicas import recent_replicas
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class DirectControlDelivery(ControlDeliveryPort):
    def __init__(
        self,
        *,
        lock_engine: LockEngine,
        timeout_seconds: float = None,
        census_seconds: int = None,
        single_replica_check: bool = None,
    ) -> None:
        commands = env.agenta.sessions.commands
        self._lock = lock_engine
        self._timeout = (
            timeout_seconds
            if timeout_seconds is not None
            else commands.delivery_timeout_seconds
        )
        self._census_seconds = (
            census_seconds
            if census_seconds is not None
            else commands.replica_census_seconds
        )
        self._single_replica_check = (
            single_replica_check
            if single_replica_check is not None
            else commands.single_replica_check
        )

    async def deliver(self, *, command: SessionCommand) -> DeliveryReceipt:
        refusal = await self._refuse_multi_replica()
        if refusal is not None:
            return refusal

        result = await cancel_runner_execution(
            command_id=str(command.id),
            project_id=str(command.project_id),
            session_id=command.session_id,
            target_turn_id=command.target_turn_id,
            created_at=command.created_at.isoformat() if command.created_at else "",
            timeout_seconds=self._timeout,
        )
        if result == RunnerCancelResult.accepted:
            return DeliveryReceipt(status="accepted")
        if result == RunnerCancelResult.not_held:
            return DeliveryReceipt(status="not_held")
        return DeliveryReceipt(status="unreachable")

    async def acknowledge(self, *, command_id: UUID, replica_id: str) -> None:
        """A no-op: the claim compare-and-set in the DAO IS the acknowledgement, and the direct
        adapter keeps no delivery bookkeeping of its own."""
        return None

    async def _refuse_multi_replica(self):
        """Refuse to guess which replica to call. Returns a receipt when it refuses."""
        if not self._single_replica_check:
            return None
        replicas = await recent_replicas(
            self._lock, window_seconds=self._census_seconds
        )
        if len(replicas) <= 1:
            return None
        log.error(
            "control delivery: the direct adapter is configured but %s runner replicas "
            "heartbeated in the last %ss (%s). A direct Stop can only reach one address, so it "
            "would land on the right process by luck. Switch AGENTA_SESSIONS_CONTROL_ADAPTER "
            "to long_poll, or run one runner.",
            len(replicas),
            self._census_seconds,
            ", ".join(sorted(replicas)),
        )
        return DeliveryReceipt(
            status="unreachable",
            detail=f"{len(replicas)} runner replicas are live; direct delivery cannot route",
        )
