"""The default persona's self-naming guidance, and its benchmark mirror.

Live QA (2026-08-10) showed the split this guards: agents with task-shaped personas
call `rename_session` unprompted, while the bare product-default persona answers and
stops — the tool description alone loses to "answer the question". The standing
guidance therefore rides `_DEFAULT_AGENTS_MD`, and the benchmark scenario
`name-05-default-persona-session` measures exactly that persona. This test locks the
two together: a change to the shipped default that forgets the benchmark mirror (or
vice versa) fails here instead of silently measuring a stale persona.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenta.sdk.utils.types import build_agent_v0_default

_SCENARIO_FILE = (
    Path(__file__).resolve().parents[7]
    / "benchmarks"
    / "agent-config-editing"
    / "scenarios"
    / "09-self-naming.json"
)


def _default_agents_md() -> str:
    return build_agent_v0_default()["instructions"]["agents_md"]


def test_default_persona_carries_the_self_naming_guidance():
    text = _default_agents_md()
    assert "`rename_session`" in text
    assert "`rename_agent`" in text
    # The guards against churn ride along with the guidance itself.
    assert "only when the topic genuinely shifts" in text
    assert "only when your own identity or purpose changes" in text


@pytest.mark.skipif(
    not _SCENARIO_FILE.exists(),
    reason="benchmarks/ not present in this checkout",
)
def test_benchmark_name_05_seeds_the_default_persona_verbatim():
    doc = json.loads(_SCENARIO_FILE.read_text())
    scenario = next(
        s for s in doc["scenarios"] if s["id"] == "name-05-default-persona-session"
    )
    assert scenario["seed"]["instructions"]["agents_md"] == _default_agents_md()
