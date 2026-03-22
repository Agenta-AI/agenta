"""Unit tests for MiniMax provider integration.

These tests verify that MiniMax is correctly registered as a first-class
LLM provider across the backend enums and SDK model registry.
"""

import importlib.util
import os
import sys
import types

import pytest

# -------------------------------------------------------------------
# Load modules directly to avoid complex agenta SDK init chain.
# Mock litellm to avoid broken openai._models dependency in CI.
# -------------------------------------------------------------------
_SDK_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
_REPO_ROOT = os.path.abspath(os.path.join(_SDK_ROOT, ".."))
_API_ROOT = os.path.join(_REPO_ROOT, "api")

# Mock litellm.cost_calculator so assets.py can be loaded without litellm
_mock_litellm = types.ModuleType("litellm")
_mock_cost_calculator = types.ModuleType("litellm.cost_calculator")
_mock_cost_calculator.cost_per_token = lambda **kw: None
_mock_litellm.cost_calculator = _mock_cost_calculator
sys.modules.setdefault("litellm", _mock_litellm)
sys.modules.setdefault("litellm.cost_calculator", _mock_cost_calculator)


def _load_module(name: str, filepath: str):
    spec = importlib.util.spec_from_file_location(name, filepath)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_assets = _load_module(
    "assets", os.path.join(_SDK_ROOT, "agenta", "sdk", "assets.py")
)
supported_llm_models = _assets.supported_llm_models
model_to_provider_mapping = _assets.model_to_provider_mapping
providers_list = _assets.providers_list

_enums = _load_module(
    "enums", os.path.join(_API_ROOT, "oss", "src", "core", "secrets", "enums.py")
)
StandardProviderKind = _enums.StandardProviderKind
CustomProviderKind = _enums.CustomProviderKind


class TestMiniMaxModels:
    """Tests for MiniMax model registration in supported_llm_models."""

    def test_minimax_provider_exists(self):
        assert "minimax" in supported_llm_models

    def test_minimax_models_not_empty(self):
        assert len(supported_llm_models["minimax"]) > 0

    def test_minimax_m27_model_registered(self):
        assert "minimax/MiniMax-M2.7" in supported_llm_models["minimax"]

    def test_minimax_m27_highspeed_model_registered(self):
        assert "minimax/MiniMax-M2.7-highspeed" in supported_llm_models["minimax"]

    def test_minimax_m25_model_registered(self):
        assert "minimax/MiniMax-M2.5" in supported_llm_models["minimax"]

    def test_minimax_m25_lightning_model_registered(self):
        assert "minimax/MiniMax-M2.5-lightning" in supported_llm_models["minimax"]

    def test_minimax_models_use_provider_prefix(self):
        for model in supported_llm_models["minimax"]:
            assert model.startswith("minimax/"), (
                f"Model {model} should use 'minimax/' prefix"
            )


class TestMiniMaxModelProviderMapping:
    """Tests for MiniMax model-to-provider mapping."""

    def test_minimax_m27_maps_to_minimax_provider(self):
        assert model_to_provider_mapping.get("minimax/MiniMax-M2.7") == "minimax"

    def test_minimax_m27_highspeed_maps_to_minimax_provider(self):
        assert (
            model_to_provider_mapping.get("minimax/MiniMax-M2.7-highspeed")
            == "minimax"
        )

    def test_minimax_m25_maps_to_minimax_provider(self):
        assert model_to_provider_mapping.get("minimax/MiniMax-M2.5") == "minimax"

    def test_minimax_m25_lightning_maps_to_minimax_provider(self):
        assert (
            model_to_provider_mapping.get("minimax/MiniMax-M2.5-lightning") == "minimax"
        )

    def test_all_minimax_models_mapped(self):
        for model in supported_llm_models["minimax"]:
            assert model in model_to_provider_mapping, (
                f"Model {model} should be in model_to_provider_mapping"
            )
            assert model_to_provider_mapping[model] == "minimax"


class TestMiniMaxProvidersList:
    """Tests for MiniMax in providers_list."""

    def test_minimax_in_providers_list(self):
        assert "minimax" in providers_list


class TestMiniMaxProviderEnums:
    """Tests for MiniMax in provider kind enums."""

    def test_standard_provider_kind_has_minimax(self):
        assert hasattr(StandardProviderKind, "MINIMAX")
        assert StandardProviderKind.MINIMAX.value == "minimax"

    def test_custom_provider_kind_has_minimax(self):
        assert hasattr(CustomProviderKind, "MINIMAX")
        assert CustomProviderKind.MINIMAX.value == "minimax"

    def test_minimax_in_standard_provider_values(self):
        values = {p.value for p in StandardProviderKind}
        assert "minimax" in values

    def test_minimax_in_custom_provider_values(self):
        values = {p.value for p in CustomProviderKind}
        assert "minimax" in values
