"""Hardcoded MVP agent config, read from ``services/agent/config``.

The config (AGENTS.md text, model, tools) lives in editable files so changing the
agent does not need a code change. Paths can be overridden with env vars for Docker
or alternate layouts.
"""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import List, Optional

# services/oss/src/agent_pi/config.py -> parents[3] == services/
_SERVICES_DIR = Path(__file__).resolve().parents[3]
_DEFAULT_AGENT_DIR = _SERVICES_DIR / "agent"

# Fallback config used when the editable files are missing or a field is absent.
# Kept in sync with the catalog template and the `/inspect` schema defaults
# (schemas.py: _DEFAULT_MODEL / _DEFAULT_AGENTS_MD).
DEFAULT_MODEL = "gpt-5.5"
DEFAULT_AGENTS_MD = (
    "You are a friendly hello-world agent running on the Agenta agent service.\n\n"
    "- Greet the user warmly.\n"
    "- Answer the user's message in one or two short sentences."
)


@dataclass
class AgentConfig:
    agents_md: str
    model: Optional[str] = None
    tools: List[str] = field(default_factory=list)


def wrapper_dir() -> Path:
    """Directory of the TypeScript Pi wrapper (where the command runs)."""
    override = os.getenv("AGENTA_AGENT_WRAPPER_DIR")
    return Path(override) if override else _DEFAULT_AGENT_DIR


def config_dir() -> Path:
    """Directory holding AGENTS.md and agent.json."""
    override = os.getenv("AGENTA_AGENT_CONFIG_DIR")
    return Path(override) if override else (_DEFAULT_AGENT_DIR / "config")


def load_config() -> AgentConfig:
    base = config_dir()

    # Read the editable AGENTS.md when present; otherwise fall back to the default
    # instructions so a fresh checkout (or Docker layout) still runs.
    agents_md = DEFAULT_AGENTS_MD
    agents_path = base / "AGENTS.md"
    if agents_path.exists():
        text = agents_path.read_text(encoding="utf-8").strip()
        if text:
            agents_md = text

    model: str = DEFAULT_MODEL
    tools: List[str] = []
    meta_path = base / "agent.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        model = meta.get("model") or DEFAULT_MODEL
        tools = meta.get("tools", []) or []

    return AgentConfig(agents_md=agents_md, model=model, tools=tools)
