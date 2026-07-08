"""Load a captured QA transcript (``docs/design/agent-workflows/projects/qa/runs/*.json``)
into today's runtime shapes.

The transcripts are real ``/invoke`` request/response pairs the agent-workflows QA program
captured against a live deployment (see ``qa/matrix.md``). Each file is loaded at test time --
nothing here hand-copies a transcript's captured content, so adding a new file under
``qa/runs/`` (or editing an existing one) changes what a replay test exercises without a code
change.

The captured request shape is intentionally NOT bit-for-bit what :meth:`AgentTemplate.from_params`
parses today: the QA captures predate at least two wire-shape generations documented inline in
``qa/matrix.md`` (``harness_options.<harness>.*`` -> ``harness_kwargs.<harness>.*`` -> today's
nested ``harness.extras``; a flat ``agents_md``/``model`` -> today's nested
``instructions.agents_md`` / ``llm.model``). ``session_config_from_transcript`` below is the one
place that translation happens, so it stays visible and auditable rather than silently baked into
each test.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from agenta.sdk.agents import AgentTemplate, Message, SessionConfig

QA_RUNS_DIR = (
    Path(__file__).resolve().parents[7]
    / "docs"
    / "design"
    / "agent-workflows"
    / "projects"
    / "qa"
    / "runs"
)

# The QA captures predate the harness-value rename (``matrix.md``'s 2026-06-25 wire-contract
# note): the wire moved from ``pi``/``agenta``/``claude`` to today's ``HarnessType`` values
# ``pi_core``/``pi_agenta``/``claude``. A bare ``"pi"`` no longer parses (``HarnessType("pi")``
# raises), so this table is required, not cosmetic.
_HARNESS_RENAME = {"pi": "pi_core", "agenta": "pi_agenta", "claude": "claude"}


def load_transcript(name: str) -> Dict[str, Any]:
    """Load one captured ``qa/runs/<name>.json`` transcript verbatim."""
    path = QA_RUNS_DIR / name
    if not path.is_file():
        raise FileNotFoundError(
            f"QA transcript not found at {path} (looked relative to the loader module; "
            "confirm docs/design/agent-workflows/projects/qa/runs/ still holds it)"
        )
    return json.loads(path.read_text(encoding="utf-8"))


def transcript_messages(transcript: Dict[str, Any]) -> List[Message]:
    """The captured turn's conversation, as runtime :class:`Message` objects."""
    raw_messages = transcript["request"]["data"]["inputs"]["messages"]
    return [Message(role=m["role"], content=m["content"]) for m in raw_messages]


def session_config_from_transcript(transcript: Dict[str, Any]) -> SessionConfig:
    """Build today's :class:`SessionConfig` from a captured transcript's request half.

    Translates the QA capture's older field names to today's ``AgentTemplate`` shape (see the
    module docstring): ``harness_options.<harness>.append_system`` -> ``harness.extras``, and the
    flat ``agents_md``/``model`` -> the nested ``instructions``/``llm`` shape
    :meth:`AgentTemplate.from_params` reads. Builtin tool declarations
    (``{"type": "builtin", "name": ...}``) are unchanged across generations and pass straight
    through both to ``AgentTemplate.tools`` and to the resolved ``SessionConfig.builtin_names``
    (a real run would resolve the latter server-side from the former; a replay test supplies it
    directly, same as the sibling transport-roundtrip tests do).
    """
    agent = transcript["request"]["data"]["parameters"]["agent"]
    captured_harness = agent.get("harness", "pi")
    harness_kind = _HARNESS_RENAME.get(captured_harness, captured_harness)
    harness_options = agent.get("harness_options") or {}
    extras = dict(harness_options.get(captured_harness, {}))

    params = {
        "agent": {
            "instructions": {"agents_md": agent.get("agents_md")},
            "llm": {"model": agent.get("model")},
            "tools": agent.get("tools") or [],
            "harness": {"kind": harness_kind, "extras": extras},
        }
    }
    template = AgentTemplate.from_params(params)

    builtin_names = [
        tool["name"]
        for tool in agent.get("tools") or []
        if isinstance(tool, dict) and tool.get("type") == "builtin"
    ]

    return SessionConfig(agent=template, builtin_names=builtin_names)


def transcript_reply(transcript: Dict[str, Any]) -> str:
    """The captured assistant reply text (the QA program's own pass/fail signal)."""
    return transcript["reply"]
