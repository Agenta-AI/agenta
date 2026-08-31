"""Static on-file agent template, read from ``services/runner/config``.

The template (AGENTS.md text, model, tools) lives in editable files so changing the
agent does not need a code change. Paths can be overridden with env vars for Docker
or alternate layouts.
"""

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Optional

from agenta.sdk.agents.sandbox_providers import enabled_sandbox_providers
from agenta.sdk.utils.logging import get_module_logger

log = get_module_logger(__name__)

# services/oss/src/agent/config.py -> parents[3] == services/
_SERVICES_DIR = Path(__file__).resolve().parents[3]
_DEFAULT_AGENT_DIR = _SERVICES_DIR / "runner"

# Fallback config used when the editable files are missing or a field is absent.
# Kept in sync with the catalog template and the `/inspect` schema defaults
# (schemas.py: _DEFAULT_MODEL / _DEFAULT_AGENTS_MD). No tool entries: built-in tools are
# always active and are not configured here.
DEFAULT_MODEL = "gpt-5.6-luna"
DEFAULT_TOOLS: List[Any] = []
DEFAULT_AGENTS_MD = (
    "You are a friendly hello-world agent running on the Agenta agent service.\n\n"
    "- Greet the user warmly.\n"
    "- Answer the user's message in one or two short sentences.\n"
    "- Once the first exchange makes clear what the session is about, call the\n"
    "  `rename_session` tool: `name` is the session's subject in a few words, findable\n"
    "  in a list; `description` is a one-sentence recap of where things stand. Rename\n"
    "  again only when the topic genuinely shifts. If `rename_agent` is available,\n"
    "  read your current persisted name from its description. When that name is still\n"
    '  a raw creation request or a placeholder like "Untitled agent", also call\n'
    "  `rename_agent` in the same turn, with a name that says what you are for.\n"
    "- Never call `rename_agent` when the current persisted name already describes\n"
    "  your purpose. The tool is removed from later runs after its first success."
)


@dataclass
class AgentTemplate:
    agents_md: str
    model: Optional[str] = None
    # Provider-agnostic tool references (WP-7). Each entry is either a plain string
    # (a Pi built-in name, normalized to a ``builtin`` ref downstream) or a
    # discriminated dict (``{"type": "composio", ...}``). Resolution happens in the
    # backend at invoke time; the service just forwards the list.
    tools: List[Any] = field(default_factory=list)


def runner_dir() -> Path:
    """Directory of the TypeScript agent runner (where the CLI command runs)."""
    override = os.getenv("AGENTA_RUNNER_DIR")
    return Path(override) if override else _DEFAULT_AGENT_DIR


def runner_url() -> Optional[str]:
    """HTTP URL for the deployed agent runner (internal direct hop), when configured."""
    value = os.getenv("AGENTA_RUNNER_INTERNAL_URL")
    return value.strip() if value and value.strip() else None


def runner_token() -> Optional[str]:
    """Shared token for the deployed agent runner (the runner refuses to boot without it).

    The same value must be set on both sides; read per call so a runtime env change takes
    effect without a re-import.
    """
    value = os.getenv("AGENTA_RUNNER_TOKEN")
    return value.strip() if value and value.strip() else None


_SANDBOX_LOCAL_WARNED = False


def sandbox_provider_enabled(provider: str) -> bool:
    """Whether ``provider`` is enabled on this deployment.

    Reads the same `AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS` registry the agent runner and
    the SDK read, with the same parsing rules (shared helper in the SDK). `local` is
    unconfined host bash and not a tenant boundary, so a deployment that hardens for
    multi-tenant use drops it from the enabled set.
    """
    global _SANDBOX_LOCAL_WARNED
    enabled = enabled_sandbox_providers()
    if "local" in enabled and not _SANDBOX_LOCAL_WARNED:
        _SANDBOX_LOCAL_WARNED = True
        log.warning(
            "local sandbox is enabled (default): it is unconfined host bash, not a tenant "
            "boundary. Set AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS=daytona to harden a "
            "shared/multi-tenant deployment."
        )
    return provider.strip().lower() in enabled


def config_dir() -> Path:
    """Directory holding the static on-file agent template (AGENTS.md and agent.json)."""
    override = os.getenv("AGENTA_AGENT_TEMPLATE_DIR")
    return Path(override) if override else (_DEFAULT_AGENT_DIR / "config")


def load_config() -> AgentTemplate:
    base = config_dir()

    # Read the editable AGENTS.md when present; otherwise fall back to the default
    # instructions so a fresh checkout (or Docker layout) still runs.
    agents_md = DEFAULT_AGENTS_MD
    agents_path = base / "AGENTS.md"
    if agents_path.exists():
        text = agents_path.read_text(encoding="utf-8").strip()
        if text:
            agents_md = text
    else:
        log.warning(
            "agent: template not found at %s; falling back to the built-in hello-world "
            "AGENTS.md (set AGENTA_AGENT_TEMPLATE_DIR if this path is unexpected)",
            agents_path,
        )

    model: str = DEFAULT_MODEL
    tools: List[Any] = list(DEFAULT_TOOLS)
    meta_path = base / "agent.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        model = meta.get("model") or DEFAULT_MODEL
        # An operator adds gateway, client or platform entries here; built-in tools are always
        # active and are never listed.
        tools = list(meta.get("tools") or DEFAULT_TOOLS)
    else:
        log.warning(
            "agent: template not found at %s; falling back to the built-in default "
            "model %r with no tool entries (set AGENTA_AGENT_TEMPLATE_DIR if this "
            "path is unexpected)",
            meta_path,
            DEFAULT_MODEL,
        )

    return AgentTemplate(agents_md=agents_md, model=model, tools=tools)
