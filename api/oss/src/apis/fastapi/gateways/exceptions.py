"""Gateway exception -> HTTP mapping (entities.md §9).

Written once, shared by both planes' routers and both data-plane proxies — tools and
triggers each duplicate `handle_adapter_exceptions()` per router, a habit not repeated
here. Modelled on `apis/fastapi/tools/router.py::handle_adapter_exceptions()`.

Unlike the rest of the seed this file is COMPLETE, not declared: it maps exceptions the
seed itself defines and depends on no work package, so leaving it unimplemented would
leave it unowned (R1).
"""

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

    `*NotFoundError` -> 404. `PolicyDeniedError` / `EntitlementDeniedError` -> 403.
    `*NotAllowedError` -> 403. `CeilingExceededError` -> 400, its body naming the
    ceiling, the requested and the allowed values (D25). `MCPAuthRequiredError` ->
    409 carrying the `GatewayConnectionRequirement` (an interaction, not a failure
    — D17). `*UpstreamError` -> 424, or 502 when the upstream answered >=500 (the
    424/502 split tools and triggers already use).

    The three secret/step-up arms are not in §9's list but follow from §5: a
    missing or dead secret "says you could, once someone connects", which is the
    same interaction 409 as a required authorization (D17, D18). Confirm before
    checkpoint A — see R11 in `open-designs.md`.
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
                # The upstream authorization server, not our own dependency —
                # the message carries the cause verbatim (OD21: never generic).
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
