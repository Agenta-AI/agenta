"""Adapter interface contract tests (entities.md §7.1, workstreams/specs-wp5.md).

The same fixture every `LLMUpstreamInterface` / `MCPUpstreamInterface` implementation
must pass — run against `MockLLMAdapter`/`MockMCPAdapter` now, reused by WP6/WP7/WP8/WP9's
real adapters once they exist. An adapter that is not implemented yet is parametrized in
as a skip, not omitted, so the moment `PassthroughLLMAdapter` etc. lands this file starts
enforcing the contract on it with no further edits here.

Nothing running: plain Python objects.
"""

import importlib
import json
from dataclasses import fields
from types import SimpleNamespace

import httpx
import pytest

from oss.src.core.gateways.llms.dtos import (
    LLMCallContext,
    LLMDeploymentKind,
    LLMResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import LLMRelayResult
from oss.src.core.gateways.llms.providers.mock.adapter import MockLLMAdapter

from oss.src.core.gateways.mcps.dtos import (
    MCPCallContext,
    MCPDirectAuth,
    MCPResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import MCPRelayResult
from oss.src.core.gateways.mcps.providers.mock.adapter import MockMCPAdapter


def _optional_instance(module_path: str, class_name: str):
    """None when the module/class doesn't exist yet — the real adapters land
    with WP6/WP7 (LLM) and WP8/WP9 (MCP), after this package."""
    try:
        module = importlib.import_module(module_path)
        return getattr(module, class_name)()
    except (ImportError, AttributeError):
        return None


def _adapter_param(instance, *, name: str):
    if instance is None:
        return pytest.param(
            None, id=name, marks=pytest.mark.skip(reason=f"{name} not implemented yet")
        )
    return pytest.param(instance, id=name)


def _passthrough_mock_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"id": "chatcmpl-contract", "choices": []})


def _passthrough_llm_adapter():
    """PassthroughLLMAdapter needs real network I/O (entities.md §7.1), so —
    unlike the other entries here — it cannot be built with a bare no-arg
    constructor: it is wired against an `httpx.MockTransport` instead, keeping
    this contract test in the "nothing running" tier (workstreams/specs-wp6.md)."""
    try:
        module = importlib.import_module(
            "oss.src.core.gateways.llms.providers.passthrough.adapter"
        )
        adapter_cls = module.PassthroughLLMAdapter
    except (ImportError, AttributeError):
        return None

    transport = httpx.MockTransport(_passthrough_mock_handler)
    return adapter_cls(client=httpx.AsyncClient(transport=transport))


def _mcp_mock_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {}})


def _http_mcp_adapter():
    """Like the passthrough one, HttpMCPAdapter makes a real outbound call, so it
    gets an `httpx.MockTransport` rather than a bare constructor.

    It also runs the outbound guard (D28) before that transport is ever reached, so the
    route below is a public https host with a patched resolver — what a real custom
    server looks like — rather than an internal address the guard would rightly block."""
    try:
        module = importlib.import_module(
            "oss.src.core.gateways.mcps.providers.http.adapter"
        )
        adapter_cls = module.HttpMCPAdapter
    except (ImportError, AttributeError):
        return None

    return adapter_cls(transport=httpx.MockTransport(_mcp_mock_handler))


_LLM_ADAPTER_PARAMS = [
    _adapter_param(MockLLMAdapter(), name="MockLLMAdapter"),
    _adapter_param(_passthrough_llm_adapter(), name="PassthroughLLMAdapter"),
    _adapter_param(
        _optional_instance(
            "oss.src.core.gateways.llms.providers.translated.adapter",
            "TranslatedLLMAdapter",
        ),
        name="TranslatedLLMAdapter",
    ),
]

_MCP_ADAPTER_PARAMS = [
    _adapter_param(MockMCPAdapter(), name="MockMCPAdapter"),
    _adapter_param(_http_mcp_adapter(), name="HttpMCPAdapter"),
    _adapter_param(
        _optional_instance(
            "oss.src.core.gateways.mcps.providers.composio.adapter",
            "ComposioMCPAdapter",
        ),
        name="ComposioMCPAdapter",
    ),
]


@pytest.fixture(autouse=True)
def _mock_litellm_acompletion(monkeypatch):
    """`TranslatedLLMAdapter` (WP7) is the one adapter here that calls out to litellm — mock
    it at its own import site so this fixture stays a no-op for every other adapter and
    still never opens a socket once the module exists."""
    try:
        from oss.src.core.gateways.llms.providers.translated import (
            adapter as translated_adapter_module,
        )
    except ImportError:
        yield
        return

    async def _mock_acompletion(*, model, stream=False, **kwargs):  # noqa: ARG001
        response = SimpleNamespace(
            usage=SimpleNamespace(prompt_tokens=1, completion_tokens=1),
            _hidden_params={"response_cost": 0.0},
            model_dump_json=lambda: json.dumps(
                {"choices": [{"message": {"role": "assistant", "content": "hi"}}]}
            ),
        )
        if not stream:
            return response

        async def _stream():
            yield response

        return _stream()

    monkeypatch.setattr(
        translated_adapter_module.litellm, "acompletion", _mock_acompletion
    )
    yield


@pytest.mark.parametrize("adapter", _LLM_ADAPTER_PARAMS)
async def test_relay_chat_completion_returns_llm_relay_result(adapter):
    route = LLMResolvedRoute(
        provider_key="mock",
        deployment_kind=LLMDeploymentKind.DIRECT,
        model="mock/echo",
        # Unused by MockLLMAdapter; PassthroughLLMAdapter needs one to build an
        # outbound URL, and the MockTransport above never dials it for real.
        base_url="http://mock-passthrough-upstream.invalid",
    )
    body = json.dumps(
        {"model": "mock/echo", "messages": [{"role": "user", "content": "hi"}]}
    ).encode()

    result = await adapter.relay_chat_completion(
        route=route,
        secret=None,
        context=LLMCallContext(model="mock/echo"),
        body=body,
        headers={},
    )

    assert isinstance(result, LLMRelayResult)
    assert not isinstance(result, dict)
    assert {f.name for f in fields(result)} == {
        "status_code",
        "headers",
        "body",
        "usage",
    }


@pytest.mark.parametrize("adapter", _MCP_ADAPTER_PARAMS)
@pytest.mark.parametrize("method", ["initialize", "tools/list", "tools/call"])
async def test_relay_returns_mcp_relay_result(adapter, method, monkeypatch):
    # HttpMCPAdapter runs the outbound guard (D28) before its transport. Model a real
    # custom server: a public https host, resolver patched so no DNS is needed. The
    # guard stays on — a public target simply passes it, which is the whole point.
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils._WEBHOOK_ALLOW_INSECURE", False, raising=False
    )
    monkeypatch.setattr(
        "oss.src.core.webhooks.utils.socket.getaddrinfo",
        lambda *a, **kw: [(None, None, None, None, ("93.184.216.34", 0))],
    )
    route = MCPResolvedRoute(url="https://mcp.example.com/")
    auth = MCPDirectAuth(secret=None)
    payload = {"jsonrpc": "2.0", "id": 1, "method": method}
    if method == "tools/call":
        payload["params"] = {"name": "echo", "arguments": {}}
    body = json.dumps(payload).encode()

    result = await adapter.relay(
        route=route,
        auth=auth,
        context=MCPCallContext(method=method),
        body=body,
        headers={},
    )

    assert isinstance(result, MCPRelayResult)
    assert not isinstance(result, dict)
    assert {f.name for f in fields(result)} == {"status_code", "headers", "body"}
