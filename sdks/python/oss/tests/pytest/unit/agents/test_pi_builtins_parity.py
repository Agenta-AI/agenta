"""Cross-language parity for Pi's default active built-in set.

Two implementations name the same four tools and must never drift:
 - Python: ``PI_DEFAULT_ACTIVE_BUILTINS`` in ``agenta/sdk/agents/pi_builtins.py``, which the
   shipped default agent template builds its ``tools`` entries from.
 - TypeScript: ``PI_DEFAULT_ACTIVE_BUILTINS`` in
   ``services/runner/src/engines/sandbox_agent/run-plan.ts``, which the runner falls back to
   when the ``/run`` request omits ``tools``.

Neither language owns the list. Both assert the SAME shared fixture
(``golden/pi_default_active_builtins.json``, loaded through the ``golden`` fixture in
``conftest.py``); the TypeScript half lives in the runner's unit tests. If the two disagree,
that is a real drift -- fix the side that moved, do not bend the fixture.
"""

from __future__ import annotations

from agenta.sdk.agents.pi_builtins import PI_DEFAULT_ACTIVE_BUILTINS


def test_python_constant_matches_the_shared_golden(golden):
    fixture = golden("pi_default_active_builtins.json")
    assert list(PI_DEFAULT_ACTIVE_BUILTINS) == fixture["names"]
