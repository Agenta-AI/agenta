from uuid import UUID

from taskiq import AsyncBroker

from oss.src.tasks.asyncio.channels.outbox import ChannelsOutboxWorker
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class ChannelsOutboxTaskWorker:
    """Registers the TaskIQ poll task; thin by construction (README.md).

    One task, `channels.outbox.poll`, standing in for turn-started/turn-ended
    until WP0 publishes real session events — deleted, not disabled, at that
    point (specs-wp5.md).
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
        outbox: ChannelsOutboxWorker,
    ):
        self.broker = broker
        self.outbox = outbox

        self._register_tasks()

    def _register_tasks(self):
        @self.broker.task(
            task_name="channels.outbox.poll",
            retry_on_error=True,
            max_retries=3,
        )
        async def poll_turn(*, project_id: str, session_id: str) -> None:
            log.info(
                "[TASK] channels.outbox.poll project=%s session=%s",
                project_id,
                session_id,
            )

            await self.outbox.poll_turn(
                project_id=UUID(project_id),
                session_id=session_id,
            )

        self.poll_turn = poll_turn
