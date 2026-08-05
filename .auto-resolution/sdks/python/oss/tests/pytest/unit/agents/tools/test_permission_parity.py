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

import pytest

from agenta.sdk.agents.tools.models import effective_permission


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
