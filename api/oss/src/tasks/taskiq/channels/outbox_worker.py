from taskiq import AsyncBroker

from oss.src.tasks.asyncio.channels.outbox import ChannelsOutboxWorker
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class ChannelsOutboxTaskWorker:
    """Registers no task: the poll it used to wrap is gone now that the
    session-turn stream drives the outbox directly by event kind. Kept
    importable so an existing `queues:channels-outbox` broker construction
    still resolves; that broker itself has no producer left.
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
        outbox: ChannelsOutboxWorker,
    ):
        self.broker = broker
        self.outbox = outbox
