"""Protocol-shaped LLM gateway proxy responses."""

from typing import TYPE_CHECKING, Any, Callable, Dict, List

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from oss.src.apis.fastapi.gateways.llms.utils import (
    parse_llm_call_context,
    parse_messages_call_context,
    parse_responses_call_context,
)
from oss.src.apis.fastapi.gateways.utils import response_headers, with_code_marker
from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMProtocol
from oss.src.core.gateways.types import GatewayEndpointInactiveError
from oss.src.core.gateways.llms.types import (
    LLMAdapterNotFoundError,
    LLMEndpointNotFoundError,
    LLMModelNotAllowedError,
    LLMUpstreamError,
)
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    SecretInvalidError,
    SecretNotFoundError,
    EntitlementDeniedError,
    PolicyDeniedError,
)
from oss.src.utils.context import get_auth_scope

if TYPE_CHECKING:
    from oss.src.core.gateways.llms.service import LLMGatewayService

# Remove only the platform credential from relayed headers.
_STRIPPED_INBOUND_HEADERS = {"x-ag-credentials"}

_DOMAIN_EXCEPTIONS = (
    GatewayEndpointInactiveError,
    LLMAdapterNotFoundError,
    PolicyDeniedError,
    EntitlementDeniedError,
    LLMModelNotAllowedError,
    CeilingExceededError,
    SecretNotFoundError,
    SecretInvalidError,
    LLMEndpointNotFoundError,
    LLMUpstreamError,
)


def _openai_error(
    *,
    status_code: int,
    message: str,
    error_type: str,
    code: str,
    marked: bool = True,
    **extra: Any,
) -> JSONResponse:
    rendered = with_code_marker(message, code) if marked else message
    error: Dict[str, Any] = {"message": rendered, "type": error_type, "code": code}
    error.update(extra)
    return JSONResponse(status_code=status_code, content={"error": error})


def _map_domain_exception(exc: Exception) -> JSONResponse:
    """Map gateway failures to OpenAI-compatible error responses."""
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
    if isinstance(exc, LLMModelNotAllowedError):
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
    if isinstance(exc, SecretInvalidError):
        return _openai_error(
            status_code=409,
            message=exc.message,
            error_type="invalid_request_error",
            code="secret_invalid",
        )
    if isinstance(exc, LLMAdapterNotFoundError):
        return _openai_error(
            status_code=502,
            message=exc.message,
            error_type="api_error",
            code="adapter_not_found",
        )
    if isinstance(exc, LLMEndpointNotFoundError):
        return _openai_error(
            status_code=404,
            message=exc.message,
            error_type="invalid_request_error",
            code="endpoint_not_found",
        )
    # This is a transport/adapter failure, not an upstream protocol response (those
    # are relayed as LLMRelayResult without reaching this mapper). Do not expose
    # adapter or provider exception text to the caller.
    status_code = 502 if exc.status_code is not None and exc.status_code >= 500 else 424
    return _openai_error(
        status_code=status_code,
        message="upstream request failed",
        error_type="api_error",
        code="upstream_error",
        marked=False,
    )


class LLMGatewayProxy:
    def __init__(self, *, llm_gateway_service: "LLMGatewayService") -> None:
        self.service = llm_gateway_service
        self.router = APIRouter()

        self.router.add_api_route(
            "/builtin/{provider}/v1/chat/completions",
            self.chat_completions_builtin,
            methods=["POST"],
            operation_id="llm_gateway_chat_completions_builtin",
        )
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
            "/builtin/{provider}/v1/responses",
            self.responses_builtin,
            methods=["POST"],
            operation_id="llm_gateway_responses_builtin",
        )
        self.router.add_api_route(
            "/standard/{provider}/v1/responses",
            self.responses_standard,
            methods=["POST"],
            operation_id="llm_gateway_responses_standard",
        )
        self.router.add_api_route(
            "/custom/{slug}/v1/responses",
            self.responses_custom,
            methods=["POST"],
            operation_id="llm_gateway_responses_custom",
        )
        self.router.add_api_route(
            "/builtin/{provider}/v1/messages",
            self.messages_builtin,
            methods=["POST"],
            operation_id="llm_gateway_messages_builtin",
        )
        self.router.add_api_route(
            "/standard/{provider}/v1/messages",
            self.messages_standard,
            methods=["POST"],
            operation_id="llm_gateway_messages_standard",
        )
        self.router.add_api_route(
            "/custom/{slug}/v1/messages",
            self.messages_custom,
            methods=["POST"],
            operation_id="llm_gateway_messages_custom",
        )
        self.router.add_api_route(
            "/builtin/{provider}/v1/models",
            self.list_models_builtin,
            methods=["GET"],
            operation_id="llm_gateway_list_models_builtin",
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

    async def chat_completions_builtin(
        self, request: Request, provider: str
    ) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.BUILTIN,
            name=provider,
            parser=parse_llm_call_context,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
        )

    async def chat_completions_standard(
        self, request: Request, provider: str
    ) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.STANDARD,
            name=provider,
            parser=parse_llm_call_context,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
        )

    async def chat_completions_custom(self, request: Request, slug: str) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.CUSTOM,
            name=slug,
            parser=parse_llm_call_context,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
        )

    # --- responses -------------------------------------------------------------- #

    async def responses_builtin(self, request: Request, provider: str) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.BUILTIN,
            name=provider,
            parser=parse_responses_call_context,
            protocol=LLMProtocol.RESPONSES,
        )

    async def responses_standard(self, request: Request, provider: str) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.STANDARD,
            name=provider,
            parser=parse_responses_call_context,
            protocol=LLMProtocol.RESPONSES,
        )

    async def responses_custom(self, request: Request, slug: str) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.CUSTOM,
            name=slug,
            parser=parse_responses_call_context,
            protocol=LLMProtocol.RESPONSES,
        )

    # --- messages --------------------------------------------------------------- #

    async def messages_builtin(self, request: Request, provider: str) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.BUILTIN,
            name=provider,
            parser=parse_messages_call_context,
            protocol=LLMProtocol.MESSAGES,
        )

    async def messages_standard(self, request: Request, provider: str) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.STANDARD,
            name=provider,
            parser=parse_messages_call_context,
            protocol=LLMProtocol.MESSAGES,
        )

    async def messages_custom(self, request: Request, slug: str) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.CUSTOM,
            name=slug,
            parser=parse_messages_call_context,
            protocol=LLMProtocol.MESSAGES,
        )

    # Shared relay

    async def _relay(
        self,
        request: Request,
        *,
        namespace: GatewayEndpointNamespace,
        name: str,
        parser: Callable[..., LLMCallContext],
        protocol: LLMProtocol,
    ) -> Response:
        scope = get_auth_scope()
        raw_body = await request.body()

        try:
            context = parser(body=raw_body)
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
                protocol=protocol,
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

    async def list_models_builtin(self, provider: str) -> Any:
        return await self._list_models(
            namespace=GatewayEndpointNamespace.BUILTIN, name=provider
        )

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
