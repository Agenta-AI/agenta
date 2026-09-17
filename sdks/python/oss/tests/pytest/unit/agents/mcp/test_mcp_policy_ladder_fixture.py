"""The per-tool permission ladder, read from the fixture every reader of it shares.

Three codebases resolve this ladder and each was tested only against its own restatement of
it, which is how D88 shipped green in all three: the SDK read the whole-server ``permission``
as the floor for a tool a per-tool table does not name, the runner did not, and no test
compared them.

``services/runner/tests/fixtures/mcp-policy-ladder.json`` states it once. This suite asserts
the SDK's half: the floor ``resolved_new_tool_permission`` returns, and the ``policy`` object
``to_wire`` emits. That wire object is the runner's input, and
``services/runner/tests/unit/mcp-permission-intake.test.ts`` resolves the same cases from it,
so the two halves chain rather than merely resembling one another.

Skipped, not failed, when the fixture cannot be found: an SDK-only distribution ships no
``services/`` tree.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

import pytest

from agenta.sdk.agents.mcp.models import MCPPolicy, ResolvedMCPServer

_FIXTURE = "services/runner/tests/fixtures/mcp-policy-ladder.json"


def _repo_root() -> "Path | None":
    for parent in Path(__file__).resolve().parents:
        if (parent / ".git").exists() and (parent / "services").is_dir():
            return parent
    return None


def _ladder() -> Dict[str, Any]:
    root = _repo_root()
    if root is None:
        pytest.skip(
            "monorepo root not found; the shared ladder fixture ships with services/"
        )
    path = root / _FIXTURE
    if not path.exists():
        pytest.skip(f"{_FIXTURE} is not in this checkout")
    return json.loads(path.read_text())


def _cases() -> List[Dict[str, Any]]:
    root = _repo_root()
    if root is None or not (root / _FIXTURE).exists():
        return []
    return json.loads((root / _FIXTURE).read_text())["cases"]


def test_the_fixture_has_the_cases_the_ladder_is_defined_by():
    assert len(_ladder()["cases"]) >= 7, "the fixture lost cases"


@pytest.mark.parametrize(
    "ladder_case",
    _cases() or [pytest.param(None, marks=pytest.mark.skip(reason="fixture absent"))],
    ids=lambda case: case["name"] if case else "absent-fixture",
)
def test_the_sdk_reads_the_shared_ladder(ladder_case):
    policy = MCPPolicy(**ladder_case["policy"])
    expected = ladder_case["expected"]

    assert policy.resolved_new_tool_permission() == expected["newToolPermission"]

    # The whole `policy` object as it goes on the wire, compared as a whole rather than field by
    # field: an extra field the runner would read is as much a divergence as a missing one.
    server = ResolvedMCPServer(
        name="acme",
        url="https://mcp.acme.io/mcp",
        policy=policy,
    )
    assert server.to_wire()["policy"] == ladder_case["wire"]

    # The table's own entries are what the runner resolves a named tool from, so they have to
    # arrive verbatim under the name the SERVER advertises.
    named = expected["namedTool"]
    if named is not None:
        assert policy.tool_permissions[named["tool"]] == named["permission"]
