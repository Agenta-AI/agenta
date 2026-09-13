"""`AGENTA_GATEWAYS_MOCKS_ENABLED` gates the mock upstreams, not just the catalogue.

Two halves, because either alone leaves a mock reachable: the wiring registers no mock
adapter when the flag is off, so a row already persisted with a mock deployment kind has
nothing to dispatch to; and the create request refuses that deployment kind outright, so no
new row can be written.

The registration half reads `api/entrypoints/routers.py` as source rather than importing
it: importing the module builds every DAO, engine and router in the process.
"""

import ast
from pathlib import Path

import pytest
from fastapi import HTTPException

from oss.src.apis.fastapi.gateways.llms.models import LLMEndpointCreateRequest
from oss.src.core.gateways.llms.dtos import LLMDeploymentKind, LLMEndpointCreate
from oss.src.utils.env import env


ROUTERS_PATH = Path(__file__).resolve().parents[5] / "entrypoints" / "routers.py"

MOCK_ADAPTER_KEYS = {"mock", "mock_http"}


def _registry_adapter_dicts(registry_name: str) -> list:
    """The `adapters=` dict literals passed to one upstream registry in the wiring."""
    tree = ast.parse(
        ROUTERS_PATH.read_text(encoding="utf-8"), filename=str(ROUTERS_PATH)
    )

    dicts = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if getattr(node.func, "id", None) != registry_name:
            continue
        for keyword in node.keywords:
            if keyword.arg == "adapters" and isinstance(keyword.value, ast.Dict):
                dicts.append(keyword.value)
    return dicts


def _unconditional_keys(adapters: ast.Dict) -> set:
    """Adapter keys written as plain entries, i.e. registered whatever the flag says."""
    return {
        key.value
        for key in adapters.keys
        if isinstance(key, ast.Constant) and isinstance(key.value, str)
    }


def _flag_guarded_keys(adapters: ast.Dict) -> set:
    """Adapter keys spread in from a `{...} if env.mock_gateways.enabled else {}`."""
    guarded: set = set()
    for key, value in zip(adapters.keys, adapters.values):
        if key is not None or not isinstance(value, ast.IfExp):
            continue
        if "mock_gateways.enabled" not in ast.unparse(value.test):
            continue
        if not isinstance(value.body, ast.Dict):
            continue
        guarded |= _unconditional_keys(value.body)
    return guarded


@pytest.mark.parametrize(
    ("registry_name", "expected"),
    [("LLMUpstreamRegistry", {"mock"}), ("MCPUpstreamRegistry", MOCK_ADAPTER_KEYS)],
)
def test_mock_adapters_are_registered_only_under_the_mocks_flag(
    registry_name, expected
):
    adapter_dicts = _registry_adapter_dicts(registry_name)
    assert adapter_dicts, f"no adapters= dict found for {registry_name}"

    for adapters in adapter_dicts:
        assert not (_unconditional_keys(adapters) & MOCK_ADAPTER_KEYS), (
            f"{registry_name} registers a mock adapter unconditionally; dispatch reads a "
            "stored deployment kind and never consults the flag"
        )
        assert _flag_guarded_keys(adapters) == expected


def _create_request(kind: LLMDeploymentKind) -> LLMEndpointCreateRequest:
    return LLMEndpointCreateRequest(
        endpoint=LLMEndpointCreate(
            slug="an-endpoint",
            name="An endpoint",
            deployment_kind=kind,
        )
    )


def test_creating_a_mock_endpoint_is_refused_when_mocks_are_off(monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", False)

    with pytest.raises(HTTPException) as raised:
        _create_request(LLMDeploymentKind.MOCK)

    assert raised.value.status_code == 403
    assert raised.value.detail["code"] == "gateway_mocks_disabled"
    assert raised.value.detail["details"]["flag"] == "AGENTA_GATEWAYS_MOCKS_ENABLED"


def test_creating_a_mock_endpoint_is_allowed_when_mocks_are_on(monkeypatch):
    monkeypatch.setattr(env.mock_gateways, "enabled", True)

    request = _create_request(LLMDeploymentKind.MOCK)

    assert request.endpoint.deployment_kind == LLMDeploymentKind.MOCK


@pytest.mark.parametrize("enabled", [False, True])
def test_a_real_deployment_kind_is_never_refused(monkeypatch, enabled):
    monkeypatch.setattr(env.mock_gateways, "enabled", enabled)

    request = _create_request(LLMDeploymentKind.CUSTOM)

    assert request.endpoint.deployment_kind == LLMDeploymentKind.CUSTOM
