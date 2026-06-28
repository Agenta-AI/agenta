"""Read-only overlays attached to application inspect/fetch responses."""

from typing import Any, Dict, List

from agenta.sdk.agents.adapters.agenta_builtins import GETTING_STARTED_WITH_AGENTA_SLUG
from agenta.sdk.agents.platform.op_catalog import PLATFORM_OPS

from oss.src.core.workflows.static_catalog import (
    STATIC_SLUG_PREFIX,
    StaticWorkflowCatalog,
    _STATIC_WORKFLOWS,
)


def _workflow_embed(slug: str) -> Dict[str, Any]:
    return {"@ag.embed": {"@ag.references": {"workflow": {"slug": slug}}}}


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
            *[_workflow_embed(slug) for slug in _reserved_static_tool_slugs()],
        ],
        "skills": [_workflow_embed(GETTING_STARTED_WITH_AGENTA_SLUG)],
        "sandbox": {
            "permissions": {
                "write_files": "allow",
                "execute_code": "allow",
            }
        },
    }
