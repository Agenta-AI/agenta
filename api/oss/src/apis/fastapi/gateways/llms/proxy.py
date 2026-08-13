"""LLM data-plane proxy (entities.md §9): the OpenAI-compatible surface.

No wire models: the caller's body relays byte for byte (§7.1). This router only parses
just enough to route (`parse_llm_call_context`) and puts the answer back on the wire
exactly as it arrived. Endpoint resolution, the allowlist, ceilings, policy authorization
and secret resolution all live inside `LlmGatewayService.relay_chat_completion`
(WP7) — this file never decides whether a call is allowed, only how to shape the denial
once WP7 says no.

Streaming audit timing is not this file's job either: `LlmGatewayService` wraps the
returned iterator and records in its own `finally` once it is exhausted. This proxy drains
`result.body` through `StreamingResponse` and holds no `GatewayPolicyService` reference —
the constructor below takes only the one service.
"""

from typing import TYPE_CHECKING, Any, Dict, List

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from oss.src.apis.fastapi.gateways.llms.utils import parse_llm_call_context
from oss.src.apis.fastapi.gateways.utils import response_headers
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.types import GatewayEndpointInactiveError
from oss.src.core.gateways.llms.types import (
    LlmAdapterNotFoundError,
    LlmEndpointNotFoundError,
    LlmModelNotAllowedError,
    LlmUpstreamError,
)
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    SecretNotFoundError,
    EntitlementDeniedError,
    PolicyDeniedError,
)
from oss.src.utils.context import get_auth_scope

if TYPE_CHECKING:
    # LlmGatewayService is WP7's (core/gateways/llms/service.py) and does not exist on
    # this branch yet — a TYPE_CHECKING-only import keeps the annotation honest without
    # making this module's import fail before WP7 lands (out of WP6's owned paths).
    from oss.src.core.gateways.llms.service import LlmGatewayService

# The caller's own secret to US — never forwarded to the upstream (§9's pseudocode).
_STRIPPED_INBOUND_HEADERS = {"authorization"}

_DOMAIN_EXCEPTIONS = (
    GatewayEndpointInactiveError,
    LlmAdapterNotFoundError,
    PolicyDeniedError,
    EntitlementDeniedError,
    LlmModelNotAllowedError,
    CeilingExceededError,
    SecretNotFoundError,
    LlmEndpointNotFoundError,
    LlmUpstreamError,
)


def _openai_error(
    *,
    status_code: int,
    message: str,
    error_type: str,
    code: str,
    **extra: Any,
) -> JSONResponse:
    error: Dict[str, Any] = {"message": message, "type": error_type, "code": code}
    error.update(extra)
    return JSONResponse(status_code=status_code, content={"error": error})


def _map_domain_exception(exc: Exception) -> JSONResponse:
    """OpenAI-shaped denial (specs-wp6.md "Error shape"): `{"error": {"message",
    "type", "code"}}`, `code` carrying the stable cause. Mirrors the mapping
    `handle_gateway_exceptions()` (seed, apis/fastapi/gateways/exceptions.py)
    applies for the management CRUD, but that decorator collapses distinct
    causes sharing one HTTP status (e.g. PolicyDeniedError and
    LlmModelNotAllowedError both 403) into a bare `detail` string — this
    surface needs the `code` to stay distinguishable per exception type, so it
    is not reused here (see this package's own report for the full reasoning).
    """
    if isinstance(exc, (PolicyDeniedError, EntitlementDeniedError)):
        return _openai_error(
            status_code=403,
            message=exc.message,
            error_type="permission_error",
            code="policy_denied",
        )
    if isinstance(exc, GatewayEndpointInactiveError):
        return _openai_error(
            status_code=403,
            message=exc.message,
            error_type="invalid_request_error",
            code="endpoint_inactive",
        )
    if isinstance(exc, LlmModelNotAllowedError):
        return _openai_error(
            status_code=403,
            message=exc.message,
            error_type="invalid_request_error",
            code="model_not_allowed",
        )
    if isinstance(exc, CeilingExceededError):
        return _openai_error(
            status_code=400,
            message=exc.message,
            error_type="invalid_request_error",
            code="ceiling_exceeded",
            ceiling=exc.ceiling,
            requested=exc.requested,
            allowed=exc.allowed,
        )
    if isinstance(exc, SecretNotFoundError):
        return _openai_error(
            status_code=409,
            message=exc.message,
            error_type="invalid_request_error",
            code="secret_missing",
        )
    if isinstance(exc, LlmAdapterNotFoundError):
        return _openai_error(
            status_code=502,
            message=exc.message,
            error_type="api_error",
            code="adapter_not_found",
        )
    if isinstance(exc, LlmEndpointNotFoundError):
        return _openai_error(
            status_code=404,
            message=exc.message,
            error_type="invalid_request_error",
            code="endpoint_not_found",
        )
    # LlmUpstreamError: the upstream's own detail passes through untouched (D16) —
    # never replaced with a generic message.
    status_code = 502 if exc.status_code is not None and exc.status_code >= 500 else 424
    return _openai_error(
        status_code=status_code,
        message=exc.detail or exc.message,
        error_type="api_error",
        code="upstream_error",
    )


