"""Hardcoded MVP agent config, read from ``services/agent/config``.

The config (AGENTS.md text, model, tools) lives in editable files so changing the
agent does not need a code change. Paths can be overridden with env vars for Docker
or alternate layouts.
"""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Optional
from urllib.parse import urlsplit

# services/oss/src/agent/config.py -> parents[3] == services/
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
    # Provider-agnostic tool references (WP-7). Each entry is either a plain string
    # (a Pi built-in name, normalized to a ``builtin`` ref downstream) or a
    # discriminated dict (``{"type": "composio", ...}``). Resolution happens in the
    # backend at invoke time; the service just forwards the list.
    tools: List[Any] = field(default_factory=list)


def runner_dir() -> Path:
    """Directory of the TypeScript agent runner (where the CLI command runs)."""
    override = os.getenv("AGENTA_AGENT_RUNNER_DIR")
    return Path(override) if override else _DEFAULT_AGENT_DIR


def runner_url() -> Optional[str]:
    """HTTP URL for the deployed agent runner service, when configured."""
    value = os.getenv("AGENTA_AGENT_RUNNER_URL")
    return value.strip() if value and value.strip() else None


class UnsupportedRunnerUriError(Exception):
    """A caller-supplied sidecar ``uri`` is not on the server-side allowlist.

    Raised (rather than silently falling back to the env var) so a disallowed address fails
    loud: a silent fallback would let a caller probe the allowlist by difference and would mask
    a misconfiguration. The handler surfaces this as a 4xx."""

    def __init__(self, uri: str) -> None:
        self.uri = uri
        super().__init__(
            f"sidecar uri {uri!r} is not allowed; "
            "add its origin to AGENTA_AGENT_RUNNER_URI_ALLOWLIST"
        )


def runner_uri_allowlist() -> List[str]:
    """The allowlist of trusted sidecar origins (``scheme://host[:port]``), default empty.

    Read from ``AGENTA_AGENT_RUNNER_URI_ALLOWLIST`` (comma-separated). Empty (the default)
    means the feature is OFF: every caller-supplied ``uri`` is rejected and only the env-var /
    local-CLI path runs. An operator opts in by listing trusted sidecar origins."""
    raw = os.getenv("AGENTA_AGENT_RUNNER_URI_ALLOWLIST") or ""
    return [_origin(entry) for entry in raw.split(",") if entry.strip()]


def _origin(value: str) -> str:
    """The ``scheme://host[:port]`` origin of a URL, lower-cased scheme+host (port kept as-is).

    Matching is on origin, not substring, so ``http://evil.com/?x=http://trusted`` cannot
    smuggle a trusted substring past the check."""
    parts = urlsplit(value.strip())
    netloc = parts.netloc or parts.path  # tolerate a bare host with no scheme
    return f"{parts.scheme.lower()}://{netloc.lower()}"


def validate_runner_uri(uri: str) -> str:
    """Return ``uri`` when its origin is on the allowlist; raise otherwise.

    SSRF / secret-exfiltration gate: the service ships resolved provider keys and bearer tokens
    to whatever address it picks, so a caller-supplied address is honored only when an operator
    pre-approved its origin. Restricts the scheme to ``http``/``https`` (rejects ``file:`` etc.)
    and matches the parsed origin exactly against the allowlist."""
    parts = urlsplit(uri.strip())
    if parts.scheme.lower() not in ("http", "https") or not parts.netloc:
        raise UnsupportedRunnerUriError(uri)
    if _origin(uri) not in runner_uri_allowlist():
        raise UnsupportedRunnerUriError(uri)
    return uri.strip()


def resolve_runner_url(override: Optional[str]) -> Optional[str]:
    """Routing precedence: a validated request override, else the env var, else ``None``.

    ``override`` (the agent config's ``uri``) wins when set and allowlisted; a rejected override
    raises (``UnsupportedRunnerUriError``) rather than falling back. When ``override`` is unset
    this is exactly today's behavior: ``AGENTA_AGENT_RUNNER_URL`` if set, else ``None`` (the
    local runner CLI in ``AGENTA_AGENT_RUNNER_DIR``)."""
    if override:
        return validate_runner_uri(override)
    return runner_url()


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
