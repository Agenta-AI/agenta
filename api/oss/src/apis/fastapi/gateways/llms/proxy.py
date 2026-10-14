"""Protocol-shaped LLM gateway proxy responses."""

import json
from typing import TYPE_CHECKING, Any, AsyncIterator, Callable, Dict, List, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from oss.src.utils.logging import get_module_logger
from oss.src.apis.fastapi.gateways.exceptions import log_plane_disabled
from oss.src.apis.fastapi.gateways.llms.utils import (
    LLMRequestBodyError,
    parse_llm_call_context,
    parse_messages_call_context,
    parse_responses_call_context,
)
from oss.src.apis.fastapi.gateways.flags import llm_gateway_serves_caller
from oss.src.apis.fastapi.gateways.utils import response_headers
from oss.src.core.gateways.dtos import (
    GatewayEndpointNamespace,
    forwardable_request_headers,
    with_code_marker,
)
from oss.src.core.gateways.cleanup import run_shielded
from oss.src.core.gateways.egress import classify_transport_error
from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMProtocol
from oss.src.core.gateways.llms.errors import UPSTREAM_ERROR, connection_lost_message
from oss.src.core.gateways.types import (
    GatewayEndpointInactiveError,
    GatewayPlaneDisabledError,
    LLMGatewayDisabledError,
)
from oss.src.core.gateways.llms.types import (
    LLMAdapterNotFoundError,
    LLMEndpointNotFoundError,
    LLMModelIdentifierInvalidError,
    LLMModelNotAllowedError,
    LLMRoutingFieldNotAllowedError,
    LLMCapabilityNotAllowedError,
    LLMUpstreamError,
    LLMUpstreamTimeoutError,
)
from oss.src.core.gateways.policy.types import (
    CeilingExceededError,
    SecretInvalidError,
    SecretNotFoundError,
    EntitlementDeniedError,
    PolicyDeniedError,
    SpendRefusedError,
)
from oss.src.core.gateways.run_claims import gateway_run_id, gateway_run_labels
from oss.src.utils.context import get_auth_scope

if TYPE_CHECKING:
    from oss.src.core.gateways.llms.service import LLMGatewayService

# Headers are admitted at the edge, not filtered at the wire. The adapters apply the same
# allowlist before they connect, so this is defence in depth rather than the control: it
# keeps the caller's cookie and Authorization from travelling through the service, the
# policy plane and anything that records there.
_forward_inbound_headers = forwardable_request_headers

_DOMAIN_EXCEPTIONS = (
    GatewayPlaneDisabledError,
    GatewayEndpointInactiveError,
    LLMAdapterNotFoundError,
    PolicyDeniedError,
    EntitlementDeniedError,
    LLMModelNotAllowedError,
    LLMRoutingFieldNotAllowedError,
    LLMCapabilityNotAllowedError,
    LLMModelIdentifierInvalidError,
    CeilingExceededError,
    SecretNotFoundError,
    SecretInvalidError,
    LLMEndpointNotFoundError,
    LLMUpstreamError,
)


log = get_module_logger(__name__)


def _openai_error(
    *,
    status_code: int,
    message: str,
    error_type: str,
    code: str,
    marked: bool = True,
    headers: Optional[Dict[str, str]] = None,
    **extra: Any,
) -> JSONResponse:
    rendered = with_code_marker(message, code) if marked else message
    error: Dict[str, Any] = {"message": rendered, "type": error_type, "code": code}
    error.update(extra)
    return JSONResponse(
        status_code=status_code, content={"error": error}, headers=headers
    )


# A missing or unusable secret is not transient. Its 409 is a status the Anthropic and OpenAI
# SDKs retry by default, so Claude Code retried one for four minutes and the person saw only
# "no first response"; both SDKs read this header before the status.
_NOT_RETRYABLE = {"x-should-retry": "false"}


