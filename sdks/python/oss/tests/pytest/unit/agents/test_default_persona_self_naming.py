"""The default persona asks for no naming, and its benchmark mirror.

The agent service names new sessions and agents beside the first turn
(`agenta.sdk.agents.naming`), so the persona must not ask the model to call a rename tool:
that tool call would delay the reply by one model call. The benchmark scenario
`name-05-default-persona-session` seeds exactly this persona. This test locks the two
together, so a change to the shipped default that forgets the benchmark mirror (or vice
versa) fails here instead of silently measuring a stale persona.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenta.sdk.utils.types import build_agent_v0_default

_SCENARIO_FILE = (
    Path(__file__).resolve().parents[7]
    / "docs"
    / "design"
    / "agent-config-editing"
    / "benchmark"
    / "scenarios"
    / "09-self-naming.json"
)


def _default_agents_md() -> str:
    return build_agent_v0_default()["instructions"]["agents_md"]


def test_default_persona_asks_for_no_naming():
    text = _default_agents_md()
    assert "rename_session" not in text
    assert "rename_agent" not in text


@pytest.mark.skipif(
    not _SCENARIO_FILE.exists(),
    reason="docs/design/agent-config-editing/benchmark/ not present in this checkout",
)
@pytest.mark.parametrize(
    "scenario_id",
    ["name-05-default-persona-session"],
)
def test_benchmark_default_persona_scenarios_seed_it_verbatim(scenario_id):
    doc = json.loads(_SCENARIO_FILE.read_text())
    scenario = next(s for s in doc["scenarios"] if s["id"] == scenario_id)
    assert scenario["seed"]["instructions"]["agents_md"] == _default_agents_md()
