"""Unit tests for `registry.py` (specs-wp24.md, tasks-wp24.md Phase 1). Nothing running."""

import ast
from pathlib import Path

import pytest
from agenta.sdk.utils.assets import supported_llm_models

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind
from oss.src.core.gateways.llms.interfaces import LLMRelayResult, LLMUpstreamInterface
from oss.src.core.gateways.llms.registry import LLMUpstreamRegistry, select_upstream
from oss.src.core.gateways.llms.types import LLMAdapterNotFoundError


@pytest.mark.parametrize("deployment_kind", list(LLMDeploymentKind))
def test_mock_deployment_kind_always_selects_mock(deployment_kind):
    expected = "mock" if deployment_kind == LLMDeploymentKind.MOCK else "relay"
    assert select_upstream("anything", deployment_kind) == expected


@pytest.mark.parametrize("provider_key", ["openai", "anthropic", "mock", None, "acme"])
def test_provider_key_never_changes_the_answer_except_via_deployment_kind(provider_key):
    """D34 removed the one branch that read `provider_key` on a stored row
    (entities.md §2.4) — the whole decision is `deployment_kind` now."""
    for deployment_kind in LLMDeploymentKind:
        expected = "mock" if deployment_kind == LLMDeploymentKind.MOCK else "relay"
        assert select_upstream(provider_key, deployment_kind) == expected


def test_select_upstream_imports_nothing_beyond_llm_deployment_kind():
    """Pure — no DAO, no vault, no I/O (specs-wp24.md's own contract)."""
    module_path = (
        Path(__file__).parents[4] / "src/core/gateways/llms/registry.py"
    ).resolve()
    tree = ast.parse(module_path.read_text())
    imported_modules = {
        alias.name
        for node in ast.walk(tree)
        if isinstance(node, ast.Import)
        for alias in node.names
    } | {
        node.module
        for node in ast.walk(tree)
        if isinstance(node, ast.ImportFrom) and node.module
    }
    forbidden = {"httpx", "litellm"}
    assert not (imported_modules & forbidden)
    assert not any("dao" in module.lower() for module in imported_modules)


class _StubAdapter(LLMUpstreamInterface):
    async def relay_chat_completion(self, **kwargs) -> LLMRelayResult:  # noqa: ARG002
        raise NotImplementedError


def test_registry_get_raises_on_a_miss():
    registry = LLMUpstreamRegistry(adapters={})
    with pytest.raises(LLMAdapterNotFoundError):
        registry.get("relay")


def test_registry_get_and_keys_roundtrip():
    adapter = _StubAdapter()
    registry = LLMUpstreamRegistry(adapters={"relay": adapter})
    assert registry.get("relay") is adapter
    assert registry.keys() == ["relay"]


def test_every_catalogued_direct_provider_resolves_to_relay():
    """No provider in `supported_llm_models` is unreachable at the select_upstream layer —
    OD16 cleared them all; a provider absent from `routing.py`'s table (none, today) would
    fail at relay time instead, with the reason named."""
    for provider_key in supported_llm_models:
        assert select_upstream(provider_key, LLMDeploymentKind.DIRECT) == "relay"
