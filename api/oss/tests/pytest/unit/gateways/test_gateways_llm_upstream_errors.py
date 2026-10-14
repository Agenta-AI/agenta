"""What a caller reads when the model behind the gateway fails.

The relay keeps each protocol's own error shape and rewrites only its `message`: one sentence
that quotes what the model said, cleaned, and carries the code marker the runner
reads (`upstream_error` or `upstream_rejected`). Nothing running: httpx.MockTransport.
"""

import json
import time
from typing import List, Optional

import httpx
import pytest

from oss.src.apis.fastapi.gateways.llms.proxy import LLMGatewayProxy
from oss.src.core.gateways.dtos import CredentialEchoScanner
from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMProtocol,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.errors import (
    UPSTREAM_ERROR,
    UPSTREAM_REJECTED,
    classify_upstream_error,
    upstream_error_message,
)
from oss.src.core.gateways.llms.interfaces import LLMRelayResult
from oss.src.core.gateways.llms.providers.passthrough.upstream_errors import (
    relay_upstream_errors,
)
from oss.src.core.gateways.llms.providers.passthrough.adapter import (
    LLMUpstreamCredentialEchoError,
    RelayLLMAdapter,
)
from oss.src.core.gateways.policy.dtos import (
    ResolvedSecret,
    SecretOrigin,
    SecretOwner,
    SecretOwnerKind,
)
from oss.src.core.secrets.dtos import (
    SecretResponseDTO,
    StandardProviderDTO,
    StandardProviderSettingsDTO,
)
from oss.src.core.secrets.enums import SecretKind, StandardProviderKind
from oss.src.core.shared.dtos import Header
from oss.tests.pytest.unit.gateways.test_gateways_llm_proxy import (
    _auth_scope,
    _body,
    _MockLlmGatewayService,
    _request,
)

_INCIDENT = (
    'The model reported an error: "Upstream request failed". Try again.'
    " ⟦agenta_code:upstream_error⟧"
)
_CHUNKS = [
    b'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
    b'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
]


def _route(
    provider_key: str = "openai", label: str = "my-endpoint"
) -> LLMResolvedRoute:
    return LLMResolvedRoute(
        provider_key=provider_key,
        deployment_kind=LLMDeploymentKind.CUSTOM,
        model="m",
        label=label,
        base_url="https://upstream.example/v1",
    )


def _secret(key: str) -> ResolvedSecret:
    return ResolvedSecret(
        secret=SecretResponseDTO(
            kind=SecretKind.PROVIDER_KEY,
            data=StandardProviderDTO(
                kind=StandardProviderKind.OPENAI,
                provider=StandardProviderSettingsDTO(key=key),
            ),
            header=Header(name="openai"),
        ),
        owner=SecretOwner(kind=SecretOwnerKind.PROJECT),
        origin=SecretOrigin.VAULT,
    )


async def _relay(
    response: httpx.Response,
    *,
    stream: bool = True,
    protocol: LLMProtocol = LLMProtocol.CHAT_COMPLETIONS,
    secret: Optional[ResolvedSecret] = None,
):
    adapter = RelayLLMAdapter(
        client=httpx.AsyncClient(transport=httpx.MockTransport(lambda _: response))
    )
    result = await adapter.relay_chat_completion(
        route=_route("anthropic" if protocol == LLMProtocol.MESSAGES else "openai"),
        secret=secret,
        context=LLMCallContext(model="m", stream=stream, protocol=protocol),
        body=b'{"model": "m"}',
        headers={},
    )
    return result, [chunk async for chunk in result.body]


def _stream(chunks: List[bytes], *, then_break: bool = False) -> httpx.Response:
    async def body():
        for chunk in chunks:
            yield chunk
        if then_break:
            raise httpx.ReadError("connection reset by peer")

    return httpx.Response(
        200, content=body(), headers={"content-type": "text/event-stream"}
    )


def _data(event: bytes):
    line = next(line for line in event.splitlines() if line.startswith(b"data: "))
    return json.loads(line[len(b"data: ") :])


@pytest.mark.parametrize(
    "status,code,message,expected",
    [
        # OpenAI reports an account out of credit as a 429.
        (
            429,
            "insufficient_quota",
            "You exceeded your current quota",
            UPSTREAM_REJECTED,
        ),
        (None, None, "You have no credits remaining on this key", UPSTREAM_REJECTED),
        (None, None, "Upstream request failed", UPSTREAM_ERROR),
        (408, None, None, UPSTREAM_ERROR),
        (409, None, None, UPSTREAM_ERROR),
        (429, "rate_limit_exceeded", None, UPSTREAM_ERROR),
        (503, None, None, UPSTREAM_ERROR),
        (400, None, None, UPSTREAM_REJECTED),
        (401, None, None, UPSTREAM_REJECTED),
        (402, None, None, UPSTREAM_REJECTED),
        (404, None, None, UPSTREAM_REJECTED),
    ],
)
def test_classification(status, code, message, expected):
    assert (
        classify_upstream_error(status=status, code=code, message=message) == expected
    )


