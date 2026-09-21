"""Map gateway domain exceptions to HTTP responses."""

from functools import wraps
from typing import Any, Dict, Optional

from fastapi import HTTPException, status

from oss.src.core.gateways.types import (
    GatewayEndpointInactiveError,
    GatewayPlaneDisabledError,
)
from oss.src.core.gateways.llms.types import (
    LLMConnectionProviderRequiredError,
    LLMEndpointNotFoundError,
    LLMEndpointProviderMissingError,
    LLMModelIdentifierInvalidError,
    LLMModelNotAllowedError,
    LLMRoutingFieldNotAllowedError,
    LLMUpstreamError,
)
from oss.src.core.gateways.mcps.types import (
    MCPAgentaToolNotEntitledError,
    MCPAuthRequiredError,
    MCPConnectionNameTakenError,
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


def plane_disabled_envelope(exc: GatewayPlaneDisabledError) -> Dict[str, Any]:
    """The one rendering of a switched-off plane, shared by every surface that refuses one.

    The control plane sends it as the HTTP `detail`; the two data planes translate the same
    code and message into their own protocol shape. Keeping the strings on the exception and
    the assembly here is what stops the three surfaces from naming the same refusal three
    different ways, which is what a fallback in the SDK would then have to match three ways.
    """
    return gateway_error_envelope(
        code=exc.code,
        message=exc.message,
        next_step=exc.next_step,
        details={"flag": exc.flag},
    )


def plane_disabled_http_exception(exc: GatewayPlaneDisabledError) -> HTTPException:
    """The control plane's refusal of a switched-off plane.

    403, not 404 or 503: the route exists and the deployment is healthy, the operator has
    decided this plane does not serve. Retrying changes nothing, which is what separates it
    from the 502/424 an upstream failure sends.

    Assembled here rather than at each surface because a router dependency refuses before
    `handle_gateway_exceptions` wraps anything, so the two would otherwise build the same
    response independently.
    """
    return HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail=plane_disabled_envelope(exc),
    )


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
            except GatewayPlaneDisabledError as e:
                raise plane_disabled_http_exception(e) from e
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

            except LLMRoutingFieldNotAllowedError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=gateway_error_envelope(
                        code="routing_field_not_allowed",
                        message=e.message,
                        next_step=(
                            "Remove the routing field, and name the model you want in "
                            "`model`."
                        ),
                        details={"target": _target_of(e), "field": e.field},
                    ),
                ) from e
            except LLMModelIdentifierInvalidError as e:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=gateway_error_envelope(
                        code="invalid_model_identifier",
                        message=e.message,
                        next_step=(
                            "Name a model id of letters, digits and `. _ - :`, with `/` "
                            "only between segments."
                        ),
                    ),
                ) from e

            except (PolicyDeniedError, EntitlementDeniedError) as e:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=e.message,
                ) from e
            except MCPConnectionNameTakenError as e:
                # A conflict rather than a validation failure: the request is
                # well-formed and would be accepted in a project where the name is free.
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=gateway_error_envelope(
                        code="mcp_connection_name_taken",
                        message=e.message,
                        next_step="Give this connection a name no other one in the project uses.",
                    ),
                ) from e
            except (LLMModelNotAllowedError, MCPToolNotAllowedError) as e:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=e.message,
                ) from e
            except MCPAgentaToolNotEntitledError as e:
                # Distinct from `MCPToolNotAllowedError`, which refuses a tool at call
                # time against an endpoint's allowlist. This one refuses to MINT a
                # credential naming tools the caller may not narrow to, so the resolver
                # can tell "this run may not carry that tool" from "that call was
                # blocked".
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=gateway_error_envelope(
                        code="agenta_tool_not_entitled",
                        message=e.message,
                        next_step=(
                            "Request only the callback tools this run resolved."
                        ),
                        details={"tools": e.tools},
                    ),
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
