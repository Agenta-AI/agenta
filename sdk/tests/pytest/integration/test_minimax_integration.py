"""Integration tests for MiniMax provider support.

These tests verify that MiniMax models work correctly through the full
provider resolution pipeline, including secret parsing, model lookup,
and SecretsManager normalization.

Note: These tests do not require a running MiniMax API or valid API key.
They verify the integration plumbing rather than actual API calls.
"""

import importlib.util
import os
import sys
import types

import pytest

# -------------------------------------------------------------------
# Load modules directly to avoid complex agenta SDK init chain.
# Mock litellm to avoid env-specific openai compatibility issues.
# -------------------------------------------------------------------
_SDK_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_REPO_ROOT = os.path.abspath(os.path.join(_SDK_ROOT, ".."))
_API_ROOT = os.path.join(_REPO_ROOT, "api")

# Mock litellm before anything imports it
_mock_litellm = types.ModuleType("litellm")
_mock_cost_calculator = types.ModuleType("litellm.cost_calculator")
_mock_cost_calculator.cost_per_token = lambda **kw: None
_mock_litellm.cost_calculator = _mock_cost_calculator
sys.modules.setdefault("litellm", _mock_litellm)
sys.modules.setdefault("litellm.cost_calculator", _mock_cost_calculator)

# Register agenta SDK parent packages as real modules
for _pkg in ["agenta", "agenta.sdk", "agenta.sdk.utils", "agenta.sdk.utils.logging",
             "agenta.sdk.contexts", "agenta.sdk.contexts.routing",
             "agenta.sdk.contexts.running", "agenta.sdk.middlewares",
             "agenta.sdk.middlewares.running", "agenta.sdk.middlewares.running.vault"]:
    sys.modules.setdefault(_pkg, types.ModuleType(_pkg))

# Provide mock implementations for the modules secrets.py imports
_log_mod = sys.modules["agenta.sdk.utils.logging"]
if not hasattr(_log_mod, "get_module_logger"):
    _log_mod.get_module_logger = lambda name: types.SimpleNamespace(
        warning=lambda *a, **kw: None, info=lambda *a, **kw: None,
    )
_routing_mod = sys.modules["agenta.sdk.contexts.routing"]
if not hasattr(_routing_mod, "RoutingContext"):
    _routing_mod.RoutingContext = types.SimpleNamespace(get=lambda: None)
_running_mod = sys.modules["agenta.sdk.contexts.running"]
if not hasattr(_running_mod, "RunningContext"):
    _running_mod.RunningContext = types.SimpleNamespace(get=lambda: None)
_vault_mod = sys.modules["agenta.sdk.middlewares.running.vault"]
if not hasattr(_vault_mod, "get_secrets"):
    _vault_mod.get_secrets = lambda *a, **kw: ([], [], [])


def _load_module(name: str, filepath: str):
    spec = importlib.util.spec_from_file_location(name, filepath)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_assets = _load_module(
    "assets", os.path.join(_SDK_ROOT, "agenta", "sdk", "assets.py")
)
# Register so secrets.py can find it
sys.modules["agenta.sdk.assets"] = _assets

_secrets = _load_module(
    "secrets_manager", os.path.join(_SDK_ROOT, "agenta", "sdk", "managers", "secrets.py")
)
SecretsManager = _secrets.SecretsManager

_enums = _load_module(
    "enums", os.path.join(_API_ROOT, "oss", "src", "core", "secrets", "enums.py")
)


class TestMiniMaxSecretParsing:
    """Tests for MiniMax secret parsing through SecretsManager."""

    def test_standard_secret_roundtrip(self):
        raw = [
            {
                "kind": "provider_key",
                "data": {
                    "kind": "minimax",
                    "provider": {"key": "test-minimax-key-12345"},
                },
            }
        ]
        parsed = SecretsManager._parse_secrets(raw)
        assert len(parsed) == 1
        assert parsed[0]["kind"] == "provider_key"
        assert parsed[0]["data"]["kind"] == "minimax"
        assert parsed[0]["data"]["provider"]["key"] == "test-minimax-key-12345"

    def test_custom_provider_secret_roundtrip(self):
        raw = [
            {
                "kind": "custom_provider",
                "data": {
                    "kind": "minimax",
                    "provider_slug": "my-minimax",
                    "provider": {
                        "url": "https://api.minimax.io/v1",
                        "extras": {"api_key": "test-key"},
                    },
                    "model_keys": [
                        "my-minimax/minimax/MiniMax-M2.7",
                        "my-minimax/minimax/MiniMax-M2.5",
                    ],
                },
            }
        ]
        parsed = SecretsManager._parse_secrets(raw)
        assert len(parsed) == 1
        assert parsed[0]["kind"] == "custom_provider"
        provider = parsed[0]["data"]["provider"]
        assert provider["kind"] == "minimax"
        assert provider["extras"]["api_base"] == "https://api.minimax.io/v1"
        assert provider["extras"]["api_key"] == "test-key"

    def test_minimax_among_multiple_providers(self):
        """MiniMax should be correctly identified among multiple provider secrets."""
        raw = [
            {
                "kind": "provider_key",
                "data": {"kind": "openai", "provider": {"key": "openai-key"}},
            },
            {
                "kind": "provider_key",
                "data": {"kind": "minimax", "provider": {"key": "minimax-key"}},
            },
            {
                "kind": "provider_key",
                "data": {"kind": "anthropic", "provider": {"key": "anthro-key"}},
            },
        ]
        parsed = SecretsManager._parse_secrets(raw)
        assert len(parsed) == 3
        minimax_secrets = [s for s in parsed if s["data"]["kind"] == "minimax"]
        assert len(minimax_secrets) == 1
        assert minimax_secrets[0]["data"]["provider"]["key"] == "minimax-key"


class TestMiniMaxProviderNormalization:
    """Tests for MiniMax provider kind normalization."""

    def test_lowercase(self):
        assert SecretsManager._normalize_provider_kind("minimax") == "minimax"

    def test_mixed_case(self):
        assert SecretsManager._normalize_provider_kind("MiniMax") == "minimax"

    def test_uppercase(self):
        assert SecretsManager._normalize_provider_kind("MINIMAX") == "minimax"

    def test_with_space(self):
        assert SecretsManager._normalize_provider_kind("Mini Max") == "minimax"

    def test_with_hyphen(self):
        assert SecretsManager._normalize_provider_kind("Mini-Max") == "minimax"


class TestMiniMaxEnumConsistency:
    """Tests for MiniMax enum consistency across Standard and Custom provider kinds."""

    def test_enum_values_match(self):
        assert (
            _enums.StandardProviderKind.MINIMAX.value
            == _enums.CustomProviderKind.MINIMAX.value
            == "minimax"
        )

    def test_model_naming_consistency(self):
        for model in _assets.supported_llm_models["minimax"]:
            assert model.startswith("minimax/"), (
                f"Model {model} must use 'minimax/' prefix for LiteLLM routing"
            )
            model_name = model.split("/", 1)[1]
            assert model_name.startswith("MiniMax-"), (
                f"Model name {model_name} should start with 'MiniMax-'"
            )
