"""Trigger helpers: the Composio webhook signing-secret resolver, and the
composition of an event into a subscription's agent inputs.

The secret is Composio-generated (one per project, not user-supplied), so
Composio is the source of truth and the value is cached encrypted in Redis.
"""

import json
from typing import Any, Dict, Optional
from urllib.parse import urlsplit, urlunsplit

from oss.src.core.triggers.registry import TriggersGatewayRegistry
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.crypting import decrypt, encrypt
from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

log = get_module_logger(__name__)

_CACHE_NAMESPACE = "composio:triggers"
_CACHE_KEY = "webhook_secret"
_CACHE_URL_KEY = "webhook_url"
_CACHE_TTL = 3600  # 1h — re-derived from Composio on expiry; flush is harmless
_INGRESS_PATH = "/triggers/composio/events/"
# Composio requires public HTTPS; in dev the tunnel delivers over WebSocket so
# the URL is only a placeholder for the secret. RFC 2606 reserved host — resolves
# (passes Composio's SSRF check) but is never actually delivered to.
_DUMMY_HTTPS_URL = "https://example.com/"


class WebhookSecretResolver:
    """Resolve the Composio webhook signing secret: cache → Composio → cache."""

    def __init__(
        self,
        *,
        adapter_registry: TriggersGatewayRegistry,
        provider_key: str = "composio",
    ):
        self._registry = adapter_registry
        self._provider_key = provider_key
        self._registered_url: Optional[str] = None

    def _webhook_url(self) -> str:
        if env.composio.webhook_url:
            return env.composio.webhook_url
        url = f"{env.agenta.api_url.rstrip('/')}{_INGRESS_PATH}"
        return url if url.startswith("https://") else _DUMMY_HTTPS_URL

    async def resolve(self, *, force_refresh: bool = False) -> Optional[str]:
        """Return the signing secret, or None if it cannot be resolved."""
        if not force_refresh:
            cached = await get_cache(namespace=_CACHE_NAMESPACE, key=_CACHE_KEY)
            if cached:
                return decrypt(cached)

        try:
            adapter = self._registry.get(self._provider_key)
            registration = await adapter.ensure_webhook_subscription(
                webhook_url=self._webhook_url(),
            )
        except Exception as e:
            log.error("failed to ensure Composio webhook subscription: %s", e)
            return None

        await set_cache(
            namespace=_CACHE_NAMESPACE,
            key=_CACHE_KEY,
            value=encrypt(registration.secret),
            ttl=_CACHE_TTL,
        )
        # Written even when unknown, so a refresh never leaves an older URL behind.
        self._registered_url = registration.webhook_url or ""
        await set_cache(
            namespace=_CACHE_NAMESPACE,
            key=_CACHE_URL_KEY,
            value=self._registered_url,
            ttl=_CACHE_TTL,
        )

        return registration.secret

    async def report_webhook_url(self) -> None:
        """Log the registered webhook URL; warn when it is not this deployment's.

        The webhook is never updated here: the Composio project may serve another
        deployment, so only an operator can decide which one it belongs to.
        """
        registered = self._registered_url
        if registered is None:
            registered = await get_cache(
                namespace=_CACHE_NAMESPACE,
                key=_CACHE_URL_KEY,
                retry=False,
            )
        if not registered:
            return

        log.info(
            "Composio trigger webhook is registered at %s", _loggable_url(registered)
        )

        expected = self._webhook_url()
        # The dev tunnel delivers over WebSocket, so the registered URL is unused.
        if expected == _DUMMY_HTTPS_URL:
            return
        if registered.rstrip("/") != expected.rstrip("/"):
            log.warning(
                "Composio trigger webhook is registered at %s, but this deployment "
                "expects %s. Composio sends this deployment's events to the other "
                "address. Change the webhook of the Composio project, or use a "
                "separate Composio project for this deployment.",
                _loggable_url(registered),
                _loggable_url(expected),
            )


def _loggable_url(url: str) -> str:
    """Drop user info, query and fragment, where a URL can carry a credential."""
    parts = urlsplit(url)
    host = parts.netloc.rpartition("@")[2]
    return urlunsplit((parts.scheme, host, parts.path, "", ""))


def format_event_text(event_type: Optional[str], attributes: Any) -> str:
    """The event as agent-facing text. Starts with a blank line because the runner
    joins text blocks with no separator. The web preview mirrors this format."""
    header = f"Event data ({event_type}):" if event_type else "Event data:"
    body = json.dumps(attributes, indent=2, ensure_ascii=False, default=str)
    return f"\n\n{header}\n```json\n{body}\n```"


def _as_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, default=str)


def _coerce_message(message: Any) -> Any:
    # A pill on a number, object or absent field resolves to a non-string, which the
    # agent handler rejects (or sends as an empty part).
    if not isinstance(message, dict) or "content" not in message:
        return message
    content = message["content"]
    if isinstance(content, list):
        content = [
            {**part, "text": _as_text(part.get("text"))}
            if isinstance(part, dict) and part.get("type") == "text"
            else part
            for part in content
        ]
    else:
        content = _as_text(content)
    return {**message, "content": content}


def compose_event_inputs(
    inputs: Dict[str, Any],
    *,
    context: Dict[str, Any],
    include_event: bool,
) -> Dict[str, Any]:
    """A subscription's resolved inputs with message text coerced to strings and,
    when ``include_event`` is on, the event text added to the last user message.
    Inputs without a ``messages`` list (other than ``{}``) are returned unchanged."""
    messages = inputs.get("messages")
    if isinstance(messages, list):
        messages = [_coerce_message(message) for message in messages]
        inputs = {**inputs, "messages": messages}

    event = context.get("event") or {}
    attributes = event.get("attributes")
    if not include_event or attributes is None:
        return inputs

    text = format_event_text(event.get("event_type"), attributes)
    if not inputs:
        return {"messages": [{"role": "user", "content": text.lstrip("\n")}]}
    if not isinstance(messages, list):
        return inputs

    last = messages[-1] if messages else None
    if not isinstance(last, dict) or last.get("role") != "user":
        return {
            **inputs,
            "messages": [*messages, {"role": "user", "content": text.lstrip("\n")}],
        }
    content = last.get("content")
    if isinstance(content, list):
        content = [*content, {"type": "text", "text": text}]
    else:
        content = (content or "") + text
    return {**inputs, "messages": [*messages[:-1], {**last, "content": content}]}
