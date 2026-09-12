"""Map gateway domain exceptions to HTTP responses."""

from functools import wraps
from typing import Any, Dict, Optional

from fastapi import HTTPException, status

from oss.src.core.gateways.types import GatewayEndpointInactiveError
from oss.src.core.gateways.llms.types import (
    LLMConnectionProviderRequiredError,
    LLMEndpointNotFoundError,
    LLMEndpointProviderMissingError,
    LLMModelNotAllowedError,
    LLMUpstreamError,
)
from oss.src.core.gateways.mcps.types import (
    MCPAuthRequiredError,
    MCPEndpointNotFoundError,
    MCPScopeInsufficientError,
    MCPToolNotAllowedError,
    MCPUpstreamError,
)
from oss.src.core.gateways.mcps.oauth.types import (
    MCPOAuthClientNotRegisteredError,
    MCPOAuthDiscoveryError,
    MCPOAuthRegistrationError,
    MCPOAuthStateInvalidError,
    MCPOAuthTokenExchangeError,
)
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    SecretInvalidError,
    SecretNotFoundError,
    EntitlementDeniedError,
    PolicyDeniedError,
)


def gateway_error_envelope(
    *,
    code: str,
    message: str,
    retryable: bool = False,
    next_step: Optional[str] = None,
    details: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """The one refusal shape a caller reads, whichever side of the gateway refused.

    `{code, message, retryable, next_step, details}` is the envelope the data plane already
    produces (`gateways/llms/proxy.py`) and that `GatewayInsecureEndpointError` carries on the
    SDK side. Control-plane refusals send it as the HTTP `detail` so the agent resolver can
    carry `code` and `message` to the person running the agent instead of collapsing every
    refusal into a status number.

    `details` holds routing facts only (an endpoint target, a flag name). Never a credential:
    this body reaches the browser and the harness transcript.
    """
    envelope: Dict[str, Any] = {
        "code": code,
        "message": message,
        "retryable": retryable,
    }
    if next_step:
        envelope["next_step"] = next_step
    if details:
        envelope["details"] = details
    return envelope


def _target_of(exc) -> str:
    """The `namespace/name` path an endpoint error names, for the envelope's `details`."""
    namespace = getattr(exc, "namespace", None)
    parts = [getattr(namespace, "value", None) or ""]
    parts += [
        getattr(exc, attr, None) or "" for attr in ("provider", "integration", "name")
    ]
    return "/".join(part for part in parts if part)


def handle_gateway_exceptions():
    """Map gateway domain exceptions to HTTP.

    Not-found errors map to 404, policy errors to 403, connection requirements to
    409, and upstream failures to 424 or 502.

    Refusals a caller must act on carry :func:`gateway_error_envelope` as their `detail`;
    the rest keep the bare message they have always sent.
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except (LLMEndpointNotFoundError, MCPEndpointNotFoundError) as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=gateway_error_envelope(
                        code="endpoint_not_found",
                        message=e.message,
                        next_step=(
                            "Register the endpoint, or name one that already exists."
                        ),
                        details={"target": _target_of(e)},
                    ),
                ) from e
            except GatewayEndpointInactiveError as e:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=gateway_error_envelope(
                        code="endpoint_inactive",
                        message=e.message,
                        next_step="Reactivate the endpoint, or choose another.",
                        details={"target": e.target, "flag": e.flag},
                    ),
                ) from e
            except LLMConnectionProviderRequiredError as e:
                # A request missing a required combination of fields is a client error, the
                # same 422 `EndpointResolutionError` and `GatewayInsecureEndpointError` use.
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=gateway_error_envelope(
                        code="gateway_provider_required",
                        message=e.message,
                        next_step=(
                            "Send a provider_key, or name the connection to resolve."
                        ),
                    ),
                ) from e
            except LLMEndpointProviderMissingError as e:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail=gateway_error_envelope(
                        code="gateway_endpoint_provider_missing",
                        message=e.message,
                        next_step=(
                            "Set the endpoint's provider, or resolve it with a provider_key."
                        ),
                        details={"target": _target_of(e)},
                    ),
                ) from e

            except (PolicyDeniedError, EntitlementDeniedError) as e:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=e.message,
                ) from e
            except (LLMModelNotAllowedError, MCPToolNotAllowedError) as e:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=e.message,
                ) from e
            except CeilingExceededError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={
                        "message": e.message,
                        "ceiling": e.ceiling,
                        "requested": e.requested,
                        "allowed": e.allowed,
                    },
                ) from e
            except MCPAuthRequiredError as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={
                        "message": e.message,
                        "requirement": e.requirement.model_dump(mode="json"),
                    },
                ) from e
            except MCPScopeInsufficientError as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail={"message": e.message, "scopes": e.scopes},
                ) from e
            except (SecretNotFoundError, SecretInvalidError) as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=e.message,
                ) from e
            except (LLMUpstreamError, MCPUpstreamError) as e:
                upstream = e.status_code
                raise HTTPException(
                    status_code=(
                        status.HTTP_502_BAD_GATEWAY
                        if upstream is not None and upstream >= 500
                        else status.HTTP_424_FAILED_DEPENDENCY
                    ),
                    detail=e.detail or e.message,
                ) from e
            except (
                MCPOAuthDiscoveryError,
                MCPOAuthRegistrationError,
                MCPOAuthTokenExchangeError,
            ) as e:
                # Preserve the authorization-server failure message.
                raise HTTPException(
                    status_code=status.HTTP_424_FAILED_DEPENDENCY,
                    detail=e.message,
                ) from e
            except MCPOAuthStateInvalidError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=e.message,
                ) from e
            except MCPOAuthClientNotRegisteredError as e:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=e.message,
                ) from e

        return wrapper

    return decorator
