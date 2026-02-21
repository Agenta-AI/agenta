"""Reusable webhook trigger utility.

Provides a simple async function to trigger webhooks from anywhere in the backend.
Handles DAO and worker dependencies internally using lazy initialization.

Example:
    from oss.src.core.webhooks import trigger_webhook

    await trigger_webhook(
        project_id=project_id,
        event_type="config.deployed",
        payload={"config_id": "cfg_123", "version": 1},
    )
"""

from typing import Optional
from uuid import UUID

from oss.src.utils.logging import get_module_logger
from oss.src.core.webhooks.interfaces import WebhooksDAOInterface

# Type checking imports to avoid circular dependencies
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from oss.src.tasks.taskiq.webhooks.worker import WebhooksWorker

log = get_module_logger(__name__)

# Global instances (lazy initialization)
# Global instances (lazy initialization)
_dao: Optional[WebhooksDAOInterface] = None
_worker: Optional["WebhooksWorker"] = None


def _get_dao() -> WebhooksDAOInterface:
    """Get the WebhooksDAO instance."""
    global _dao

    if _dao is None:
        from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO

        _dao = WebhooksDAO()

    return _dao


def _get_worker() -> Optional["WebhooksWorker"]:
    """Get the WebhooksWorker instance."""
    global _worker

    if _worker is None:
        try:
            # Lazy import to avoid circular dependency
            from entrypoints.worker_webhooks import webhooks_worker

            _worker = webhooks_worker
        except ImportError:
            log.warning("Could not import webhooks_worker from entrypoints")
            return None

    return _worker


async def trigger_webhook(
    project_id: UUID,
    event_type: str,
    payload: dict,
) -> None:
    """
    Trigger a webhook event for the given workspace.

    This is the primary API for triggering webhooks from anywhere in the backend.
    It handles all dependencies internally (DAO, worker):
    1. Finds active subscriptions for this event type
    2. Creates delivery records
    3. Enqueues delivery tasks to the worker

    Args:
        project_id: Project triggering the webhook
        event_type: Type of event (e.g., "config.deployed")
        payload: Event data to send in webhook (must be JSON-serializable)

    Example:
        await trigger_webhook(
            project_id=UUID("123..."),
            event_type="config.deployed",
            payload={
                "variant_id": "var_456",
                "environment_name": "production",
                "deployed_by": "user_789",
                "timestamp": "2024-01-01T12:00:00Z",
                "version": 1,
            }
        )

    Raises:
        Exception: If DAO operations fail (logged but not raised to avoid breaking callers)
    """
    try:
        dao = _get_dao()
        worker = _get_worker()

        # 1. Get active subscriptions
        subscriptions = await dao.get_active_subscriptions_for_event(
            project_id, event_type
        )

        if not subscriptions:
            log.debug(
                f"No active subscriptions for event {event_type} in project {project_id}"
            )
            return

        if not worker:
            log.warning(
                f"WebhooksWorker not available. Skipping delivery for event {event_type}"
            )
            return

        import uuid_utils.compat as uuid

        # 2. Create deliveries and enqueue tasks
        for sub in subscriptions:
            try:
                # Generate tracking ID for this delivery group
                delivery_id = uuid.uuid7()

                # Create initial pending record
                delivery = await dao.create_delivery(
                    delivery_id=delivery_id,
                    subscription_id=sub.id,
                    event_type=event_type,
                    payload=payload,
                    url=sub.url,
                )

                await worker.deliver_webhook.kiq(delivery_id=delivery_id)
                log.info(
                    f"Enqueued webhook delivery {delivery.id} for subscription {sub.id}"
                )
            except Exception as e:
                log.error(
                    f"Failed to enqueue webhook delivery for subscription {sub.id}: {e}"
                )

    except Exception as e:
        # Don't raise - webhook failures shouldn't break the main flow
        log.error(f"Failed to trigger webhook event: {e}", exc_info=True)
