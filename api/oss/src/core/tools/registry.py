from typing import Dict, ItemsView, Optional

from oss.src.core.tools.interfaces import ToolsGatewayInterface
from oss.src.core.tools.exceptions import (
    ProviderNotConfiguredError,
    ProviderNotFoundError,
)


class ToolsGatewayRegistry:
    """Dispatches to the correct adapter based on provider_key."""

    def __init__(
        self,
        *,
        adapters: Dict[str, ToolsGatewayInterface],
        unconfigured: Optional[Dict[str, str]] = None,
    ):
        self._adapters = adapters
        # provider_key -> required env var, for providers this deployment
        # recognizes but whose adapter wasn't built (e.g. composio without
        # COMPOSIO_API_KEY). Lets get() raise ProviderNotConfiguredError
        # instead of ProviderNotFoundError for those keys.
        self._unconfigured = unconfigured or {}

    def get(self, provider_key: str) -> ToolsGatewayInterface:
        adapter = self._adapters.get(provider_key)
        if adapter:
            return adapter
        if provider_key in self._unconfigured:
            raise ProviderNotConfiguredError(
                provider_key, env_var=self._unconfigured[provider_key]
            )
        raise ProviderNotFoundError(provider_key)

    def keys(self) -> list[str]:
        return list(self._adapters.keys())

    def items(self) -> ItemsView[str, ToolsGatewayInterface]:
        return self._adapters.items()
