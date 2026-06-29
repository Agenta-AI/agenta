from typing import Any
from uuid import UUID

from taskiq import AsyncBroker, Context, TaskiqDepends

from oss.src.tasks.asyncio.sessions.interactions_dispatcher import (
    InteractionsDispatcher,
)
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

INTERACTION_MAX_RETRIES = 3


class InteractionsWorker:
    """Registers and owns the TaskIQ interactions respond task.

    A human answer to a parked interaction is enqueued by the API and consumed
    here; the dispatcher re-fetches the interaction, re-authorizes its stored
    refs at fire time, and hands the run to the runner (detached, no await).
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
        dispatcher: InteractionsDispatcher,
    ):
        self.broker = broker
        self.dispatcher = dispatcher

        self._register_tasks()

    def _register_tasks(self):
        @self.broker.task(
            task_name="interactions.respond",
            retry_on_error=True,
            max_retries=INTERACTION_MAX_RETRIES,
        )
        async def respond_interaction(
            *,
            project_id: str,
            user_id: str,
            interaction_id: str,
            answer: Any,
            #
            context: Context = TaskiqDepends(),
        ) -> None:
            retry_count_raw = context.message.labels.get("_taskiq_retry_count", 0) or 0
            try:
                retry_count = int(retry_count_raw)
            except (TypeError, ValueError):
                retry_count = 0

            log.info(
                f"[TASK] interactions.respond "
                f"interaction={interaction_id} "
                f"attempt={retry_count}/{INTERACTION_MAX_RETRIES}"
            )

            await self.dispatcher.respond(
                project_id=UUID(project_id),
                user_id=UUID(user_id),
                interaction_id=UUID(interaction_id),
                answer=answer,
            )

        self.respond_interaction = respond_interaction
