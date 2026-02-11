"""Reusable webhook trigger utility.

Provides a simple async function to trigger webhooks from anywhere in the backend.
Handles DAO and worker dependencies internally using lazy initialization.

Example:
    from oss.src.core.webhooks import trigger_webhook

    await trigger_webhook(
        workspace_id=workspace_id,
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
_dao: Optional[WebhooksDAOInterface] = None
_worker: Optional["WebhooksWorker"] = None
_initialized = False


def initialize_trigger(
    dao: WebhooksDAOInterface,
    worker: Optional["WebhooksWorker"] = None,
) -> None:
    """
    Initialize the trigger utility with DAO and worker instances.

    This should be called once at application startup (in entrypoint/composition root).

    Args:
        dao: WebhooksDAO instance
        worker: WebhooksWorker instance (optional - for testing or if worker not available)
    """
    global _dao, _worker, _initialized
    _dao = dao
    _worker = worker
    _initialized = True
    log.info("Webhook trigger utility initialized")


def _get_dao() -> WebhooksDAOInterface:
    """Get the WebhooksDAO instance."""
    global _dao, _initialized

    if not _initialized or _dao is None:
        # Fallback: Create DAO on-demand (for backwards compatibility)
        log.warning("Webhook trigger not initialized, creating DAO on-demand")
        from oss.src.dbs.postgres.webhooks.dao import WebhooksDAO

        _dao = WebhooksDAO()
        _initialized = True

    return _dao


def _get_worker() -> Optional["WebhooksWorker"]:
    """Get the WebhooksWorker instance."""
    global _worker
    return _worker


async def trigger_webhook(
    workspace_id: UUID,
    event_type: str,
    payload: dict,
) -> None:
    """
    Trigger a webhook event for the given workspace.

    This is the primary API for triggering webhooks from anywhere in the backend.
    It handles all dependencies internally (DAO, worker) and follows the outbox pattern:
    1. Records event in database
    2. Finds active subscriptions for this event type
    3. Creates delivery records
    4. Enqueues delivery tasks to the worker

    Args:
        workspace_id: Workspace triggering the webhook
        event_type: Type of event (e.g., "config.deployed")
        payload: Event data to send in webhook (must be JSON-serializable)

    Example:
        await trigger_webhook(
            workspace_id=UUID("123..."),
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

        # 1. Archive event
        event = await dao.create_event(workspace_id, event_type, payload)
        log.info(f"Created webhook event {event.id} for workspace {workspace_id}")

        # 2. Get active subscriptions
        subscriptions = await dao.get_active_subscriptions_for_event(
            workspace_id, event_type
        )

        if not subscriptions:
            log.debug(
                f"No active subscriptions for event {event_type} in workspace {workspace_id}"
            )
            return

        if not worker:
            log.warning(
                f"WebhooksWorker not available. Skipping delivery for event {event.id}"
            )
            return

        # 3. Create deliveries and enqueue tasks
        for sub in subscriptions:
            try:
                delivery = await dao.create_delivery(
                    subscription_id=sub.id,
                    event_type=event_type,
                    payload=payload,
                    event_id=event.id,
                )

                await worker.deliver_webhook.kiq(delivery_id=delivery.id)
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
