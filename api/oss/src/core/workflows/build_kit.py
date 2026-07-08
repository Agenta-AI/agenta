"""Playground build-kit content served through the static workflow catalogue."""

from typing import Any, Dict, List, Optional

from agenta.sdk.agents.adapters.agenta_builtins import (
    AGENTA_FORCED_TOOLS,
    BUILD_AN_AGENT_SKILL,
    BUILD_AN_AGENT_SLUG,
)
from agenta.sdk.agents.platform.workflow import (
    REQUEST_CONNECTION_WORKFLOW_SLUG,
)

BUILD_KIT_WORKFLOW_SLUG = "__ag__build_kit"
BUILD_KIT_WORKFLOW_NAME = "Playground build kit"
BUILD_KIT_WORKFLOW_DESCRIPTION = (
    "Playground-only agent build kit for authoring agents. It is retrievable as a "
    "static workflow but cannot be embedded or committed into another workflow."
)
AGENTA_BUILTIN_AGENT_URI = "agenta:builtin:agent:v0"

REQUEST_CONNECTION_WORKFLOW_NAME = "Request connection"
REQUEST_INPUT_WORKFLOW_SLUG = "__ag__request_input"
REQUEST_INPUT_WORKFLOW_NAME = "Request input"

# Cut ops stay catalog opt-ins.
DEFAULT_BUILD_KIT_OPS: tuple[str, ...] = (
    "discover_tools",
    "commit_revision",
    "annotate_trace",
    "query_spans",
    "test_run",
    "discover_triggers",
    "create_schedule",
    "create_subscription",
    "list_schedules",
    "list_deliveries",
    "test_subscription",
    "remove_schedule",
    "remove_subscription",
)

# (slug, name) pairs — reserved static client tools embedded in every build kit, in order.
_STATIC_TOOL_EMBEDS: tuple[tuple[str, str], ...] = (
    (REQUEST_CONNECTION_WORKFLOW_SLUG, REQUEST_CONNECTION_WORKFLOW_NAME),
    (REQUEST_INPUT_WORKFLOW_SLUG, REQUEST_INPUT_WORKFLOW_NAME),
)


def _workflow_embed(
    slug: str,
    *,
    name: Optional[str],
    selector_path: str,
) -> Dict[str, Any]:
    # The selector is load-bearing: without it the embed resolves to the whole revision.data.
    embed: Dict[str, Any] = {
        "@ag.embed": {
            "@ag.references": {"workflow": {"slug": slug}},
            "@ag.selector": {"path": selector_path},
        }
    }
    if name:
        embed["name"] = name
    return embed


def _reserved_static_tool_embeds() -> List[Dict[str, Any]]:
    return [
        _workflow_embed(slug, name=name, selector_path="parameters.tool")
        for slug, name in _STATIC_TOOL_EMBEDS
    ]


def build_agent_template_overlay() -> Dict[str, Any]:
    """Build the playground-only agent-template overlay from platform-owned sources."""
    return {
        "tools": [
            *[{"type": "builtin", "name": name} for name in AGENTA_FORCED_TOOLS],
            *[{"type": "platform", "op": op_name} for op_name in DEFAULT_BUILD_KIT_OPS],
            *_reserved_static_tool_embeds(),
        ],
        "skills": [
            _workflow_embed(
                BUILD_AN_AGENT_SLUG,
                name=BUILD_AN_AGENT_SKILL.name,
                selector_path="parameters.skill",
            )
        ],
        "sandbox": {
            "permissions": {
                "write_files": "allow",
                "execute_code": "allow",
            }
        },
    }