def _request_body_detail(exc: ValueError) -> str:
    """What to tell a caller about a body the gateway could not route.

    Never `str(exc)`. The parser's own complaints are authored here and are useful to
    return, but the arm that catches them catches every `ValueError`, and a decoder's
    message quotes the bytes or the offset it choked on while any other `ValueError`
    reaching this point is not describing the request at all. So an exception this
    module did not author is logged and answered with a fixed sentence, the same way a
    transport failure is classified rather than quoted (OR86).
    """
    if isinstance(exc, LLMRequestBodyError):
        return exc.detail

    log.warning(
        "[gateways] a request body was refused by something that does not describe it",
        error_class=type(exc).__name__,
    )
    return "request body could not be read"


def _map_domain_exception(exc: Exception) -> JSONResponse:
    """Map gateway failures to OpenAI-compatible error responses."""
    if isinstance(exc, GatewayPlaneDisabledError):
        log_plane_disabled(exc)
        return _openai_error(
            status_code=403,
            message=exc.message,
            error_type="invalid_request_error",
            code=exc.code,
        )
    if isinstance(exc, SpendRefusedError):
        # Its own code, so the runner and the chat can name the refusal (out of credit,
        # built-in models not enabled) instead of showing a generic denial.
        return _openai_error(
            status_code=403,
            message=exc.message,
            error_type="permission_error",
            code=exc.code,
        )
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
    if isinstance(exc, LLMRoutingFieldNotAllowedError):
        # Its own code beside `model_not_allowed`: nothing is wrong with the model the
        # caller named, so a client that retried the same model would keep failing. What it
        # must do is drop the routing field.
        return _openai_error(
            status_code=400,
            message=exc.message,
            error_type="invalid_request_error",
            code="routing_field_not_allowed",
            field=exc.field,
        )
    if isinstance(exc, LLMCapabilityNotAllowedError):
        return _openai_error(
            status_code=400,
            message=exc.message,
            error_type="invalid_request_error",
            code="capability_not_allowed",
            field=exc.field,
        )
    if isinstance(exc, LLMModelIdentifierInvalidError):
        return _openai_error(
            status_code=400,
            message=exc.message,
            error_type="invalid_request_error",
            code="invalid_model_identifier",
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
            headers=_NOT_RETRYABLE,
        )
    if isinstance(exc, SecretInvalidError):
        return _openai_error(
            status_code=409,
            message=exc.message,
            error_type="invalid_request_error",
            code="secret_invalid",
            headers=_NOT_RETRYABLE,
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
    if isinstance(exc, LLMUpstreamTimeoutError):
        # A 5xx, so the harness reads it as transient and tells the person to try again.
        return _openai_error(
            status_code=504,
            message="The model provider did not answer in time.",
            error_type="api_error",
            code="upstream_timeout",
            marked=False,
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


def _stream_error_frame(protocol: LLMProtocol, exc: Exception) -> bytes:
    """The terminal SSE event that tells a streaming caller its answer is cut short.

    A safety net for what the relay's own error handling (`relay_upstream_errors`) does not
    turn into an event: a credential echo, a timeout, a route that bypasses the relay. The
    shape and the marked sentence are the relay's, so the caller's SDK raises it and the
    runner reads it like any other upstream error. It opens with a blank line: a route that
    bypasses the relay may have stopped mid-line, and the event must not join that line.
    """
    if isinstance(exc, LLMUpstreamTimeoutError):
        code = "upstream_timeout"
        message = with_code_marker(
            "The model provider did not answer in time.", UPSTREAM_ERROR
        )
    else:
        code = UPSTREAM_ERROR
        message = connection_lost_message()

    if protocol == LLMProtocol.MESSAGES:
        event = b"error"
        data = {"type": "error", "error": {"type": "api_error", "message": message}}
    elif protocol == LLMProtocol.RESPONSES:
        event = b"error"
        data = {"type": "error", "code": code, "message": message, "param": None}
    else:
        event = None
        data = {"error": {"message": message, "type": "api_error", "code": code}}

    frame = b"\n\n"
    if event is not None:
        frame += b"event: " + event + b"\n"
    # Unescaped, as the relay writes it, so a harness that keeps the raw text reads the marker.
    return frame + b"data: " + json.dumps(data, ensure_ascii=False).encode() + b"\n\n"


async def _stream_with_terminal_error(
    body: AsyncIterator[bytes], *, protocol: LLMProtocol
) -> AsyncIterator[bytes]:
    """Relay `body`, and end the stream cleanly if it fails after the headers were sent.

    The status line is already on the wire, so an error can no longer become a response
    of its own. Raised out of the `StreamingResponse`, it left the HTTP response
    unterminated and uvicorn closed the connection, which a keep-alive proxy in front
    (Traefik) could reuse for the next request and answer with a 502. A client disconnect
    arrives here as a cancellation, which `except Exception` does not catch.
    """
    try:
        async for chunk in body:
            yield chunk
    except Exception as exc:  # pylint: disable=broad-except
        if isinstance(exc, LLMUpstreamError):
            # The class and the status only: a detail can quote the upstream's bytes.
            log.warning(
                "[gateways] upstream stream failed after the response started",
                error_class=type(exc).__name__,
                provider_key=exc.provider_key,
                status_code=exc.status_code,
            )
        elif isinstance(exc, httpx.RequestError):
            # Logs the class and a safe cause; the text may quote what was sent (OR86).
            classify_transport_error(exc)
        else:
            log.error(
                "[gateways] relayed stream failed after the response started",
                error_class=type(exc).__name__,
                exc_info=True,
            )
        yield _stream_error_frame(protocol, exc)
    finally:
        # Closing this generator does not close the one it reads. Closed here, the relay's
        # own `finally` runs now and records the call, so a stream the client left is
        # still measured and charged once (OR48). Shielded for the same reason as there.
        # `LLMRelayResult.body` is typed as an iterator; every adapter yields a generator.
        aclose = getattr(body, "aclose", None)
        if aclose is not None:
            await run_shielded(aclose())


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
        # Checked before the body is read: with the plane off there is nothing to relay to,
        # and a harness that pointed at this base URL needs the refusal, not a parse error.
        if not await llm_gateway_serves_caller():
            return _map_domain_exception(LLMGatewayDisabledError())

        scope = get_auth_scope()

        raw_body = await request.body()

        try:
            context = parser(body=raw_body)
        except ValueError as exc:
            return _openai_error(
                status_code=400,
                message=_request_body_detail(exc),
                error_type="invalid_request_error",
                code="invalid_request",
            )

        caller_headers = _forward_inbound_headers(request.headers)

        try:
            result = await self.service.relay_chat_completion(
                scope=scope,
                namespace=namespace,
                name=name,
                body=raw_body,
                headers=caller_headers,
                protocol=protocol,
                run_id=gateway_run_id(request),
                run_labels=gateway_run_labels(request),
            )

            if context.stream and result.status_code < 400:
                return StreamingResponse(
                    _stream_with_terminal_error(result.body, protocol=protocol),
                    status_code=result.status_code,
                    headers=response_headers(result.headers),
                    media_type="text/event-stream",
                )

            # Read whole, even on a stream, so a refusal raised while reading is answered here.
            content = b"".join([chunk async for chunk in result.body])
        except _DOMAIN_EXCEPTIONS as exc:
            return _map_domain_exception(exc)

        return Response(
            content=content,
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
        if not await llm_gateway_serves_caller():
            return _map_domain_exception(LLMGatewayDisabledError())

        scope = get_auth_scope()

        try:
            slugs: List[str] = await self.service.list_models(
                scope=scope, namespace=namespace, name=name
            )
        except _DOMAIN_EXCEPTIONS as exc:
            return _map_domain_exception(exc)

        return {"object": "list", "data": [{"id": s, "object": "model"} for s in slugs]}
