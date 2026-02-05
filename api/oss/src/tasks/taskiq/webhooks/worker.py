from typing import Any
from uuid import UUID

from taskiq import AsyncBroker

from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO
from oss.src.core.webhooks.tasks import deliver_webhook as deliver_webhook_impl
from oss.src.core.webhooks.config import WEBHOOK_MAX_RETRIES
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class WebhooksWorker:
    """
    Worker class for webhook tasks.

    Registers tasks with Taskiq broker and handles dependency injection.
    """

    def __init__(
        self,
        *,
        broker: AsyncBroker,
        webhooks_dao: WebhooksDAO,
    ):
        self.broker = broker
        self.webhooks_dao = webhooks_dao

        self._register_tasks()

    def _register_tasks(self):
        @self.broker.task(
            task_name="webhooks.deliver",
            retry_on_error=True,
            max_retries=WEBHOOK_MAX_RETRIES,
        )
        async def deliver_webhook(
            delivery_id: UUID,
        ) -> Any:
            log.info(f"[TASK] Starting webhooks.deliver for {delivery_id}")
            result = await deliver_webhook_impl(
                delivery_id=delivery_id,
                dao=self.webhooks_dao,
            )
            log.info(f"[TASK] Completed webhooks.deliver for {delivery_id}")
            return result

        self.deliver_webhook = deliver_webhook
