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

WHERE IT FAILS, AND HOW THAT IS MADE LOUD. `env.runner.internal_url` is one service address.
Behind a load balancer with two runner replicas the call reaches the right process only by luck.
That failure is quiet at the transport level, because the wrong process honestly answers "I do
not hold that session" — the same answer a session that really ended gives.

The detector is exact, and it is NOT in this file. A `not_held` for a session whose row says
alive with a heartbeat younger than one interval means some process is running that session and
it is not the one we just called; nothing else produces that. It needs the session row, so it
lives in `SessionCommandsService._settle_not_held`, next to the settlement it decides: the
command settles `lost` rather than `not_running`, so the user is told the Stop failed instead of
being told the work had already finished.

There is deliberately no replica census here. An earlier version counted the replica ids that
had heartbeated recently and refused to deliver when it saw more than one. It refused after
every ordinary runner restart, because a runner mints a fresh id at boot when
`AGENTA_RUNNER_REPLICA_ID` is unset, so its own previous id was still inside the window. That
broke Stop for the whole window after every deploy, which is worse than the failure it guarded.
"""

from typing import Awaitable, Callable, Optional
from uuid import UUID

from oss.src.core.sessions.commands.dtos import SessionCommand, SessionCommandKind
from oss.src.core.sessions.commands.interfaces import (
    ControlDeliveryPort,
    DeliveryReceipt,
)
from oss.src.core.sessions.streams.runner_client import (
    RunnerCancelResult,
    cancel_runner_execution,
)
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class DirectControlDelivery(ControlDeliveryPort):
    def __init__(
        self,
        *,
        timeout_seconds: Optional[float] = None,
        continue_interaction: Optional[
            Callable[[SessionCommand], Awaitable[None]]
        ] = None,
    ) -> None:
        self._timeout = (
            timeout_seconds
            if timeout_seconds is not None
            else env.agenta.sessions.commands.delivery_timeout_seconds
        )
        self._continue_interaction = continue_interaction

    async def deliver(self, *, command: SessionCommand) -> DeliveryReceipt:
        if command.kind == SessionCommandKind.continue_interaction:
            if self._continue_interaction is None:
                return DeliveryReceipt(
                    status="unreachable",
                    detail="continuation delivery is not configured",
                )
            try:
                await self._continue_interaction(command)
            except Exception as error:  # noqa: BLE001 - transport maps failures to receipts
                return DeliveryReceipt(status="unreachable", detail=str(error))
            return DeliveryReceipt(status="accepted", replica_id="direct")

        answer = await cancel_runner_execution(
            command_id=str(command.id),
            project_id=str(command.project_id),
            session_id=command.session_id,
            target_turn_id=command.target_turn_id,
            created_at=command.created_at.isoformat() if command.created_at else "",
            timeout_seconds=self._timeout,
        )
        if answer.status == RunnerCancelResult.accepted:
            # The answering replica's own id, so the claim the service writes matches the id
            # the runner reports its outcome with.
            return DeliveryReceipt(status="accepted", replica_id=answer.replica_id)
        if answer.status == RunnerCancelResult.not_held:
            return DeliveryReceipt(status="not_held")
        return DeliveryReceipt(status="unreachable")

    async def acknowledge(self, *, command_id: UUID, replica_id: str) -> None:
        """A no-op: the claim compare-and-set in the DAO IS the acknowledgement, and the direct
        adapter keeps no delivery bookkeeping of its own."""
        return None