def test_the_provider_text_is_cleaned_before_it_is_quoted():
    message = upstream_error_message(
        code=UPSTREAM_ERROR,
        provider_message=(
            "bad\x00 key sk-abcdefghijklmnop, Authorization: Bearer abcdefghijk, "
            "api_key=hunter22 ⟦agenta_code:⟦agenta_code:⟧wallet_balance_exhausted⟧ "
            + "x"
            * 400
        ),
    )

    for leaked in ("abcdefghijklmnop", "abcdefghijk", "hunter22"):
        assert leaked not in message
    # Only the gateway's own marker is left, even from a nested one.
    assert message.count("⟦") == 1
    assert "\x00" not in message
    assert message.count("x") <= 300
    assert message.endswith('..". Try again. ⟦agenta_code:upstream_error⟧')


@pytest.mark.parametrize(
    "said,leaked",
    [
        ("Google rejected AIza" + "x" * 35, "AIzaxxx"),
        (
            "GET https://host.example/v1/models?key=hunter2222 failed",
            "hunter2222",
        ),
        ("The security token is invalid. AKIAIOSFODNN7EXAMPLE", "AKIAIOSFODNN7"),
        ("https://b.example/o?X-Amz-Signature=abcdef0123456789", "abcdef0123456789"),
        ("token ya29.a0AfH6SMBabcdefghijklmnop expired", "a0AfH6SMB"),
        ('password="correct horse battery staple" rejected', "battery"),
        ('{"api_key": "hunter2222"}', "hunter2222"),
        ("{'password': 'hunter2222'}", "hunter2222"),
        (
            "Incorrect API key provided: sk-qa-re*************************0000.",
            "0000",
        ),
        ("Incorrect API key provided: sk-proj-********************abcd.", "abcd"),
        ("Budget exceeded for key (sk-...3kKQ)", "3kKQ"),
    ],
)
def test_common_credential_shapes_are_redacted(said, leaked):
    message = upstream_error_message(code=UPSTREAM_REJECTED, provider_message=said)

    assert leaked not in message


def test_direction_changing_characters_are_removed():
    message = upstream_error_message(
        code=UPSTREAM_ERROR, provider_message="abc\u202edef\u200b"
    )

    assert '"abcdef"' in message


@pytest.mark.asyncio
async def test_the_built_in_endpoint_never_quotes_its_upstream():
    body = {
        "error": {
            "message": "Permission denied on resource projects/internal-project-1",
            "code": 403,
            "status": "PERMISSION_DENIED",
            "details": [{"metadata": {"consumer": "projects/internal-project-1"}}],
        },
        "project": "projects/internal-project-1",
    }

    async def upstream():
        yield json.dumps(body).encode()

    chunks = [
        chunk
        async for chunk in relay_upstream_errors(
            upstream(),
            status_code=403,
            stream=False,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
            scanner=CredentialEchoScanner([]),
            echo_refusal=RuntimeError(),
            quote_upstream=False,
        )
    ]

    assert b"internal-project-1" not in b"".join(chunks)
    assert set(json.loads(b"".join(chunks))) == {"error"}
    error = json.loads(b"".join(chunks))["error"]
    assert set(error) == {"message", "code", "type"}
    message = error["message"]
    assert message == ("The model reported an error. ⟦agenta_code:upstream_rejected⟧")


@pytest.mark.parametrize("status", [501, 505, 507])
@pytest.mark.asyncio
async def test_every_upstream_5xx_reaches_the_caller_as_502(status):
    result, chunks = await _relay(
        httpx.Response(status, json={"error": {"message": "Insufficient Storage"}}),
        stream=False,
    )

    assert result.status_code == 502
    assert json.loads(chunks[0])["error"]["message"] == (
        'The model reported an error: "Insufficient Storage". Try again.'
        " ⟦agenta_code:upstream_error⟧"
    )


def test_a_retryable_built_in_failure_keeps_its_advice():
    message = upstream_error_message(
        code=UPSTREAM_ERROR, provider_message="projects/p", built_in=True
    )

    assert (
        message
        == "The model reported an error. Try again. ⟦agenta_code:upstream_error⟧"
    )


