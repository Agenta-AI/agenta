"""Unit tests for `registry.py` (specs-wp7.md, tasks-wp7.md Phases 2 and 8). Nothing running."""

import ast
from pathlib import Path

import pytest
from agenta.sdk.utils.assets import supported_llm_models

from oss.src.core.gateways.llms.dtos import LlmDeploymentKind
from oss.src.core.gateways.llms.interfaces import LlmRelayResult, LlmUpstreamInterface
from oss.src.core.gateways.llms.registry import LlmUpstreamRegistry, select_upstream
from oss.src.core.gateways.llms.types import LlmAdapterNotFoundError

_TRANSLATED_DEPLOYMENTS = [
    LlmDeploymentKind.AZURE,
    LlmDeploymentKind.BEDROCK,
    LlmDeploymentKind.SAGEMAKER,
    LlmDeploymentKind.VERTEX,
]

_DIRECT_PASSTHROUGH_PROVIDERS = [
    "openai",
    "groq",
    "together_ai",
    "openrouter",
    "mistral",
    "mistralai",
]

_DIRECT_TRANSLATED_PROVIDERS = [
    "anthropic",
    "gemini",
    "cohere",
    "deepinfra",
    "perplexityai",
    "minimax",
]

_DIRECT_PASSTHROUGH_PROVIDERS_SET = set(_DIRECT_PASSTHROUGH_PROVIDERS)
_DIRECT_TRANSLATED_PROVIDERS_SET = set(_DIRECT_TRANSLATED_PROVIDERS)


@pytest.mark.parametrize("deployment", _TRANSLATED_DEPLOYMENTS)
@pytest.mark.parametrize("provider_key", ["openai", "anthropic", "acme"])
def test_cloud_reseller_deployments_are_always_translated(provider_key, deployment):
    assert select_upstream(provider_key, deployment) == "translated"


@pytest.mark.parametrize("provider_key", ["openai", "anthropic", "acme"])
def test_custom_deployment_is_always_passthrough(provider_key):
    assert select_upstream(provider_key, LlmDeploymentKind.CUSTOM) == "passthrough"


@pytest.mark.parametrize("provider_key", _DIRECT_PASSTHROUGH_PROVIDERS)
def test_direct_openai_shaped_providers_are_passthrough(provider_key):
    assert select_upstream(provider_key, LlmDeploymentKind.DIRECT) == "passthrough"


@pytest.mark.parametrize("provider_key", _DIRECT_TRANSLATED_PROVIDERS)
def test_direct_non_openai_shaped_providers_are_translated(provider_key):
    assert select_upstream(provider_key, LlmDeploymentKind.DIRECT) == "translated"


@pytest.mark.parametrize("deployment", list(LlmDeploymentKind))
def test_fake_provider_key_always_selects_fake(deployment):
    assert select_upstream("fake", deployment) == "fake"


def test_select_upstream_imports_nothing_beyond_llm_deployment_kind():
    """Pure — no DAO, no vault, no I/O (specs-wp7.md's own contract)."""
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


class _StubAdapter(LlmUpstreamInterface):
    async def relay_chat_completion(self, **kwargs) -> LlmRelayResult:  # noqa: ARG002
        raise NotImplementedError


def test_registry_get_raises_on_a_miss():
    registry = LlmUpstreamRegistry(adapters={})
    with pytest.raises(LlmAdapterNotFoundError):
        registry.get("passthrough")


def test_registry_get_and_keys_roundtrip():
    adapter = _StubAdapter()
    registry = LlmUpstreamRegistry(adapters={"passthrough": adapter})
    assert registry.get("passthrough") is adapter
    assert registry.keys() == ["passthrough"]


# --- Phase 8 acceptance: the scripted, no-provider-keys-needed check --------- #


def test_every_catalogued_direct_provider_maps_to_the_documented_adapter_key():
    """`tasks-wp7.md` Phase 8: 'confirm every DIRECT provider in supported_llm_models
    maps to the documented adapter key via select_upstream (a scripted check, not a
    real call — CI has no provider keys).' Runs here, with nothing deployed, because it
    needs no compose stack — only the two sets this module already declares.

    A subset check, not equality: `_DIRECT_PASSTHROUGH_PROVIDERS` also names `mistralai`,
    which is in the classification table but has no `supported_llm_models` entry (only
    `mistral` does) — a `BUILTIN` target can never resolve to it (`catalog.py` returns
    `None`), so it is reachable only via a `CUSTOM` row naming that `provider_key`, which
    always resolves to `"passthrough"` regardless of this table (registry.py's own CUSTOM
    branch). Nothing here needs it to appear in the catalogue."""
    documented = _DIRECT_PASSTHROUGH_PROVIDERS_SET | _DIRECT_TRANSLATED_PROVIDERS_SET
    assert set(supported_llm_models.keys()) <= documented, (
        "supported_llm_models has a provider absent from registry.py's classification table"
    )

    for provider_key in supported_llm_models:
        expected = (
            "passthrough"
            if provider_key in _DIRECT_PASSTHROUGH_PROVIDERS_SET
            else "translated"
        )
        assert select_upstream(provider_key, LlmDeploymentKind.DIRECT) == expected
