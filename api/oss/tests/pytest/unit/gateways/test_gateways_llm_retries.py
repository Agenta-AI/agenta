"""The gateway retries a provider's transient answers the way LiteLLM's router does.

The relay runs for real (`RelayLLMAdapter` over `httpx.MockTransport`), so a retried answer is
the provider's own status and headers. `asyncio.sleep` is replaced so no test waits.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from typing import AsyncIterator, List
from uuid import uuid4

import httpx
import pytest

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LLMDeploymentKind,
    LLMEndpoint,
    LLMEndpointData,
    LLMEndpointRoute,
    LLMEndpointSettings,
    LLMModelFilter,
)
from oss.src.core.gateways.llms.interfaces import LLMRelayResult
from oss.src.core.gateways.llms.providers.passthrough.adapter import RelayLLMAdapter
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry
from oss.src.core.gateways.llms.service import UPSTREAM_MAX_RETRIES, LLMGatewayService
from oss.src.core.gateways.llms.types import LLMUpstreamError, LLMUpstreamTimeoutError
from oss.tests.pytest.unit.gateways.test_gateways_llm_service import (
    _MockAdapter,
    _MockLlmEndpointsDAO,
    _MockPolicy,
    _MockResolver,
    _scope,
    _secret,
)

_OK = {"choices": [{"message": {"content": "hi"}}], "usage": {"prompt_tokens": 3}}


@pytest.fixture
def sleeps(monkeypatch) -> List[float]:
    waited: List[float] = []

    async def _sleep(delay, *_args, **_kwargs):
        waited.append(delay)

    monkeypatch.setattr(asyncio, "sleep", _sleep)
    return waited


def _row(timeout_seconds=None) -> LLMEndpoint:
    return LLMEndpoint(
        id=uuid4(),
        slug="acme",
        provider_key="openai",
        deployment_kind=LLMDeploymentKind.CUSTOM,
        namespace=GatewayEndpointNamespace.CUSTOM,
        secret_id=uuid4(),
        data=LLMEndpointData(
            route=LLMEndpointRoute(base_url="https://upstream.example/v1"),
            models=LLMModelFilter(allowlist=["gpt-4o"]),
            settings=LLMEndpointSettings(timeout_seconds=timeout_seconds),
        ),
    )


def _service(adapter, *, policy=None, timeout_seconds=None) -> LLMGatewayService:
    dao = _MockLlmEndpointsDAO()
    dao.rows_by_slug["acme"] = _row(timeout_seconds)
    return LLMGatewayService(
        llm_endpoints_dao=dao,
        policy=policy or _MockPolicy(),
        resolver=_MockResolver(secret=_secret()),
        upstream_registry=LLMUpstreamRegistry(adapters={"relay": adapter}),
    )


def _upstream(*responses: httpx.Response):
    """A provider that answers each call with the next response; returns the call log."""
    calls: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        return responses[len(calls) - 1]

    adapter = RelayLLMAdapter(
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    return adapter, calls


async def _relay(service, *, stream=False):
    return await service.relay_chat_completion(
        scope=_scope(),
        namespace=GatewayEndpointNamespace.CUSTOM,
        name="acme",
        body=json.dumps({"model": "gpt-4o", "messages": [], "stream": stream}).encode(),
        headers={},
    )


@pytest.mark.asyncio
async def test_a_429_is_retried_after_the_providers_retry_after(sleeps):
    adapter, calls = _upstream(
        httpx.Response(429, json={"error": "slow down"}, headers={"Retry-After": "3"}),
        httpx.Response(200, json=_OK),
    )
    policy = _MockPolicy()

    result = await _relay(_service(adapter, policy=policy))

    assert len(calls) == 2
    assert sleeps == [3.0]
    assert result.status_code == 200
    assert json.loads(b"".join([c async for c in result.body])) == _OK
    # Only the attempt that answered is recorded, with that attempt's status and usage.
    ((_, _, _, outcome),) = policy.record_calls
    assert outcome.status_code == 200
    assert outcome.usage.input_tokens == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [408, 409, 429, 500, 502, 503, 504])
async def test_each_transient_status_is_retried(sleeps, status):
    adapter, calls = _upstream(httpx.Response(status), httpx.Response(200, json=_OK))

    result = await _relay(_service(adapter))

    assert len(calls) == 2
    assert result.status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
async def test_another_4xx_is_relayed_without_a_retry(sleeps, status):
    adapter, calls = _upstream(httpx.Response(status, json={"error": "no"}))

    result = await _relay(_service(adapter))

    assert len(calls) == 1
    assert sleeps == []
    assert result.status_code == status


@pytest.mark.asyncio
async def test_a_5xx_backs_off_exponentially_and_fails_after_two_retries(sleeps):
    adapter, calls = _upstream(*[httpx.Response(503) for _ in range(3)])

    result = await _relay(_service(adapter))

    assert len(calls) == UPSTREAM_MAX_RETRIES + 1
    # Every upstream 5xx reaches the caller as 502, so a harness retries it too.
    assert result.status_code == 502
    first, second = sleeps
    assert 0.5 <= first <= 0.5 + 0.75
    assert 1.0 <= second <= 1.0 + 0.75


@pytest.mark.asyncio
async def test_a_429_that_outlasts_the_retries_is_relayed_as_the_provider_sent_it(
    sleeps,
):
    adapter, calls = _upstream(
        *[httpx.Response(429, json={"error": "slow down"}) for _ in range(3)]
    )

    result = await _relay(_service(adapter))

    assert len(calls) == 3
    assert result.status_code == 429
    error = json.loads(b"".join([c async for c in result.body]))["error"]
    assert error["message"].startswith("The model reported an error")


@pytest.mark.asyncio
async def test_a_retry_after_above_sixty_seconds_falls_back_to_the_backoff(sleeps):
    adapter, _ = _upstream(
        httpx.Response(503, headers={"Retry-After": "120"}),
        httpx.Response(200, json=_OK),
    )

    await _relay(_service(adapter))

    (waited,) = sleeps
    assert waited < 2


@pytest.mark.asyncio
async def test_a_timeout_is_not_retried(sleeps):
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        raise httpx.ReadTimeout("timed out", request=request)

    calls: List[httpx.Request] = []
    adapter = RelayLLMAdapter(
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )

    with pytest.raises(LLMUpstreamTimeoutError):
        await _relay(_service(adapter))

    assert len(calls) == 1
    assert sleeps == []


@pytest.mark.asyncio
async def test_the_routes_own_deadline_is_a_timeout_and_is_not_retried():
    class _Silent(_MockAdapter):
        async def relay_chat_completion(self, **kwargs):
            self.calls.append(kwargs)
            await asyncio.Event().wait()

    adapter = _Silent(result=None)

    with pytest.raises(LLMUpstreamTimeoutError):
        await _relay(_service(adapter, timeout_seconds=0.01))

    assert len(adapter.calls) == 1


@pytest.mark.asyncio
async def test_a_stream_that_fails_after_its_first_byte_is_not_retried(sleeps):
    async def _breaks() -> AsyncIterator[bytes]:
        yield b"data: {}\n\n"
        raise LLMUpstreamError(provider_key="openai", status_code=503)

    adapter = _MockAdapter(
        result=LLMRelayResult(status_code=200, headers={}, body=_breaks())
    )
    result = await _relay(_service(adapter), stream=True)

    assert await anext(result.body) == b"data: {}\n\n"
    with pytest.raises(LLMUpstreamError):
        await anext(result.body)
    assert len(adapter.calls) == 1
    assert sleeps == []


@pytest.mark.asyncio
async def test_a_retried_answer_is_read_to_its_end_so_its_connection_closes(sleeps):
    closed: List[bool] = []

    async def _rate_limited() -> AsyncIterator[bytes]:
        try:
            yield b'{"error": "slow down"}'
        finally:
            closed.append(True)

    class _Scripted(_MockAdapter):
        async def relay_chat_completion(self, **kwargs):
            self.calls.append(kwargs)
            if len(self.calls) == 1:
                return LLMRelayResult(status_code=429, headers={}, body=_rate_limited())
            return self.result

    adapter = _Scripted(
        result=LLMRelayResult(
            status_code=200, headers={}, body=_one_chunk(json.dumps(_OK).encode())
        )
    )

    await _relay(_service(adapter))

    assert closed == [True]


async def _one_chunk(data: bytes) -> AsyncIterator[bytes]:
    yield data


@pytest.mark.asyncio
async def test_a_retry_after_given_as_a_date_is_honored(sleeps):
    when = format_datetime(
        datetime.now(timezone.utc) + timedelta(seconds=30), usegmt=True
    )
    adapter, _ = _upstream(
        httpx.Response(429, headers={"Retry-After": when}),
        httpx.Response(200, json=_OK),
    )

    await _relay(_service(adapter))

    (waited,) = sleeps
    assert 25 < waited <= 30


class _StallingBody(httpx.AsyncByteStream):
    async def __aiter__(self):
        raise httpx.ReadTimeout("timed out")
        yield b""  # pragma: no cover


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "status,stream", [(429, True), (429, False), (503, True), (503, False)]
)
async def test_an_error_body_that_never_arrives_is_a_timeout_and_is_not_retried(
    sleeps, status, stream
):
    adapter, calls = _upstream(httpx.Response(status, stream=_StallingBody()))

    with pytest.raises(LLMUpstreamTimeoutError):
        await _relay(_service(adapter), stream=stream)

    assert len(calls) == 1
    assert sleeps == []


class _StallsAfterOneChunk(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b'data: {"choices": [{"delta": {"content": "Hi"}}]}\n\n'
        raise httpx.ReadTimeout("timed out")


@pytest.mark.asyncio
async def test_a_stream_that_stalls_after_it_started_ends_with_the_connection_lost_event(
    sleeps,
):
    adapter, calls = _upstream(httpx.Response(200, stream=_StallsAfterOneChunk()))

    result = await _relay(_service(adapter), stream=True)
    chunks = [chunk async for chunk in result.body]

    assert len(calls) == 1
    assert sleeps == []
    assert b"Hi" in chunks[0]
    assert b"connection error" in chunks[-1]


@pytest.mark.asyncio
async def test_a_retry_that_would_outlast_the_routes_timeout_is_not_started(sleeps):
    adapter, calls = _upstream(
        httpx.Response(429, json={"error": "slow down"}, headers={"Retry-After": "30"}),
        httpx.Response(503, headers={"Retry-After": "30"}),
    )
    service = _service(adapter, timeout_seconds=10)

    assert (await _relay(service)).status_code == 429
    assert (await _relay(service)).status_code == 502

    assert len(calls) == 2
    assert sleeps == []


@pytest.mark.asyncio
async def test_a_retryable_body_that_outlasts_the_routes_timeout_is_a_timeout():
    closed: List[bool] = []

    async def _trickles() -> AsyncIterator[bytes]:
        try:
            yield b'{"error": '
            await asyncio.Event().wait()
        finally:
            closed.append(True)

    adapter = _MockAdapter(
        result=LLMRelayResult(
            status_code=429, headers={"retry-after": "0.01"}, body=_trickles()
        )
    )

    with pytest.raises(LLMUpstreamTimeoutError):
        await _relay(_service(adapter, timeout_seconds=0.05))

    assert len(adapter.calls) == 1
    assert closed == [True]