class LlmGatewayProxy:
    def __init__(self, *, llm_gateway_service: "LlmGatewayService") -> None:
        self.service = llm_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/standard/{provider}/v1/chat/completions",
            self.chat_completions_standard,
            methods=["POST"],
            operation_id="llm_gateway_chat_completions_standard",
        )
        self.router.add_api_route(
            "/custom/{slug}/v1/chat/completions",
            self.chat_completions_custom,
            methods=["POST"],
            operation_id="llm_gateway_chat_completions_custom",
        )
        self.router.add_api_route(
            "/standard/{provider}/v1/models",
            self.list_models_standard,
            methods=["GET"],
            operation_id="llm_gateway_list_models_standard",
        )
        self.router.add_api_route(
            "/custom/{slug}/v1/models",
            self.list_models_custom,
            methods=["GET"],
            operation_id="llm_gateway_list_models_custom",
        )

    # --- chat completions ---------------------------------------------------- #

    async def chat_completions_standard(
        self, request: Request, provider: str
    ) -> Response:
        return await self._chat_completions(
            request, namespace=GatewayEndpointNamespace.STANDARD, name=provider
        )

    async def chat_completions_custom(self, request: Request, slug: str) -> Response:
        return await self._chat_completions(
            request, namespace=GatewayEndpointNamespace.CUSTOM, name=slug
        )

    async def _chat_completions(
        self,
        request: Request,
        *,
        namespace: GatewayEndpointNamespace,
        name: str,
    ) -> Response:
        scope = get_auth_scope()
        raw_body = await request.body()

        try:
            context = parse_llm_call_context(body=raw_body)
        except ValueError as exc:
            return _openai_error(
                status_code=400,
                message=str(exc),
                error_type="invalid_request_error",
                code="invalid_request",
            )

        caller_headers = {
            k: v
            for k, v in request.headers.items()
            if k.lower() not in _STRIPPED_INBOUND_HEADERS
        }

        try:
            result = await self.service.relay_chat_completion(
                scope=scope,
                namespace=namespace,
                name=name,
                body=raw_body,
                headers=caller_headers,
            )

            if context.stream:
                return StreamingResponse(
                    result.body,
                    status_code=result.status_code,
                    headers=response_headers(result.headers),
                    media_type="text/event-stream",
                )

            chunk = await anext(result.body)
        except _DOMAIN_EXCEPTIONS as exc:
            return _map_domain_exception(exc)

        return Response(
            content=chunk,
            status_code=result.status_code,
            headers=response_headers(result.headers),
        )

    # --- models ---------------------------------------------------------------- #

    async def list_models_standard(self, provider: str) -> Any:
        return await self._list_models(
            namespace=GatewayEndpointNamespace.STANDARD, name=provider
        )

    async def list_models_custom(self, slug: str) -> Any:
        return await self._list_models(
            namespace=GatewayEndpointNamespace.CUSTOM, name=slug
        )

    async def _list_models(
        self, *, namespace: GatewayEndpointNamespace, name: str
    ) -> Any:
        # Any, not Dict[str, Any]: the success path returns the OpenAI list body,
        # the denial path returns a JSONResponse — FastAPI passes a Response
        # instance through unprocessed either way.
        scope = get_auth_scope()

        try:
            slugs: List[str] = await self.service.list_models(
                scope=scope, namespace=namespace, name=name
            )
        except _DOMAIN_EXCEPTIONS as exc:
            return _map_domain_exception(exc)

        return {"object": "list", "data": [{"id": s, "object": "model"} for s in slugs]}
