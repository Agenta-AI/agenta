"""The share disclosure: which gateway connections an agent revision's tools use.

Pure. `SharingService` is built before `WorkflowsService` exists, so it never reads
revisions: the sharing router reads the agent's head revision and calls this.
"""

from typing import Any, List, Optional, Set, Tuple

from agenta.sdk.agents.tools import (
    GatewayConnectionToolConfig,
    GatewayToolConfig,
    coerce_tool_configs,
)

from oss.src.core.sharing.dtos import DisclosedConnection, ShareDisclosure


def _tool_entries(parameters: Optional[dict]) -> List[Any]:
    """The revision's tool entries: `parameters.agent.tools` for the agent template, or
    `parameters.tools` for a bare template (the two shapes the SDK reads)."""

    if not isinstance(parameters, dict):
        return []
    agent = parameters.get("agent")
    source = agent if isinstance(agent, dict) else parameters
    tools = source.get("tools")
    return tools if isinstance(tools, list) else []


def build_share_disclosure(*, parameters: Optional[dict]) -> ShareDisclosure:
    """One `DisclosedConnection` per gateway connection named in the revision's tools,
    deduplicated and sorted. MCP endpoints (`mcps`) and provider keys are not
    connections of the gateway and are not listed. An entry that does not parse is
    skipped: the disclosure never fails the sharing read."""

    configs = coerce_tool_configs(_tool_entries(parameters), on_error="collect")
    seen: Set[Tuple[str, str, str]] = set()
    for config in configs.tool_configs:
        if isinstance(config, GatewayToolConfig):
            seen.add((config.provider, config.integration, config.connection))
        elif isinstance(config, GatewayConnectionToolConfig):
            ref = config.connection
            seen.add((ref.provider, ref.integration, ref.slug))

    return ShareDisclosure(
        connections=[
            DisclosedConnection(
                provider=provider, integration=integration, connection=connection
            )
            for provider, integration, connection in sorted(seen)
        ]
    )
