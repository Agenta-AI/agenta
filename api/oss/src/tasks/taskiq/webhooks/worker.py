from typing import Any, Dict
from uuid import UUID

from taskiq import AsyncBroker, Context, TaskiqDepends

from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO
from oss.src.core.webhooks.tasks import deliver_webhook as deliver_webhook_impl
from oss.src.core.webhooks.config import WEBHOOK_MAX_RETRIES
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)


class WebhooksWorker:
    """Registers and owns the TaskIQ webhook delivery task.

    The deliver_webhook task receives all delivery data inline (no DB reads)
    and writes a single delivery record only on final success or failure.
    Retry count is read from TaskIQ's internal _taskiq_retry_count label.
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
            project_id: str,
            #
            subscription_id: str,
            event_id: str,
            #
            url: str,
            headers: Dict[str, str],
            encrypted_secret: str,
            #
            event_type: str,
            payload: Dict[str, Any],
            #
            context: Context = TaskiqDepends(),
        ) -> None:
            retry_count = context.message.labels.get("_taskiq_retry_count", 0) or 0

            log.info(
                f"[TASK] webhooks.deliver "
                f"subscription={subscription_id} event={event_id} "
                f"attempt={retry_count}/{WEBHOOK_MAX_RETRIES}"
            )

            await deliver_webhook_impl(
                project_id=UUID(project_id),
                subscription_id=UUID(subscription_id),
                event_id=UUID(event_id),
                #
                url=url,
                headers=headers,
                encrypted_secret=encrypted_secret,
                #
                event_type=event_type,
                payload=payload,
                #
                retry_count=retry_count,
                #
                dao=self.webhooks_dao,
            )

        self.deliver_webhook = deliver_webhook
