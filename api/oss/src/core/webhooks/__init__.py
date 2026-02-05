"""Webhook functionality - trigger webhooks from anywhere."""

from typing import TYPE_CHECKING

# Lazy imports to avoid circular dependency with db_models
if TYPE_CHECKING:
    from oss.src.core.webhooks.trigger import trigger_webhook
    from oss.src.core.webhooks.events import WebhookEventType

__all__ = ["trigger_webhook", "WebhookEventType"]


def __getattr__(name: str):
    """Lazy import to avoid circular dependencies."""
    if name == "trigger_webhook":
        from oss.src.core.webhooks.trigger import trigger_webhook

        return trigger_webhook
    elif name == "WebhookEventType":
        from oss.src.core.webhooks.events import WebhookEventType

        return WebhookEventType
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
