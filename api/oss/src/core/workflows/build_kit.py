"""Playground build-kit content served through the static workflow catalogue."""

from typing import Any, Dict, List, Optional

from agenta.sdk.agents.adapters.agenta_builtins import (
    BUILD_AN_AGENT_SKILL,
    BUILD_AN_AGENT_SLUG,
)
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from agenta.sdk.agents.platform.workflow import (
    REQUEST_CONNECTION_WORKFLOW_SLUG,
    REQUEST_SECRET_WORKFLOW_SLUG,
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
REQUEST_SECRET_WORKFLOW_NAME = "Request secret"

# `read_config` is the read half of the read-then-edit loop, and without it a playground agent
# can commit but never read what it is editing. It exists in the catalog only when ordered
# operations are enabled, so membership is tested against the catalog itself rather than
# re-reading the flag: an op name the catalog does not define raises `UnknownPlatformOpError`
# for every build-kit resolution.
_READ_CONFIG_OPS: tuple[str, ...] = (
    ("read_config",) if "read_config" in PLATFORM_OPS else ()
)

_BUILD_KIT_OP_PERMISSIONS = {
    "discover_tools": "allow",
    # Registry discovery and the source-sync check are reads. The apply is a write, and its
    # approval card is the user prompt, so it asks.
    "search_skills": "allow",
    "check_skill_updates": "allow",
    "apply_skill_update": "ask",
    "read_config": "allow",
    "commit_revision": "allow",
    "test_run": "allow",
    "rename_session": "allow",
    "rename_agent": "allow",
    "discover_triggers": "allow",
    "create_schedule": "ask",
    "create_subscription": "ask",
    "list_schedules": "allow",
    "list_deliveries": "allow",
    "test_subscription": "allow",
    "list_subscriptions": "allow",
    "remove_schedule": "ask",
    "remove_subscription": "ask",
}

# Cut ops stay catalog opt-ins. `annotate_trace` and `query_spans` left the kit on 2026-09-07:
# no skill text told the model when to use them, and both are due for their own rework.
DEFAULT_BUILD_KIT_OPS: tuple[str, ...] = (
    "discover_tools",
    # Registry discovery: search + the self-config commit IS the agent-driven install.
    "search_skills",
    # Source sync: silent check; the apply is a write, so its approval card IS the user prompt.
    "check_skill_updates",
    "apply_skill_update",
    *_READ_CONFIG_OPS,
    "commit_revision",
    "test_run",
    "rename_session",
    "rename_agent",
    "discover_triggers",
    "create_schedule",
    "create_subscription",
    "list_schedules",
    "list_deliveries",
    "test_subscription",
    "list_subscriptions",
    "remove_schedule",
    "remove_subscription",
)

# (slug, name) pairs — reserved static client tools embedded in every build kit, in order.
# `request_secret` sits beside `request_connection` on purpose: both are the platform's way to
# collect a credential without the user pasting one into chat, and a playground agent that can ask
# for an integration connection must be able to ask for a custom secret the same way.
_STATIC_TOOL_EMBEDS: tuple[tuple[str, str], ...] = (
    (REQUEST_CONNECTION_WORKFLOW_SLUG, REQUEST_CONNECTION_WORKFLOW_NAME),
    (REQUEST_INPUT_WORKFLOW_SLUG, REQUEST_INPUT_WORKFLOW_NAME),
    (REQUEST_SECRET_WORKFLOW_SLUG, REQUEST_SECRET_WORKFLOW_NAME),
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
            *[
                {
                    "type": "platform",
                    "op": op_name,
                    "permission": _BUILD_KIT_OP_PERMISSIONS[op_name],
                }
                for op_name in DEFAULT_BUILD_KIT_OPS
            ],
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
