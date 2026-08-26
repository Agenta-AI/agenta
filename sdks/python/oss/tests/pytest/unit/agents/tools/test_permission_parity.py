"""Cross-language permission-decision parity.

Two implementations resolve effective permissions and must never drift:
 - TS (enforcement truth): ``effectivePermission`` / ``decide`` in
   ``services/runner/src/permission-plan.ts``.
 - Python (feeds the Claude settings renderer): ``effective_permission`` here.

Both sides assert the SAME shared fixture via the ``golden`` fixture (see
``conftest.py``): ``golden/permission_decisions.json``. The TS side asserts it in
``services/runner/tests/unit/permission-parity.test.ts``. Only cases marked
``"python": true`` are checked here: the Python helper only ever sees a tool's spec
permission, its read-only hint, and the plan's default mode -- it has no notion of
match rules, server permissions, or stored (human) decisions, so cases exercising those
are TS-only and are skipped here by design, not by fixture bug.

If a case disagrees between the two languages, that is a real behavioral drift --
do not bend the fixture to make it pass.
"""

from __future__ import annotations

import json

import pytest

from agenta.sdk.agents.tools.models import (
    CompiledTool,
    ResolvedGatewayIntegration,
    ResolvedGatewayPolicy,
    effective_permission,
)
from agenta.sdk.agents.wire_models import WireRunRequest


def test_fixture_has_at_least_36_cases(golden):
    fixture = golden("permission_decisions.json")
    assert len(fixture["cases"]) >= 36


def _python_cases(golden):
    fixture = golden("permission_decisions.json")
    return [case for case in fixture["cases"] if case["python"]]


@pytest.fixture
def python_cases(golden):
    return _python_cases(golden)


def test_python_eligible_cases_present(python_cases):
    # Sanity: the fixture must actually carry Python-eligible cases, or this test file
    # is silently a no-op.
    assert len(python_cases) > 0


def test_effective_permission_matches_fixture(golden):
    fixture = golden("permission_decisions.json")
    for case in fixture["cases"]:
        if not case["python"]:
            continue
        gate = case["gate"]
        plan = case["plan"]
        got = effective_permission(
            gate.get("specPermission"),
            gate.get("readOnlyHint"),
            plan["default"],
        )
        assert got == case["expected"]["effective"], (
            f"case {case['name']!r}: effective_permission("
            f"spec_permission={gate.get('specPermission')!r}, "
            f"read_only={gate.get('readOnlyHint')!r}, mode={plan['default']!r}) "
            f"== {got!r}, expected {case['expected']['effective']!r}"
        )


# --------------------------------------------------------------------------- C27
#
# The second cross-language shape, added by the gateway connection rework: the compiled
# ``gatewayPolicy`` object. The TS half is a COMPILE-TIME assertion in
# ``services/runner/tests/unit/wire-contract.test.ts`` (a value of type
# ``AgentRunRequest["gatewayPolicy"]`` carrying the same three tools), because ``protocol.ts``
# is types only and erases at runtime. This is the Python half.


def test_gateway_policy_round_trips_with_a_null_read_only(golden):
    """``readOnly`` is tri-state and unknown must survive the wire in BOTH directions.

    The catalog hint is absent for some provider tools, and absent is not the same as a write
    to a reader. A dropped key and a null value must therefore not come to mean different
    things: the producer emits the null, and the consumer model parses it back as ``None``.

    The expectation is the shared golden, the same file the TypeScript side asserts, so this
    file states the contract in one place rather than carrying its own copy of the table.
    """
    expected = golden("run_request.gateway_connection.json")["gatewayPolicy"]
    policy = ResolvedGatewayPolicy(
        integrations={
            "github": ResolvedGatewayIntegration(
                provider="composio",
                connection="github-work",
                tools={
                    "GET_ISSUE": CompiledTool(permission="allow", read_only=True),
                    "CREATE_ISSUE": CompiledTool(permission="ask", read_only=False),
                    "RUN_WORKFLOW": CompiledTool(permission="deny"),
                },
            )
        }
    )

    wire = policy.to_wire()
    assert wire == expected
    # Through real JSON, not only the in-memory dict: this is where a dropped null would show.
    assert json.loads(json.dumps(wire)) == expected

    parsed = WireRunRequest.model_validate({"gatewayPolicy": wire})
    tools = parsed.gateway_policy.integrations["github"].tools
    assert tools["RUN_WORKFLOW"].read_only is None
    assert tools["GET_ISSUE"].read_only is True
    assert tools["CREATE_ISSUE"].read_only is False


def test_gateway_policy_never_carries_inherit():
    """``inherit`` is an authoring value the compiler applies; it never crosses this boundary."""
    with pytest.raises(ValueError):
        WireRunRequest.model_validate(
            {
                "gatewayPolicy": {
                    "integrations": {
                        "github": {
                            "provider": "composio",
                            "connection": "github-work",
                            "tools": {
                                "GET_ISSUE": {
                                    "permission": "inherit",
                                    "readOnly": True,
                                }
                            },
                        }
                    }
                }
            }
        )
