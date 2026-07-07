"""Composio trigger-webhook signing-secret resolver.

The secret is Composio-generated (one per project, not user-supplied), so
Composio is the source of truth and the value is cached encrypted in Redis.
"""

from typing import Optional

from oss.src.core.triggers.registry import TriggersGatewayRegistry
from oss.src.utils.caching import get_cache, set_cache
from oss.src.utils.crypting import decrypt, encrypt
from oss.src.utils.logging import get_module_logger
from oss.src.utils.env import env

log = get_module_logger(__name__)

_CACHE_NAMESPACE = "composio:triggers"
_CACHE_KEY = "webhook_secret"
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
            secret = await adapter.ensure_webhook_subscription(
                webhook_url=self._webhook_url(),
            )
        except Exception as e:
            log.error("failed to ensure Composio webhook subscription: %s", e)
            return None

        await set_cache(
            namespace=_CACHE_NAMESPACE,
            key=_CACHE_KEY,
            value=encrypt(secret),
            ttl=_CACHE_TTL,
        )

        return secret
