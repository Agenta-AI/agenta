"""Read-only overlays attached to application inspect/fetch responses."""

from typing import Any, Dict, List

from agenta.sdk.agents.adapters.agenta_builtins import GETTING_STARTED_WITH_AGENTA_SLUG
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS

from oss.src.core.workflows.static_catalog import (
    STATIC_SLUG_PREFIX,
    StaticWorkflowCatalog,
    _STATIC_WORKFLOWS,
)


def _workflow_embed(slug: str, *, selector_path: str) -> Dict[str, Any]:
    # The selector is load-bearing: without it the embed resolves to the whole revision.data
    # (``{uri, parameters: {skill|tool: ...}}``), which neither the SDK skill parser nor the tool
    # coercer accepts. ``parameters.skill`` / ``parameters.tool`` extracts the flat inline value
    # the agent template expects (see test_skill_template_catalog canonical embed shape).
    return {
        "@ag.embed": {
            "@ag.references": {"workflow": {"slug": slug}},
            "@ag.selector": {"path": selector_path},
        }
    }


def _reserved_static_tool_slugs() -> List[str]:
    catalog = StaticWorkflowCatalog()
    slugs: List[str] = []
    for slug in _STATIC_WORKFLOWS:
        if not slug.startswith(STATIC_SLUG_PREFIX):
            continue
        revision = catalog.retrieve_revision(slug=slug)
        if revision and revision.flags and revision.flags.is_skill:
            continue
        slugs.append(slug)
    return slugs


def build_agent_template_overlay() -> Dict[str, Any]:
    """Build the playground-only agent-template overlay from platform-owned sources."""

    return {
        "tools": [
            *[{"type": "platform", "op": op_name} for op_name in PLATFORM_OPS],
            *[
                _workflow_embed(slug, selector_path="parameters.tool")
                for slug in _reserved_static_tool_slugs()
            ],
        ],
        "skills": [
            _workflow_embed(
                GETTING_STARTED_WITH_AGENTA_SLUG, selector_path="parameters.skill"
            )
        ],
        "sandbox": {
            "permissions": {
                "write_files": "allow",
                "execute_code": "allow",
            }
        },
    }
