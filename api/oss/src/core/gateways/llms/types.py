"""LLM plane domain exceptions (entities.md §5)."""

from typing import Optional

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.types import GatewaysError


class LlmEndpointNotFoundError(GatewaysError):
    def __init__(self, *, namespace: GatewayEndpointNamespace, name: str):
        self.namespace = namespace
        self.name = name
        super().__init__(f"LLM endpoint not found: {namespace.value}/{name}")


class LlmModelNotAllowedError(GatewaysError):
    """The model is outside the endpoint's allowlist — a custom endpoint's
    declared model_slugs, or a builtin provider's catalogue (§4.3)."""

    def __init__(self, *, model: str, namespace: GatewayEndpointNamespace, name: str):
        self.model = model
        self.namespace = namespace
        self.name = name
        super().__init__(f"Model {model} not allowed on {namespace.value}/{name}")


class LlmUpstreamError(GatewaysError):
    """The upstream failed after policy allowed. Carries the upstream status so
    the proxy can relay a faithful OpenAI-shaped error (§9)."""

    def __init__(
        self,
        *,
        provider_key: str,
        status_code: Optional[int] = None,
        detail: Optional[str] = None,
    ):
        self.provider_key = provider_key
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Upstream {provider_key} failed ({status_code})")
