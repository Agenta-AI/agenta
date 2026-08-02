"""The Pi built-in tools Agenta always activates.

``PI_BUILTIN_TOOL_NAMES`` is the set the runner turns on for every Pi run, not Pi's own
default set (Pi alone activates only four of them). Built-in tools are never configured in an
agent's ``tools`` list; whether a call runs, asks or is refused comes from
``runner.permissions.default`` and the ``harness.permissions`` rule lists.

The TypeScript counterpart is ``PI_BUILTIN_TOOL_IDENTITY`` in
``services/runner/src/permission-plan.ts``, which also carries each tool's canonical rule name
and read-only flag. Neither language owns the list: both are pinned against the shared golden
fixture ``sdks/python/oss/tests/pytest/unit/agents/golden/pi_builtin_tools.json``.
"""

from __future__ import annotations

from typing import Tuple

PI_BUILTIN_TOOL_NAMES: Tuple[str, ...] = (
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
)
