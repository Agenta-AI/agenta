from typing import Any, Dict

from taskiq import AsyncBroker, Context, TaskiqDepends

from oss.src.core.triggers.dtos import TRIGGER_MAX_RETRIES
from oss.src.tasks.asyncio.triggers.dispatcher import TriggersDispatcher
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class TriggersWorker:
    """Registers and owns the TaskIQ trigger dispatch task.

    The dispatch task receives the verified Composio event inline and runs the
    bound workflow, writing a single delivery row on the outcome. Idempotency
    comes from the WP3 ``dedup_seen`` guard, so provider + TaskIQ retries are safe.
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
        dispatcher: TriggersDispatcher,
    ):
        self.broker = broker
        self.dispatcher = dispatcher

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

            await self.dispatcher.dispatch(
                trigger_id=trigger_id,
                event_id=event_id,
                event=event,
            )

        self.dispatch_trigger = dispatch_trigger
