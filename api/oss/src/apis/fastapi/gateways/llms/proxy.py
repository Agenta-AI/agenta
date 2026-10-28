"""Protocol-shaped LLM gateway proxy responses."""

import json
import re
from typing import TYPE_CHECKING, Any, AsyncIterator, Callable, Dict, List, Optional

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from oss.src.core.credentials.policy import PersonalCredentialRefused
from oss.src.utils.env import env
from oss.src.utils.logging import get_module_logger
from oss.src.apis.fastapi.gateways.exceptions import log_plane_disabled
from oss.src.apis.fastapi.gateways.llms.utils import (
    parse_gemini_call_context,
    LLMRequestBodyError,
    parse_llm_call_context,
    parse_messages_call_context,
    parse_responses_call_context,
)
from oss.src.apis.fastapi.gateways.utils import response_headers
from oss.src.core.gateways.dtos import (
    GatewayEndpointNamespace,
    forwardable_request_headers,
    with_code_marker,
)
from oss.src.core.gateways.cleanup import run_shielded
from oss.src.core.gateways.egress import classify_transport_error
from oss.src.core.gateways.llms.dtos import LLMCallContext, LLMProtocol
from oss.src.core.gateways.llms.errors import (
    UPSTREAM_ERROR,
    connection_lost_message,
    google_error,
)
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
    LLMNamedConnectionNotFoundError,
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
from oss.src.core.gateways.run_claims import (
    gateway_platform_run,
    gateway_run_id,
    gateway_run_labels,
)
from oss.src.middlewares.auth import GATEWAY_TOKEN_AUDIENCE, request_audience
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
    LLMNamedConnectionNotFoundError,
    PersonalCredentialRefused,
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


BUILTIN_REQUIRES_AGENT_RUN = "builtin_requires_agent_run"


def _refuse_builtin_outside_agent_run(
    request: Optional[Request],
) -> Optional[JSONResponse]:
    """Built-in models are platform-funded, so only the platform's agent runs may call them.

    Only a gateway token the exchange marked for the platform runtime passes. An API key,
    a session, a general Secret token and every other gateway token are refused here,
    before the body is read, so a refused call is never parsed, relayed or charged.
    """
    audience = request_audience(request) if request is not None else None
    if audience == GATEWAY_TOKEN_AUDIENCE and gateway_platform_run(request):
        return None

    log.info(
        "[gateways] built-in model call refused outside a platform agent run",
        organization_id=str(get_auth_scope().organization_id),
        audience=audience,
    )
    return _openai_error(
        status_code=403,
        message="Built-in models are only available to agent runs started by the platform.",
        error_type="permission_error",
        code=BUILTIN_REQUIRES_AGENT_RUN,
        headers=_NOT_RETRYABLE,
    )


# A bare Gemini model id, safe in a URL path: no slash, no dot segment, no escape.
_BARE_GEMINI_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")


def _google_error_response(*, status_code: int, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=google_error(status=status_code, message=message),
    )


