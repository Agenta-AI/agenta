from uuid import UUID

from taskiq import AsyncBroker, Context, TaskiqDepends

from oss.src.tasks.asyncio.channels.inbox import InboxDispatcher
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

# Broker-level retry ceiling for a failed task run (taskiq's retry_on_error),
# distinct from InboxDispatcher's in-process refusal retry.
CHANNEL_INBOX_MAX_RETRIES = 5


class ChannelsInboxWorker:
    """Registers and owns the TaskIQ channels-inbox dispatch task.

    Thin by construction, following `triggers`: the ingress route enqueues
    `channels.inbox.dispatch` with the ids it already resolved; this task hands
    off to `InboxDispatcher.dispatch`, which does the routing/resolution/invoke.
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
        dispatcher: InboxDispatcher,
    ):
        self.broker = broker
        self.dispatcher = dispatcher

        self._register_tasks()

    def _register_tasks(self):
        @self.broker.task(
            task_name="channels.inbox.dispatch",
            retry_on_error=True,
            max_retries=CHANNEL_INBOX_MAX_RETRIES,
        )
        async def dispatch_inbox_event(
            *,
            project_id: str,
            connection_id: str,
            channel: str,
            external_id: str,
            #
            context: Context = TaskiqDepends(),
        ) -> None:
            retry_count_raw = context.message.labels.get("_taskiq_retry_count", 0) or 0
            try:
                retry_count = int(retry_count_raw)
            except (TypeError, ValueError):
                retry_count = 0

            log.info(
                f"[TASK] channels.inbox.dispatch "
                f"channel={channel} external_id={external_id} "
                f"attempt={retry_count}/{CHANNEL_INBOX_MAX_RETRIES}"
            )

            await self.dispatcher.dispatch(
                project_id=UUID(project_id),
                connection_id=UUID(connection_id),
                channel=channel,
                external_id=external_id,
            )

        self.dispatch_inbox_event = dispatch_inbox_event
