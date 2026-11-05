from collections import defaultdict
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence, Tuple
from uuid import UUID

from oss.src.core.access.service import AccessService
from oss.src.core.memberships.service import MembershipsService
from oss.src.core.notifications.service import NotificationsService
from oss.src.core.sessions.executions.dtos import SessionExecutionSettlement
from oss.src.core.sessions.executions.interfaces import SessionExecutionsDAOInterface
from oss.src.core.sessions.records.dtos import TurnSignals
from oss.src.core.sessions.records.interfaces import RecordsDAOInterface
from oss.src.core.triggers.dtos import (
    Settled,
    TriggerDelivery,
    TriggerDeliveryOutcome as Outcome,
    UnsettledTriggerDelivery,
)
from oss.src.core.triggers.failure_notifications import FailureNotifications
from oss.src.core.triggers.interfaces import TriggersDAOInterface
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

PAGE_SIZE = 500
MAX_PAGES = 4

STARTED_STATUS_CODE = "202"
RUNNER_ERROR = "runner_error"
EXECUTION_LOST = "execution_lost"

TurnKey = Tuple[str, str]


def _paused_reason(delivery: TriggerDelivery) -> str:
    details = delivery.data.error_details if delivery.data else None
    return f"paused_{details.code if details else 'unknown'}"


# O1 to O4.
_START_ROWS = {
    "400": (Outcome.FAILED, lambda _: "bad_configuration"),
    "403": (Outcome.FAILED, _paused_reason),
    "422": (Outcome.SKIPPED, lambda _: "agent_needs_setup"),
    "500": (Outcome.FAILED, lambda _: "start_failed"),
}

# O5 to O8. Any other settled value is O10: it can only mean that the run was stopped.
_EXECUTION_ROWS = {
    "completed": Outcome.COMPLETED,
    "failed": Outcome.FAILED,
    "lost": Outcome.FAILED,
    "continued": Outcome.WAITING,
}

# O9 and the second half of O10, for a turn with no settled execution.
_STOP_REASON_ROWS = {
    "paused": Outcome.WAITING,
    "cancelled": Outcome.CANCELLED,
}


def _execution_error_code(execution: SessionExecutionSettlement) -> Optional[str]:
    return (execution.error or {}).get("code")


def _failed_reason(
    execution: SessionExecutionSettlement,
    signals: Optional[TurnSignals],
) -> str:
    if execution.terminal_outcome == "lost":
        return EXECUTION_LOST
    return (
        _execution_error_code(execution)
        or (signals.error_code if signals else None)
        or RUNNER_ERROR
    )


def settle(
    delivery: TriggerDelivery,
    execution: Optional[SessionExecutionSettlement],
    signals: Optional[TurnSignals],
) -> Optional[Settled]:
    """The settle table. None leaves the delivery unsettled."""
    code = delivery.status.code

    if code in _START_ROWS:
        outcome, reason = _START_ROWS[code]
        return Settled(
            outcome=outcome,
            reason_code=reason(delivery),
            ended_at=delivery.updated_at or delivery.created_at,
        )

    if code != STARTED_STATUS_CODE:
        return None

    if execution is not None:
        outcome = _EXECUTION_ROWS.get(execution.terminal_outcome, Outcome.CANCELLED)
        if outcome != Outcome.FAILED:
            return Settled(outcome=outcome)
        return Settled(
            outcome=outcome,
            reason_code=_failed_reason(execution, signals),
            ended_at=execution.settled_at or delivery.created_at,
        )

    outcome = _STOP_REASON_ROWS.get(signals.stop_reason) if signals else None
    return Settled(outcome=outcome) if outcome else None


def _turn_key(delivery: TriggerDelivery) -> Optional[TurnKey]:
    data = delivery.data
    if delivery.status.code != STARTED_STATUS_CODE or data is None:
        return None
    run_id = (data.result or {}).get("run_id")
    return (data.session_id, run_id) if data.session_id and run_id else None


def _needs_signals(execution: Optional[SessionExecutionSettlement]) -> bool:
    if execution is None:
        return True
    return execution.terminal_outcome == "failed" and not _execution_error_code(
        execution
    )


class OutcomesService:
    def __init__(
        self,
        *,
        triggers_dao: TriggersDAOInterface,
        session_executions_dao: SessionExecutionsDAOInterface,
        records_dao: RecordsDAOInterface,
        notifications_service: NotificationsService,
        memberships_service: MembershipsService,
        access_service: AccessService,
    ):
        self.triggers_dao = triggers_dao
        self.session_executions_dao = session_executions_dao
        self.records_dao = records_dao
        self.failure_notifications = FailureNotifications(
            triggers_dao=triggers_dao,
            notifications_service=notifications_service,
            memberships_service=memberships_service,
            access_service=access_service,
        )

    async def settle_pass(self) -> None:
        before: Optional[Tuple[datetime, UUID]] = None
        for _ in range(MAX_PAGES):
            page = await self.triggers_dao.query_unsettled_deliveries(
                before=before,
                limit=PAGE_SIZE,
            )
            if not page:
                return
            await self._settle_page(page)
            if len(page) < PAGE_SIZE:
                return
            before = (page[-1].created_at, page[-1].id)

    async def _settle_page(self, page: Sequence[UnsettledTriggerDelivery]) -> None:
        executions, signals = await self._read_turns(page)
        now = datetime.now(timezone.utc)

        # Oldest first, so a failure and a newer success of one automation open and
        # resolve before the send step reads them.
        for delivery in sorted(page, key=lambda row: (row.created_at, row.id)):
            turn = (delivery.project_id, _turn_key(delivery))
            try:
                settled = settle(delivery, executions.get(turn), signals.get(turn))
                if settled is None:
                    continue
                await self.failure_notifications.apply(
                    delivery=delivery,
                    settled=settled,
                    now=now,
                )
                await self.triggers_dao.settle_delivery(
                    project_id=delivery.project_id,
                    delivery_id=delivery.id,
                    status_code=delivery.status.code,
                    outcome=settled.outcome,
                    reason_code=settled.reason_code,
                )
            except Exception as error:  # pylint: disable=broad-exception-caught
                log.error(
                    "[triggers] failed to settle a delivery",
                    project_id=str(delivery.project_id),
                    delivery_id=str(delivery.id),
                    error_type=type(error).__name__,
                )

    async def _read_turns(
        self,
        page: Sequence[UnsettledTriggerDelivery],
    ) -> Tuple[
        Dict[Tuple[UUID, TurnKey], SessionExecutionSettlement],
        Dict[Tuple[UUID, TurnKey], TurnSignals],
    ]:
        keys_by_project: Dict[UUID, List[TurnKey]] = defaultdict(list)
        for delivery in page:
            key = _turn_key(delivery)
            if key is not None:
                keys_by_project[delivery.project_id].append(key)

        executions: Dict[Tuple[UUID, TurnKey], SessionExecutionSettlement] = {}
        signals: Dict[Tuple[UUID, TurnKey], TurnSignals] = {}
        for project_id, keys in keys_by_project.items():
            settled = await self.session_executions_dao.query_settled(
                project_id=project_id,
                keys=keys,
            )
            read = await self.records_dao.turn_signals(
                project_id=project_id,
                keys=[key for key in keys if _needs_signals(settled.get(key))],
            )
            executions.update({(project_id, k): v for k, v in settled.items()})
            signals.update({(project_id, k): v for k, v in read.items()})
        return executions, signals
