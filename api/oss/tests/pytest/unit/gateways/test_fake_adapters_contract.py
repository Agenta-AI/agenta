"""Adapter interface contract tests (entities.md §7.1, workstreams/specs-wp5.md).

The same fixture every `LlmUpstreamInterface` / `McpUpstreamInterface` implementation
must pass — run against `FakeLlmAdapter`/`FakeMcpAdapter` now, reused by WP6/WP7/WP8/WP9's
real adapters once they exist. An adapter that is not implemented yet is parametrized in
as a skip, not omitted, so the moment `PassthroughLlmAdapter` etc. lands this file starts
enforcing the contract on it with no further edits here.

Nothing running: plain Python objects.
"""

import importlib
import json
from dataclasses import fields

import pytest

from oss.src.core.gateways.llms.dtos import (
    LlmCallContext,
    LlmDeploymentKind,
    LlmResolvedRoute,
)
from oss.src.core.gateways.llms.interfaces import LlmRelayResult
from oss.src.core.gateways.llms.providers.fake.adapter import FakeLlmAdapter

from oss.src.core.gateways.mcps.dtos import (
    McpCallContext,
    McpDirectAuth,
    McpResolvedRoute,
)
from oss.src.core.gateways.mcps.interfaces import McpRelayResult
from oss.src.core.gateways.mcps.providers.fake.adapter import FakeMcpAdapter


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


_LLM_ADAPTER_PARAMS = [
    _adapter_param(FakeLlmAdapter(), name="FakeLlmAdapter"),
    _adapter_param(
        _optional_instance(
            "oss.src.core.gateways.llms.providers.passthrough.adapter",
            "PassthroughLlmAdapter",
        ),
        name="PassthroughLlmAdapter",
    ),
    _adapter_param(
        _optional_instance(
            "oss.src.core.gateways.llms.providers.translated.adapter",
            "TranslatedLlmAdapter",
        ),
        name="TranslatedLlmAdapter",
    ),
]

_MCP_ADAPTER_PARAMS = [
    _adapter_param(FakeMcpAdapter(), name="FakeMcpAdapter"),
    _adapter_param(
        _optional_instance(
            "oss.src.core.gateways.mcps.providers.http.adapter", "HttpMcpAdapter"
        ),
        name="HttpMcpAdapter",
    ),
    _adapter_param(
        _optional_instance(
            "oss.src.core.gateways.mcps.providers.composio.adapter",
            "ComposioMcpAdapter",
        ),
        name="ComposioMcpAdapter",
    ),
]


@pytest.mark.parametrize("adapter", _LLM_ADAPTER_PARAMS)
async def test_relay_chat_completion_returns_llm_relay_result(adapter):
    route = LlmResolvedRoute(
        provider_key="fake", deployment=LlmDeploymentKind.DIRECT, model="fake/echo"
    )
    body = json.dumps(
        {"model": "fake/echo", "messages": [{"role": "user", "content": "hi"}]}
    ).encode()

    result = await adapter.relay_chat_completion(
        route=route,
        credential=None,
        context=LlmCallContext(model="fake/echo"),
        body=body,
        headers={},
    )

    assert isinstance(result, LlmRelayResult)
    assert not isinstance(result, dict)
    assert {f.name for f in fields(result)} == {
        "status_code",
        "headers",
        "body",
        "usage",
    }


@pytest.mark.parametrize("adapter", _MCP_ADAPTER_PARAMS)
@pytest.mark.parametrize("method", ["initialize", "tools/list", "tools/call"])
async def test_relay_returns_mcp_relay_result(adapter, method):
    route = McpResolvedRoute(url="http://fake-mcp-gateway:9092/")
    auth = McpDirectAuth(credential=None)
    payload = {"jsonrpc": "2.0", "id": 1, "method": method}
    if method == "tools/call":
        payload["params"] = {"name": "echo", "arguments": {}}
    body = json.dumps(payload).encode()

    result = await adapter.relay(
        route=route,
        auth=auth,
        context=McpCallContext(method=method),
        body=body,
        headers={},
    )

    assert isinstance(result, McpRelayResult)
    assert not isinstance(result, dict)
    assert {f.name for f in fields(result)} == {"status_code", "headers", "body"}
