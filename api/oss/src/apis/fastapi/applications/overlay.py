"""Read-only overlays attached to application inspect/fetch responses."""

from typing import Any, Dict, List, Optional

from agenta.sdk.agents.adapters.agenta_builtins import GETTING_STARTED_WITH_AGENTA_SLUG
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS

from oss.src.core.workflows.static_catalog import (
    STATIC_SLUG_PREFIX,
    StaticWorkflowCatalog,
    _STATIC_WORKFLOWS,
)


def _workflow_embed(
    slug: str,
    *,
    name: Optional[str],
    selector_path: str,
) -> Dict[str, Any]:
    # The selector is load-bearing: without it the embed resolves to the whole revision.data
    # (``{uri, parameters: {skill|tool: ...}}``), which neither the SDK skill parser nor the tool
    # coercer accepts. ``parameters.skill`` / ``parameters.tool`` extracts the flat inline value
    # the agent template expects (see test_skill_template_catalog canonical embed shape).
    embed: Dict[str, Any] = {
        "@ag.embed": {
            "@ag.references": {"workflow": {"slug": slug}},
            "@ag.selector": {"path": selector_path},
        }
    }
    # The display name rides alongside the embed so the playground shows the workflow's name, not
    # the raw ``__ag__*`` slug. Resolution replaces the whole entry, so this sibling is discarded
    # before the tool/skill parser ever sees it.
    if name:
        embed["name"] = name
    return embed


def _reserved_static_tool_embeds(
    catalog: StaticWorkflowCatalog,
) -> List[Dict[str, Any]]:
    """Tool embeds for the reserved static workflows that are tools (not skills).

    Only confirmed non-skill static workflows with a resolvable revision are included; a missing
    revision or missing flags is skipped so an invalid tool embed can't leak into the playground.
    """
    embeds: List[Dict[str, Any]] = []
    for slug in _STATIC_WORKFLOWS:
        if not slug.startswith(STATIC_SLUG_PREFIX):
            continue
        revision = catalog.retrieve_revision(slug=slug)
        if not revision or not revision.flags or revision.flags.is_skill:
            continue
        embeds.append(
            _workflow_embed(
                slug,
                name=revision.name,
                selector_path="parameters.tool",
            )
        )
    return embeds


def build_agent_template_overlay() -> Dict[str, Any]:
    """Build the playground-only agent-template overlay from platform-owned sources."""

    catalog = StaticWorkflowCatalog()

    skills: List[Dict[str, Any]] = []
    authoring_skill = catalog.retrieve_revision(slug=GETTING_STARTED_WITH_AGENTA_SLUG)
    if authoring_skill:
        skills.append(
            _workflow_embed(
                GETTING_STARTED_WITH_AGENTA_SLUG,
                name=authoring_skill.name,
                selector_path="parameters.skill",
            )
        )

    return {
        "tools": [
            *[{"type": "platform", "op": op_name} for op_name in PLATFORM_OPS],
            *_reserved_static_tool_embeds(catalog),
        ],
        "skills": skills,
        "sandbox": {
            "permissions": {
                "write_files": "allow",
                "execute_code": "allow",
            }
        },
    }