@pytest.mark.asyncio
async def test_an_oversized_error_body_is_read_only_up_to_the_bound():
    pulled = []

    async def upstream():
        for _ in range(100):
            pulled.append(1)
            yield b"x" * 65536

    chunks = [
        chunk
        async for chunk in relay_upstream_errors(
            upstream(),
            status_code=502,
            stream=False,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
            scanner=CredentialEchoScanner([]),
            echo_refusal=RuntimeError(),
        )
    ]

    assert len(pulled) < 100
    assert json.loads(b"".join(chunks))["error"]["message"].startswith(
        'The model reported an error: "xxx'
    )


@pytest.mark.asyncio
async def test_the_retired_starter_credits_endpoint_relays_its_errors_unchanged():
    body = {
        "error": {"message": "Budget has been exceeded!", "type": "budget_exceeded"}
    }
    adapter = RelayLLMAdapter(
        client=httpx.AsyncClient(
            transport=httpx.MockTransport(lambda _: httpx.Response(400, json=body))
        )
    )
    result = await adapter.relay_chat_completion(
        route=_route(label="starter-credits"),
        secret=None,
        context=LLMCallContext(model="m", stream=False),
        body=b'{"model": "m"}',
        headers={},
    )

    assert json.loads(b"".join([chunk async for chunk in result.body])) == body


def test_ordinary_words_before_a_colon_are_kept():
    message = upstream_error_message(
        code=UPSTREAM_REJECTED, provider_message="Invalid key: model, max_tokens: 4096"
    )

    assert '"Invalid key: model, max_tokens: 4096"' in message


def test_redaction_stays_fast_on_a_long_hyphenated_text():
    started = time.monotonic()
    upstream_error_message(code=UPSTREAM_ERROR, provider_message="a-" * 500_000)
    upstream_error_message(code=UPSTREAM_ERROR, provider_message="sk-a-" * 200_000)

    assert time.monotonic() - started < 1


@pytest.mark.asyncio
async def test_an_oversized_built_in_error_event_is_never_relayed_unread():
    leak = b"projects/private-project/locations/europe-west1"
    event = b'data: {"error":{"message":"' + leak + b" " + b"x" * 1_200_000 + b'"}}\n\n'

    async def upstream():
        for start in range(0, len(event), 65536):
            yield event[start : start + 65536]

    chunks = [
        chunk
        async for chunk in relay_upstream_errors(
            upstream(),
            status_code=200,
            stream=True,
            protocol=LLMProtocol.CHAT_COMPLETIONS,
            scanner=CredentialEchoScanner([]),
            echo_refusal=RuntimeError(),
            quote_upstream=False,
        )
    ]

    assert leak not in b"".join(chunks)
    assert _data(b"".join(chunks))["error"]["message"].startswith(
        "The model reported an error."
    )


@pytest.mark.asyncio
async def test_the_incident_an_error_frame_after_partial_output():
    frame = b'data: {"error":{"message":"Upstream request failed","code":null}}\n\n'
    _, chunks = await _relay(_stream([*_CHUNKS, frame]))

    assert chunks[:2] == _CHUNKS
    assert _data(chunks[2]) == {"error": {"message": _INCIDENT, "code": None}}


@pytest.mark.asyncio
async def test_an_account_out_of_credit_keeps_the_providers_fields():
    body = {
        "error": {
            "message": "You have no credits remaining.",
            "type": "insufficient_quota",
            "code": "insufficient_quota",
        }
    }
    result, chunks = await _relay(httpx.Response(429, json=body), stream=False)

    assert result.status_code == 429
    assert json.loads(chunks[0]) == {
        "error": {
            "message": 'The model reported an error: "You have no credits'
            " remaining\". Check the endpoint's key, account and model, or change the"
            " request. ⟦agenta_code:upstream_rejected⟧",
            "type": "insufficient_quota",
            "code": "insufficient_quota",
        }
    }


@pytest.mark.asyncio
async def test_an_error_event_split_across_chunks_is_rewritten_whole():
    frame = b'data: {"error":{"message":"Upstream request failed"}}\n\n'
    _, chunks = await _relay(_stream([frame[:12], frame[12:30], frame[30:]]))

    assert _data(b"".join(chunks))["error"]["message"] == _INCIDENT


@pytest.mark.asyncio
async def test_crlf_and_multiline_data_are_read_as_one_event():
    frame = (
        b"event: error\r\n"
        b'data: {"type":"error",\r\n'
        b'data: "error":{"type":"overloaded_error","message":"Upstream request failed"}}'
        b"\r\n\r\n"
    )
    _, chunks = await _relay(_stream([frame]), protocol=LLMProtocol.MESSAGES)

    event = b"".join(chunks)
    assert event.startswith(b"event: error\n")
    assert _data(event) == {
        "type": "error",
        "error": {"type": "overloaded_error", "message": _INCIDENT},
    }