def _as_google_error(response: Response) -> Response:
    """A refusal the gateway answered in OpenAI's shape, in Google's shape instead, with the
    same status and the same (marked) message."""
    try:
        payload = json.loads(response.body)
    except (AttributeError, ValueError):
        payload = None
    error = payload.get("error") if isinstance(payload, dict) else None
    message = error.get("message") if isinstance(error, dict) else None
    status_code = response.status_code
    if isinstance(error, dict) and error.get("code") == "upstream_timeout":
        # The gateway gave up waiting. Google's client drops the string code, so the native
        # caller gets what a timeout mid-stream says: 504 and the marked upstream sentence,
        # which Pi retries and the runner reads as an upstream error.
        status_code = 504
        message = with_code_marker(
            "The model provider did not answer in time.", UPSTREAM_ERROR
        )
    headers = {
        key: value
        for key, value in response.headers.items()
        if key.lower() not in ("content-length", "content-type")
    }
    return JSONResponse(
        status_code=status_code,
        content=google_error(
            status=status_code,
            message=message if isinstance(message, str) else "request refused",
        ),
        headers=headers,
    )


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
    if isinstance(exc, PersonalCredentialRefused):
        # The person's own account cannot be used (M7). The message is for the person.
        return _openai_error(
            status_code=403,
            message=exc.message,
            error_type="invalid_request_error",
            code=exc.code,
            headers=_NOT_RETRYABLE,
        )
    if isinstance(exc, LLMNamedConnectionNotFoundError):
        return _openai_error(
            status_code=404,
            message=exc.message,
            error_type="invalid_request_error",
            code="connection_not_found",
        )
    if isinstance(exc, LLMUpstreamTimeoutError):
        # 408, as LiteLLM answers its own timeout: the gateway gave up waiting, which is
        # not the same as a provider answering 504.
        return _openai_error(
            status_code=408,
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

    if protocol == LLMProtocol.GEMINI:
        status = 504 if isinstance(exc, LLMUpstreamTimeoutError) else 502
        error = google_error(status=status, message=message)
        return b"\n\ndata: " + json.dumps(error, ensure_ascii=False).encode() + b"\n\n"

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
            "/organization/{slug}/v1/chat/completions",
            self.chat_completions_organization,
            methods=["POST"],
            operation_id="llm_gateway_chat_completions_organization",
        )
        self.router.add_api_route(
            "/user/{provider}/v1/chat/completions",
            self.chat_completions_user,
            methods=["POST"],
            operation_id="llm_gateway_chat_completions_user",
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
            "/organization/{slug}/v1/responses",
            self.responses_organization,
            methods=["POST"],
            operation_id="llm_gateway_responses_organization",
        )
        self.router.add_api_route(
            "/user/{provider}/v1/responses",
            self.responses_user,
            methods=["POST"],
            operation_id="llm_gateway_responses_user",
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
            "/builtin/{provider}/v1beta/models/{model}:streamGenerateContent",
            self.gemini_stream_builtin,
            methods=["POST"],
            operation_id="llm_gateway_gemini_stream_builtin",
        )
        self.router.add_api_route(
            "/organization/{slug}/v1/messages",
            self.messages_organization,
            methods=["POST"],
            operation_id="llm_gateway_messages_organization",
        )
        self.router.add_api_route(
            "/user/{provider}/v1/messages",
            self.messages_user,
            methods=["POST"],
            operation_id="llm_gateway_messages_user",
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
        self.router.add_api_route(
            "/organization/{slug}/v1/models",
            self.list_models_organization,
            methods=["GET"],
            operation_id="llm_gateway_list_models_organization",
        )
        self.router.add_api_route(
            "/user/{provider}/v1/models",
            self.list_models_user,
            methods=["GET"],
            operation_id="llm_gateway_list_models_user",
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

    async def chat_completions_organization(
        self, request: Request, slug: str
    ) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.ORGANIZATION,
            name=slug,
            parser=parse_llm_call_context,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
        )

    async def chat_completions_user(self, request: Request, provider: str) -> Response:
        # The person's own key for `provider` (M7): only for a run whose signed bindings
        # name this model connection as each person's own account.
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.USER,
            name=provider,
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

    async def responses_organization(self, request: Request, slug: str) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.ORGANIZATION,
            name=slug,
            parser=parse_responses_call_context,
            protocol=LLMProtocol.RESPONSES,
        )

    async def responses_user(self, request: Request, provider: str) -> Response:
        # The person's own key for `provider` (M7): only for a run whose signed bindings
        # name this model connection as each person's own account.
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.USER,
            name=provider,
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

    # --- gemini (native) ---------------------------------------------------------- #

    async def messages_user(self, request: Request, provider: str) -> Response:
        # The person's own key for `provider` (M7): only for a run whose signed bindings
        # name this model connection as each person's own account.
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.USER,
            name=provider,
            parser=parse_messages_call_context,
            protocol=LLMProtocol.MESSAGES,
        )

    async def gemini_stream_builtin(
        self, request: Request, provider: str, model: str
    ) -> Response:
        """Google's native `streamGenerateContent`, for the built-in Gemini models only.

        Pi's Google client calls this with the bare model id in the path
        (`docs/design/gemini-native-door`). The model is named `google/<model>` so the
        allowlist and the rate card read it as they read the chat door's. Query parameters
        (`alt`, `key`) are not forwarded: the upstream URL sets `alt=sse` itself.
        """
        if not _BARE_GEMINI_MODEL.fullmatch(model):
            return _google_error_response(
                status_code=400, message="The model must be a bare Gemini model id."
            )
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.BUILTIN,
            name=provider,
            parser=lambda body: parse_gemini_call_context(body=body, model=model),
            protocol=LLMProtocol.GEMINI,
        )

    async def messages_organization(self, request: Request, slug: str) -> Response:
        return await self._relay(
            request,
            namespace=GatewayEndpointNamespace.ORGANIZATION,
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
        response = await self._relay_protocol(
            request, namespace=namespace, name=name, parser=parser, protocol=protocol
        )
        # A native Gemini caller reads only Google's error shape.
        if protocol == LLMProtocol.GEMINI and response.status_code >= 400:
            return _as_google_error(response)
        return response

    async def _relay_protocol(
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
        if not env.llm_gateway.enabled:
            return _map_domain_exception(LLMGatewayDisabledError())

        if namespace == GatewayEndpointNamespace.BUILTIN:
            refusal = _refuse_builtin_outside_agent_run(request)
            if refusal is not None:
                return refusal

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
                # The native door's model is in its URL, so it hands over the context it
                # built; every other door's is read from the body by the service.
                **({"context": context} if protocol == LLMProtocol.GEMINI else {}),
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

    async def list_models_builtin(self, request: Request, provider: str) -> Any:
        return await self._list_models(
            namespace=GatewayEndpointNamespace.BUILTIN, name=provider, request=request
        )

    async def list_models_standard(self, provider: str) -> Any:
        return await self._list_models(
            namespace=GatewayEndpointNamespace.STANDARD, name=provider
        )

    async def list_models_custom(self, slug: str) -> Any:
        return await self._list_models(
            namespace=GatewayEndpointNamespace.CUSTOM, name=slug
        )

    async def list_models_organization(self, slug: str) -> Any:
        return await self._list_models(
            namespace=GatewayEndpointNamespace.ORGANIZATION, name=slug
        )

    async def list_models_user(self, provider: str) -> Any:
        return await self._list_models(
            namespace=GatewayEndpointNamespace.USER, name=provider
        )

    async def _list_models(
        self,
        *,
        namespace: GatewayEndpointNamespace,
        name: str,
        request: Optional[Request] = None,
    ) -> Any:
        # Any, not Dict[str, Any]: the success path returns the OpenAI list body,
        # the denial path returns a JSONResponse — FastAPI passes a Response
        # instance through unprocessed either way.
        if not env.llm_gateway.enabled:
            return _map_domain_exception(LLMGatewayDisabledError())

        if namespace == GatewayEndpointNamespace.BUILTIN:
            refusal = _refuse_builtin_outside_agent_run(request)
            if refusal is not None:
                return refusal

        scope = get_auth_scope()

        try:
            slugs: List[str] = await self.service.list_models(
                scope=scope, namespace=namespace, name=name
            )
        except _DOMAIN_EXCEPTIONS as exc:
            return _map_domain_exception(exc)

        return {"object": "list", "data": [{"id": s, "object": "model"} for s in slugs]}
