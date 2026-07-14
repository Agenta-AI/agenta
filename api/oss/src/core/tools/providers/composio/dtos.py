from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ComposioToolConnectionData(BaseModel):
    connected_account_id: Optional[str] = None
    auth_config_id: Optional[str] = None


# ---------------------------------------------------------------------------
# COMPOSIO_SEARCH_TOOLS response (the tool-discovery engine)
# ---------------------------------------------------------------------------
#
# One ``POST /tools/execute/COMPOSIO_SEARCH_TOOLS`` call returns matched tools +
# alternatives + inline schemas + plan + pitfalls + per-user connection state.
# Pydantic ignores unknown fields, so this captures only what the discovery
# translation consumes; the rest of Composio's envelope (session, time_info,
# next_steps_guidance, status_message, …) is intentionally dropped.


class ComposioSearchQueryResult(BaseModel):
    """One ``results[]`` entry — one per query/use_case."""

    use_case: str = ""
    primary_tool_slugs: List[str] = Field(default_factory=list)
    related_tool_slugs: List[str] = Field(default_factory=list)
    toolkits: List[str] = Field(default_factory=list)
    recommended_plan_steps: List[str] = Field(default_factory=list)
    known_pitfalls: List[str] = Field(default_factory=list)
    difficulty: Optional[str] = None


class ComposioToolSchema(BaseModel):
    """One ``tool_schemas[slug]`` entry — deduped, keyed by tool_slug."""

    toolkit: Optional[str] = None
    tool_slug: str
    description: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = None


class ComposioToolkitConnectionStatus(BaseModel):
    """One ``toolkit_connection_statuses[]`` entry — one per toolkit.

    ``status_message`` is intentionally not modelled: it names a Composio
    meta-tool (``COMPOSIO_MANAGE_CONNECTIONS``) and must never leak to the agent.
    Connection state is reported in Agenta terms; see ``core/tools/discovery.py``.
    """

    toolkit: str
    has_active_connection: bool = False


class ComposioSearchResult(BaseModel):
    """Parsed ``data`` envelope of a COMPOSIO_SEARCH_TOOLS execution."""

    results: List[ComposioSearchQueryResult] = Field(default_factory=list)
    tool_schemas: Dict[str, ComposioToolSchema] = Field(default_factory=dict)
    toolkit_connection_statuses: List[ComposioToolkitConnectionStatus] = Field(
        default_factory=list
    )