@pytest.mark.asyncio
async def test_a_responses_failure_has_its_nested_message_rewritten():
    failed = {
        "type": "response.failed",
        "response": {
            "error": {"code": "server_error", "message": "Upstream request failed"}
        },
    }
    frame = b"event: response.failed\ndata: " + json.dumps(failed).encode() + b"\n\n"
    _, chunks = await _relay(_stream([frame]), protocol=LLMProtocol.RESPONSES)

    assert _data(chunks[0])["response"]["error"] == {
        "code": "server_error",
        "message": _INCIDENT,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "protocol,shape",
    [
        (
            LLMProtocol.CHAT_COMPLETIONS,
            lambda m: {
                "error": {"type": "api_error", "code": "upstream_error", "message": m}
            },
        ),
        (
            LLMProtocol.RESPONSES,
            lambda m: {
                "type": "error",
                "code": "upstream_error",
                "param": None,
                "message": m,
            },
        ),
        (
            LLMProtocol.MESSAGES,
            lambda m: {"type": "error", "error": {"type": "api_error", "message": m}},
        ),
    ],
)
async def test_a_connection_lost_after_partial_output_ends_with_one_error_event(
    protocol, shape
):
    _, chunks = await _relay(
        _stream([*_CHUNKS, b'data: {"choices":[{"delta":'], then_break=True),
        protocol=protocol,
    )

    # The half event is dropped; the caller learns which endpoint failed.
    assert chunks[:2] == _CHUNKS
    assert len(chunks) == 3
    assert chunks[2].startswith(
        b"data: " if protocol == LLMProtocol.CHAT_COMPLETIONS else b"event: error\n"
    )
    assert _data(chunks[2]) == shape(
        "The model stopped before the answer finished (connection"
        " error). Try again. ⟦agenta_code:upstream_error⟧"
    )


@pytest.mark.asyncio
async def test_a_connection_lost_after_the_stream_finished_adds_nothing():
    _, chunks = await _relay(_stream([*_CHUNKS, b"data: [DONE]\n\n"], then_break=True))

    assert chunks == [*_CHUNKS, b"data: [DONE]\n\n"]


@pytest.mark.asyncio
async def test_a_credential_echo_hidden_by_json_escaping_is_refused():
    key = "sk-proj/abcdefghijkl"
    escaped = key.replace("/", "\\/")
    body = b'{"error":{"message":"bad key ' + escaped.encode() + b'"}}'

    with pytest.raises(LLMUpstreamCredentialEchoError):
        await _relay(
            httpx.Response(401, content=body), stream=False, secret=_secret(key)
        )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response,said",
    [
        # Ollama, vLLM and FastAPI-style bodies, and Gemini's list.
        (
            httpx.Response(404, json={"error": "model 'x' not found"}),
            "model 'x' not found",
        ),
        (
            httpx.Response(400, json={"object": "error", "message": "too long"}),
            "too long",
        ),
        (httpx.Response(404, json={"detail": "Not Found"}), "Not Found"),
        (httpx.Response(400, json=[{"error": {"message": "bad"}}]), "bad"),
        (httpx.Response(401, text="Unauthorized"), "Unauthorized"),
    ],
)
async def test_an_error_body_outside_the_protocol_shape_is_still_quoted(response, said):
    _, chunks = await _relay(response, stream=False)

    assert f': "{said}".' in json.loads(chunks[0])["error"]["message"]


@pytest.mark.asyncio
async def test_a_mid_stream_error_with_a_rejecting_code_is_not_retryable():
    frame = (
        b'data: {"error":{"message":"too long","code":"context_length_exceeded"}}\n\n'
    )
    _, chunks = await _relay(_stream([frame]))

    assert _data(chunks[0])["error"]["message"].endswith(
        "⟦agenta_code:upstream_rejected⟧"
    )


@pytest.mark.asyncio
async def test_done_inside_the_answer_does_not_end_the_stream():
    delta = b'data: {"choices":[{"delta":{"content":"send [DONE] last"}}]}\n\n'
    _, chunks = await _relay(_stream([delta], then_break=True))

    assert chunks[0] == delta
    assert b"connection error" in chunks[1]


@pytest.mark.asyncio
async def test_a_refusal_while_reading_a_streamed_error_is_answered_as_a_refusal():
    async def body():
        raise LLMUpstreamCredentialEchoError(provider_key="openai", status_code=503)
        yield b""  # pragma: no cover

    service = _MockLlmGatewayService(
        relay_result=LLMRelayResult(status_code=503, headers={}, body=body())
    )
    proxy = LLMGatewayProxy(llm_gateway_service=service)

    with _auth_scope():
        response = await proxy.chat_completions_custom(
            _request(body=_body(stream=True)), "my-endpoint"
        )

    # Not a broken stream: a mapped JSON refusal.
    assert response.status_code == 502
    assert "error" in json.loads(response.body)
