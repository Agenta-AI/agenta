"""LLM gateway domain exceptions."""

from typing import Optional

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.types import GatewaysError


class LLMEndpointNotFoundError(GatewaysError):
    def __init__(self, *, namespace: GatewayEndpointNamespace, name: str):
        self.namespace = namespace
        self.name = name
        super().__init__(f"LLM endpoint not found: {namespace.value}/{name}")


class LLMModelNotAllowedError(GatewaysError):
    """The model is outside the endpoint's allowlist."""

    def __init__(self, *, model: str, namespace: GatewayEndpointNamespace, name: str):
        self.model = model
        self.namespace = namespace
        self.name = name
        super().__init__(f"Model {model} not allowed on {namespace.value}/{name}")


class LLMAdapterNotFoundError(GatewaysError):
    """No upstream adapter is registered under this key."""

    def __init__(self, *, key: str):
        self.key = key
        super().__init__(f"No LLM upstream adapter registered under {key!r}")


class LLMUpstreamError(GatewaysError):
    """The upstream failed after policy allowed the request."""

    def __init__(
        self,
        *,
        provider_key: Optional[str],
        status_code: Optional[int] = None,
        detail: Optional[str] = None,
    ):
        self.provider_key = provider_key
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"Upstream {provider_key} failed ({status_code})")
