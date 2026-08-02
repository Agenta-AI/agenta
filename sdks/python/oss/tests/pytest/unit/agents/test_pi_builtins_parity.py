"""Cross-language parity for the Pi built-in tool table.

Two implementations name the same seven tools and must never drift:
 - Python: ``PI_BUILTIN_TOOL_NAMES`` in ``agenta/sdk/agents/pi_builtins.py``, which the SDK
   sends on the wire for compatibility with older runners.
 - TypeScript: ``PI_BUILTIN_TOOL_IDENTITY`` in ``services/runner/src/permission-plan.ts``,
   which the runner activates on every Pi run and matches permission rules against.

Neither language owns the list. Both assert the SAME shared fixture
(``golden/pi_builtin_tools.json``, loaded through the ``golden`` fixture in ``conftest.py``);
the TypeScript half lives in the runner's unit tests and additionally asserts each entry's
canonical rule name and read-only flag. If the two disagree, that is a real drift -- fix the
side that moved, do not bend the fixture.
"""

from __future__ import annotations

from agenta.sdk.agents.pi_builtins import PI_BUILTIN_TOOL_NAMES


def test_python_constant_matches_the_shared_golden(golden):
    fixture = golden("pi_builtin_tools.json")
    assert list(PI_BUILTIN_TOOL_NAMES) == [b["name"] for b in fixture["builtins"]]
