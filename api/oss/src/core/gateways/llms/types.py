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


class LLMRoutingFieldNotAllowedError(GatewaysError):
    """The body carries a model-routing field the gateway cannot evaluate (OR44).

    The allowlist can only bind the fields it understands. `model` and every entry of
    OpenRouter's `models` fallback array are checked against it; a routing extension whose
    effect the gateway cannot evaluate — OpenRouter's `provider` preferences, its legacy
    `route`, a saved `preset`, a proxy-style `fallbacks` list — is refused rather than
    forwarded unexamined. Refusing rather than ignoring is what stops the next such field a
    provider ships from silently reopening the allowlist.
    """

    def __init__(
        self,
        *,
        field: str,
        namespace: GatewayEndpointNamespace,
        name: str,
        reason: Optional[str] = None,
    ):
        self.field = field
        self.namespace = namespace
        self.name = name
        self.reason = reason
        super().__init__(
            f"Request field {field!r} selects models and is not enforceable on "
            f"{namespace.value}/{name}" + (f": {reason}" if reason else "")
        )


class LLMModelIdentifierInvalidError(GatewaysError):
    """The model identifier is not admissible where a route interpolates it (OR60).

    Azure and Vertex place the caller's model inside the request URL's path. A value such as
    `x/../..` walks out of the deployment's own prefix and reaches arbitrary endpoints under
    the organisation's cloud credentials, so the identifier is admitted only if every one of
    its `/`-separated segments matches the character class real model ids use.
    """

    def __init__(self, *, model: str, provider_key: Optional[str] = None):
        self.model = model
        self.provider_key = provider_key
        super().__init__(
            f"Model identifier {model!r} is not a valid model id for a routed deployment"
        )


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


class LLMConnectionProviderRequiredError(GatewaysError):
    """A resolve request named neither a provider nor a connection, so nothing routes.

    The ``ValueError`` underneath in ``resolve_agent_connection`` stays as the invariant no
    construction path can dodge; this is the typed refusal in front of it at the seam every
    request passes through, so an underspecified request reads as a client error with a code
    instead of a generic 500.
    """

    def __init__(self) -> None:
        super().__init__(
            "A gateway connection needs a provider or a connection name; "
            "the request carried only a model."
        )


class LLMEndpointProviderMissingError(GatewaysError):
    """A stored endpoint reached resolve with no provider to route to.

    A data-integrity violation rather than a bad request: the endpoint exists and the caller
    named it correctly, but nothing on it or in the request says which provider serves it, so
    no gateway route can be built. Typed so the operator learns which endpoint to repair
    instead of reading "an unexpected error occurred".
    """

    def __init__(self, *, namespace: GatewayEndpointNamespace, name: str):
        self.namespace = namespace
        self.name = name
        super().__init__(
            f"LLM endpoint {namespace.value}/{name} has no provider, "
            "so no gateway route can be built for it."
        )
