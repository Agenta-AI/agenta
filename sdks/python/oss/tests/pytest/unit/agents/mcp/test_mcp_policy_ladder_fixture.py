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

A missing fixture fails this suite. It used to skip, on the ground that an SDK-only
distribution ships no ``services/`` tree — but that distribution ships no tests either, so the
only reader that ever reached the skip was a monorepo checkout in which the file had moved, and
there the skip retired the cross-language guard without failing anything (D129). The refusal
names the path it resolved, because the reader of it is someone who moved the file.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

import pytest

from agenta.sdk.agents.mcp.models import MCPPolicy, ResolvedMCPServer

_FIXTURE = "services/runner/tests/fixtures/mcp-policy-ladder.json"


def _repo_root() -> Optional[Path]:
    for parent in Path(__file__).resolve().parents:
        if (parent / ".git").exists() and (parent / "services").is_dir():
            return parent
    return None


def _fixture_path() -> Path:
    """The shared ladder, or a failure naming the path this reader resolved."""
    root = _repo_root()
    if root is None:
        raise AssertionError(
            "The shared per-tool permission ladder fixture cannot be resolved: no parent of "
            f"{Path(__file__).resolve()} holds both a .git and a services/ directory, so "
            f"there is no root to join {_FIXTURE} to. This fixture is the only thing keeping "
            "the SDK, the runner and the editor on one rule (D88), so its absence fails."
        )

    path = root / _FIXTURE
    if not path.exists():
        raise AssertionError(
            f"The shared per-tool permission ladder fixture is not at {path}. It is the only "
            "thing keeping the SDK, the runner and the editor on one rule (D88), so its "
            "absence fails rather than skips (D129). Moving it means moving all three "
            "readers: this one, services/runner/tests/unit/mcp-permission-intake.test.ts and "
            "web/packages/agenta-entities/tests/unit/mcp-policy-ladder.test.ts."
        )

    return path


def _ladder() -> Dict[str, Any]:
    return json.loads(_fixture_path().read_text())


def _cases() -> List[Dict[str, Any]]:
    """Read at collection, so a missing fixture is an error on this module and not zero cases.

    Returning an empty list here parametrized the suite with nothing, which reported as a
    green run of a guard that did not exist.
    """
    return _ladder()["cases"]


def test_the_fixture_has_the_cases_the_ladder_is_defined_by():
    assert len(_ladder()["cases"]) >= 7, "the fixture lost cases"


@pytest.mark.parametrize(
    "ladder_case",
    _cases(),
    ids=lambda case: case["name"],
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


def _senders_that_mis_case_their_fields() -> List[Dict[str, Any]]:
    return [
        sender
        for sender in _ladder().get("sendersThatMisCaseTheirFields", [])
        if "sdk" in sender["foreignTo"]
    ]


def _decision(policy: MCPPolicy, tool: str):
    """The ladder for one advertised tool, as this model states it.

    Its own entry, then the floor the model resolves, then the whole-server permission, which
    governs only while nobody opted into a table.
    """
    if tool in policy.tool_permissions:
        return policy.tool_permissions[tool]
    floor = policy.resolved_new_tool_permission()
    return floor if floor is not None else policy.permission


@pytest.mark.parametrize(
    "sender",
    _senders_that_mis_case_their_fields(),
    ids=lambda sender: sender["name"],
)
def test_a_policy_in_the_other_convention_never_resolves_to_allow(sender):
    """Issue 6917, this model's side of it.

    This model names its fields ``tool_permissions`` and ``new_tool_permission``; the wire
    names them ``toolPermissions`` and ``newToolPermission``. A policy in the wire convention
    reaching this model carries a per-tool table it cannot see, and what is left reads as a
    legitimate "server allow, no table" policy, so every tool the table denied would run
    unapproved.

    The expectation is the invariant rather than a value, because two different fixes keep it:
    refusing the shape, which is what ``extra="forbid"`` does here, or reading both
    conventions.
    """
    try:
        policy = MCPPolicy(**(sender.get("policy") or sender.get("wire")))
    except Exception:
        # Refusing the shape is one of the two ways to keep the invariant.
        return

    for tool in sender["expected"]["tools"]:
        assert _decision(policy, tool) != sender["expected"]["mustNotResolveTo"], (
            f"{tool} resolved to {sender['expected']['mustNotResolveTo']} from a policy whose "
            "per-tool table this reader could not see"
        )
