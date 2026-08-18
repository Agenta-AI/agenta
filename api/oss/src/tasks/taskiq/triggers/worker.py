from typing import Any, Dict, Optional
from uuid import UUID

from taskiq import AsyncBroker, Context, TaskiqDepends

from oss.src.core.triggers.dtos import TRIGGER_MAX_RETRIES
from oss.src.core.triggers.interfaces import TriggersDAOInterface
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class TriggersWorker:
    """Registers and owns the TaskIQ trigger dispatch tasks.

    Schedules and Composio subscriptions use separate tasks because their entry
    differs (DB lookup vs inline row); both converge on ``dispatcher.dispatch``.
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
        dispatcher: TriggersDispatcher,
        triggers_dao: TriggersDAOInterface,
    ):
        self.broker = broker
        self.dispatcher = dispatcher
        self.triggers_dao = triggers_dao

        self._register_tasks()

    def _register_tasks(self):
        @self.broker.task(
            task_name="triggers.dispatch",
            retry_on_error=True,
            max_retries=TRIGGER_MAX_RETRIES,
        )
        async def dispatch_trigger(
            *,
            trigger_id: str,
            event_id: str,
            event: Dict[str, Any],
            #
            context: Context = TaskiqDepends(),
        ) -> None:
            retry_count_raw = context.message.labels.get("_taskiq_retry_count", 0) or 0
            try:
                retry_count = int(retry_count_raw)
            except (TypeError, ValueError):
                retry_count = 0

            log.info(
                f"[TASK] triggers.dispatch "
                f"trigger={trigger_id} event={event_id} "
                f"attempt={retry_count}/{TRIGGER_MAX_RETRIES}"
            )

            resolved = (
                await self.triggers_dao.get_project_and_subscription_by_trigger_id(
                    trigger_id=trigger_id,
                )
            )

            if resolved is None:
                level = log.warning if env.composio.webhook_target else log.info
                level(
                    "[TASK] triggers.dispatch Unknown trigger_id %s — skipping",
                    trigger_id,
                )
                return

            project_id, subscription = resolved

            await self.dispatcher.dispatch_subscription(
                project_id=project_id,
                subscription=subscription,
                event_id=event_id,
                event=event,
            )

        self.dispatch_trigger = dispatch_trigger

        @self.broker.task(
            task_name="triggers.dispatch_schedule",
            retry_on_error=True,
            max_retries=TRIGGER_MAX_RETRIES,
        )
        async def dispatch_schedule(
            *,
            project_id: str,
            event_id: str,
            event: Dict[str, Any],
            schedule_id: Optional[str] = None,
            schedule: Optional[Dict[str, Any]] = None,
            #
            context: Context = TaskiqDepends(),
        ) -> None:
            queued_schedule_id = schedule_id or (schedule or {}).get("id")
            if queued_schedule_id is None:
                log.warning(
                    "[TASK] triggers.dispatch_schedule Missing schedule id — skipping"
                )
                return

            resolved_project_id = UUID(project_id)
            entity = await self.triggers_dao.fetch_schedule(
                project_id=resolved_project_id,
                schedule_id=UUID(str(queued_schedule_id)),
            )
            if entity is None or not entity.flags.is_active:
                log.info(
                    "[TASK] triggers.dispatch_schedule Schedule %s is deleted or inactive — skipping",
                    queued_schedule_id,
                )
                return

            log.info(
                f"[TASK] triggers.dispatch_schedule "
                f"schedule={entity.id} event={event_id}"
            )

            await self.dispatcher.dispatch_schedule(
                project_id=resolved_project_id,
                schedule=entity,
                event_id=event_id,
                event=event,
            )

        self.dispatch_schedule = dispatch_schedule
