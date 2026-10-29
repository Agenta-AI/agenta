"""The API's gateway suites must not report green against a stack that serves no gateway.

The services side was closed first (D77). The API side went on skipping, so a plane-off
preview ran the API's gateway acceptance layer, covered nothing, and said it passed (D93).

The two gates are separate copies, because `api` and `services` are separate packages with
separate environments and neither installs the other. The last case here compares them, so a
change made to one and not the other fails rather than drifting.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

from oss.tests.pytest.acceptance.gateways import conftest as api_gate


_EXPECT = "AGENTA_TESTS_EXPECT_LLM_GATEWAY"
_SERVICES_GATE = (
    Path(__file__).resolve().parents[6]
    / "services"
    / "oss"
    / "tests"
    / "pytest"
    / "utils"
    / "gateways.py"
)


def test_a_serving_deployment_is_let_through(monkeypatch):
    monkeypatch.delenv(_EXPECT, raising=False)

    api_gate.require_llm_gateway(True)


def test_a_deployment_that_should_serve_and_does_not_fails_the_run(monkeypatch):
    """The defect. Nothing was said about the plane, so the suite is owed a gateway."""
    monkeypatch.delenv(_EXPECT, raising=False)

    # `Failed` and `Skipped` derive from BaseException, not Exception.
    with pytest.raises(BaseException) as raised:
        api_gate.require_llm_gateway(False)

    assert raised.typename == "Failed", "the run was skipped rather than failed"
    assert "AGENTA_LLM_GATEWAY_ENABLED=true" in str(raised.value)
    assert _EXPECT in str(raised.value)


@pytest.mark.parametrize("said", ["false", "0", "no", "off", "False", " off "])
def test_a_run_that_expected_no_gateway_still_skips(monkeypatch, said):
    """The product ships the plane off, so pointing a run at such a stack on purpose stays
    possible. It just has to be said."""
    monkeypatch.setenv(_EXPECT, said)

    with pytest.raises(BaseException) as raised:
        api_gate.require_llm_gateway(False)

    assert raised.typename == "Skipped"


@pytest.mark.parametrize("said", ["", "true", "1", "yes", "anything else"])
def test_anything_short_of_saying_so_is_not_saying_so(monkeypatch, said):
    monkeypatch.setenv(_EXPECT, said)

    with pytest.raises(BaseException) as raised:
        api_gate.require_llm_gateway(False)

    assert raised.typename == "Failed"


def test_the_mirror_fails_when_the_run_expected_a_plane_off_stack(monkeypatch):
    """The same mismatch in the other direction: the run said the plane would be off, the
    deployment has it on, and the pre-gateway suites would cover nothing."""
    monkeypatch.setenv(_EXPECT, "off")

    with pytest.raises(BaseException) as raised:
        api_gate.requires_llm_gateway_off.__wrapped__(True)

    assert raised.typename == "Failed"


def test_the_mirror_still_skips_when_nothing_was_said(monkeypatch):
    """Only one of the two families can run against one stack, so this skip is correct."""
    monkeypatch.delenv(_EXPECT, raising=False)

    with pytest.raises(BaseException) as raised:
        api_gate.requires_llm_gateway_off.__wrapped__(True)

    assert raised.typename == "Skipped"


def test_the_mirror_runs_against_a_plane_off_stack(monkeypatch):
    monkeypatch.setenv(_EXPECT, "off")

    api_gate.requires_llm_gateway_off.__wrapped__(False)


def _services_gate():
    if not _SERVICES_GATE.exists():  # pragma: no cover - the tree is always beside api/
        pytest.skip(f"the services gate is not at {_SERVICES_GATE}")
    spec = importlib.util.spec_from_file_location("_services_gateways", _SERVICES_GATE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    "said", ["", "false", "0", "no", "off", "False", " off ", "true", "1", "yes", "x"]
)
def test_both_gates_read_the_variable_the_same_way(monkeypatch, said):
    """Two copies, one meaning. Separate packages cannot share a module and a test-harness
    switch does not belong in the SDK, which is the only thing both of them import."""
    services_gate = _services_gate()
    monkeypatch.setenv(_EXPECT, said)

    assert api_gate.llm_gateway_expected() is services_gate._llm_gateway_expected()


def test_both_gates_name_the_same_variable():
    services_gate = _services_gate()

    assert api_gate._EXPECT_ENV_VAR == services_gate._EXPECT_ENV_VAR
    assert api_gate._FALSY == services_gate._FALSY
