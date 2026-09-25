"""Playground build-kit content served through the static workflow catalogue."""

from copy import deepcopy
from typing import Any

from agenta.sdk.agents.adapters.agenta_builtins import (
    BUILD_AN_AGENT_SKILL,
    BUILD_AN_AGENT_SLUG,
)
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS
from agenta.sdk.agents.platform.workflow import (
    REQUEST_CONNECTION_WORKFLOW_SLUG,
    REQUEST_SECRET_WORKFLOW_SLUG,
)

from oss.src.core.apps.assembly import AGENTA_APPS_SKILL, AGENTA_APPS_SLUG

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

# Cut ops stay catalog opt-ins. `annotate_trace` and `query_spans` left the kit on 2026-09-07:
# no skill text told the model when to use them, and both are due for their own rework.
DEFAULT_BUILD_KIT_OPS: tuple[str, ...] = (
    "discover_tools",
    # Registry discovery: search + the self-config commit IS the agent-driven install.
    "search_skills",
    "check_skill_updates",
    "apply_skill_update",
    "read_config",
    "commit_revision",
    "test_run",
    "get_current_session",
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
    # Agent HTML apps. Unconditional: the overlay has no drive or feature gate, and the
    # web flag only hides Run, so without it the app is still a previewable HTML file.
    "list_starters",
    "create_app",
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
    name: str | None,
    selector_path: str,
) -> dict[str, Any]:
    # The selector is load-bearing: without it the embed resolves to the whole revision.data.
    embed: dict[str, Any] = {
        "@ag.embed": {
            "@ag.references": {"workflow": {"slug": slug}},
            "@ag.selector": {"path": selector_path},
        }
    }
    if name:
        embed["name"] = name
    return embed


def _reserved_static_tool_embeds() -> list[dict[str, Any]]:
    return [
        _workflow_embed(slug, name=name, selector_path="parameters.tool")
        for slug, name in _STATIC_TOOL_EMBEDS
    ]


def build_kit_op_access() -> dict[str, str]:
    return {
        op: "read" if PLATFORM_OPS[op].read_only else "write"
        for op in DEFAULT_BUILD_KIT_OPS
    }


def build_agent_template_overlay() -> dict[str, Any]:
    """Build the playground-only agent-template overlay from platform-owned sources."""
    return {
        "tools": [
            *[
                {
                    "type": "platform",
                    "op": op_name,
                    "permission": "allow",
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
            ),
            _workflow_embed(
                AGENTA_APPS_SLUG,
                name=AGENTA_APPS_SKILL.name,
                selector_path="parameters.skill",
            ),
        ],
        "sandbox": {
            "permissions": {
                "write_files": "allow",
                "execute_code": "allow",
            }
        },
    }


def apply_ui_build_kit(
    parameters: dict[str, Any],
    disabled_ops: list[str],
    op_permissions: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Mirror the ordinary UI merge on a run-only copy using canonical kit definitions."""

    def merge(base, overlay):
        result = deepcopy(base)
        for key, value in overlay.items():
            result[key] = (
                merge(result[key], value)
                if isinstance(result.get(key), dict) and isinstance(value, dict)
                else deepcopy(value)
            )
        return result

    def identity(entry, section):
        if not isinstance(entry, dict):
            return None
        if section == "tools" and entry.get("type") == "platform":
            return "platform:" + entry["op"]
        if section != "mcps":
            refs = entry.get("@ag.embed", {}).get("@ag.references", {})
            slug = refs.get("workflow", {}).get("slug") or refs.get(
                "workflow_revision", {}
            ).get("slug")
            if slug:
                return "workflow:" + slug
        return entry.get("name") if section != "skills" else None

    result = deepcopy(parameters)
    agent = result.get("agent", result)
    overlay = build_agent_template_overlay()
    overlay["tools"] = [
        tool
        for tool in overlay["tools"]
        if not (tool.get("type") == "platform" and tool.get("op") in disabled_ops)
    ]
    for tool in overlay["tools"]:
        if tool.get("type") == "platform":
            permission = (op_permissions or {}).get(tool["op"])
            if permission in ("allow", "ask"):
                tool["permission"] = permission
    for section, additions in overlay.items():
        if section in ("tools", "skills", "mcps"):
            items = [
                item
                for item in agent.get(section) or []
                if not (
                    section == "tools"
                    and isinstance(item, dict)
                    and item.get("type") == "platform"
                    and item.get("op") in disabled_ops
                    and item.get("op") in DEFAULT_BUILD_KIT_OPS
                )
            ]
            positions = {
                identity(item, section): index
                for index, item in enumerate(items)
                if identity(item, section) is not None
            }
            for item in additions:
                key = identity(item, section)
                if key is not None and key in positions:
                    items[positions[key]] = item
                else:
                    if key is not None:
                        positions[key] = len(items)
                    items.append(item)
            agent[section] = items
        else:
            agent[section] = merge(agent.get(section) or {}, additions)
    return result
