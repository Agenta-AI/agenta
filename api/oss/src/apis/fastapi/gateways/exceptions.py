"""Map gateway domain exceptions to HTTP responses."""

from functools import wraps

from fastapi import HTTPException, status

from oss.src.core.gateways.types import GatewayEndpointInactiveError
from oss.src.core.gateways.llms.types import (
    LLMEndpointNotFoundError,
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


def handle_gateway_exceptions():
    """Map gateway domain exceptions to HTTP.

    Not-found errors map to 404, policy errors to 403, connection requirements to
    409, and upstream failures to 424 or 502.
    """

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                return await func(*args, **kwargs)
            except (LLMEndpointNotFoundError, MCPEndpointNotFoundError) as e:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=e.message,
                ) from e
            except GatewayEndpointInactiveError as e:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=e.message,
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
