"""Translate a Composio semantic search into the Agenta-native discovery contract.

These are the pure functions behind ``discover_tools``: they take a parsed
``ComposioSearchResult`` plus the project's per-integration connection state and
produce a ``CapabilitiesResult``. No I/O, no provider strings leak to the agent.

The async orchestration (the search call, the cache split, the connection-state
join against ``gateway_connections``) lives in ``ToolsService.discover_capabilities``.
The contract and the Composio→Agenta mapping are documented in
``docs/design/agent-workflows/projects/tool-discovery/design.md``.
"""

import re
from typing import Dict, List, Optional, Set, Tuple

from oss.src.core.tools.dtos import (
    Capability,
    CapabilityConnection,
    CapabilityGuidance,
    CapabilitiesResult,
    ConnectionRequirement,
    DiscoveredAlternative,
    DiscoveredTool,
    ToolConnectionState,
)
from oss.src.core.tools.providers.composio.dtos import (
    ComposioSearchQueryResult,
    ComposioSearchResult,
)


# A use_case that reads like an event subscription rather than an action. Composio
# has no semantic trigger search (research.md §4), so v1 scopes to action tools and
# flags these for a follow-up trigger subscription (D5).
_TRIGGER_HINTS: Tuple[str, ...] = (
    "listen",
    "trigger",
    "subscribe",
    "subscription",
    "webhook",
    "when a new",
    "when new",
    "whenever",
    "watch for",
    "on new",
    "react to",
    "incoming",
    "is posted",
    "is created",
    "is received",
    "new message",
    "new email",
)

_TRIGGER_CAPABILITY_NOTE = (
    "This use case reads like a trigger (listening for events). discover_tools "
    "covers action tools only; listening needs a trigger subscription, a separate "
    "Agenta setup that is a follow-up. The action tools below can still be attached."
)

_TRIGGER_TOP_NOTE = (
    "One or more use cases look like triggers (listen/subscribe). v1 discovery "
    "returns action tools only — set up event listening via a trigger subscription "
    "separately."
)

# A Composio-style tool slug token: an uppercase toolkit prefix plus an action,
# e.g. SLACK_SEND_MESSAGE. Used to rewrite slugs inside guidance prose.
_SLUG_TOKEN_RE = re.compile(r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b")


def looks_like_trigger(use_case: str) -> bool:
    """True when a use_case fragment reads like an event subscription (D5)."""
    text = (use_case or "").lower()
    return any(hint in text for hint in _TRIGGER_HINTS)


def split_composio_slug(
    composio_slug: str,
    toolkits: List[str],
) -> Tuple[str, str]:
    """``GITHUB_CREATE_AN_ISSUE`` + toolkits → ``("github", "CREATE_AN_ISSUE")``.

    Matches the longest known toolkit prefix (so ``slackbot`` wins over ``slack``);
    falls back to splitting on the first underscore when no toolkit matches.
    """
    upper = composio_slug.upper()
    best_prefix: Optional[str] = None
    best_toolkit: Optional[str] = None
    for toolkit in toolkits:
        if not toolkit:
            continue
        prefix = f"{toolkit.upper()}_"
        if upper.startswith(prefix) and (
            best_prefix is None or len(prefix) > len(best_prefix)
        ):
            best_prefix = prefix
            best_toolkit = toolkit

    if best_prefix and best_toolkit:
        return best_toolkit.lower(), composio_slug[len(best_prefix) :]

    integration, _, action = composio_slug.partition("_")
    return integration.lower(), action or composio_slug


def map_guidance_text(text: str, toolkits: List[str]) -> str:
    """Rewrite Composio slugs in prose to friendly ``integration.action`` names.

    Only tokens whose prefix matches a known toolkit are rewritten, so unrelated
    all-caps tokens (e.g. ``HTTP``, ``JSON``) are left untouched.
    """
    known = {toolkit.lower() for toolkit in toolkits if toolkit}

    def _replace(match: "re.Match[str]") -> str:
        token = match.group(0)
        integration, action = split_composio_slug(token, toolkits)
        if integration in known and action:
            return f"{integration}.{action}"
        return token

    return _SLUG_TOKEN_RE.sub(_replace, text)


def referenced_integrations(
    search: ComposioSearchResult,
    *,
    limit_alternatives: int,
) -> List[str]:
    """The integrations a translation will surface (primary + capped alternatives).

    Order-stable and deduped. The service computes connection state only for these,
    so ``connections[]`` mirrors exactly what the agent is offered. Only the first
    primary slug is exposed as a capability's ``tool`` (see ``_translate_one``), so
    only that one feeds the referenced set — never the unused extra primaries.
    """
    seen: Set[str] = set()
    out: List[str] = []
    for result in search.results:
        for slug in (
            _primary_slugs(result)[:1]
            + result.related_tool_slugs[: max(limit_alternatives, 0)]
        ):
            integration, _ = split_composio_slug(slug, result.toolkits)
            if integration and integration not in seen:
                seen.add(integration)
                out.append(integration)
    return out


def translate_search_result(
    search: ComposioSearchResult,
    connection_states: Dict[str, ConnectionRequirement],
    *,
    limit_alternatives: int = 3,
    trigger_use_cases: Optional[Set[str]] = None,
) -> CapabilitiesResult:
    """Build the Agenta-native ``CapabilitiesResult`` from a parsed search.

    ``connection_states`` maps an (lowercased) integration to its resolved
    requirement (state + slug + create affordance), computed fresh by the service.
    ``trigger_use_cases`` are the fragments that read like triggers (D5).
    """
    trigger_use_cases = trigger_use_cases or set()
    all_toolkits = _all_toolkits(search)

    capabilities: List[Capability] = []
    for result in search.results:
        capabilities.append(
            _translate_one(
                result,
                search=search,
                connection_states=connection_states,
                limit_alternatives=limit_alternatives,
                is_trigger=result.use_case in trigger_use_cases,
            )
        )

    guidance = _translate_guidance(search, all_toolkits)

    # connections[]: one per referenced integration, in surfaced order.
    connections = [
        connection_states[integration]
        for integration in referenced_integrations(
            search, limit_alternatives=limit_alternatives
        )
        if integration in connection_states
    ]

    # ready means create-and-run now: every requested use_case must resolve to a
    # primary tool whose connection is ready. A use_case with no primary match (no
    # tool/connection) keeps the result not-ready instead of being silently dropped.
    ready = bool(capabilities) and all(
        capability.tool is not None
        and capability.connection is not None
        and capability.connection.state == ToolConnectionState.READY
        for capability in capabilities
    )

    notes: List[str] = []
    if any(capability.note for capability in capabilities):
        notes.append(_TRIGGER_TOP_NOTE)

    return CapabilitiesResult(
        capabilities=capabilities,
        connections=connections,
        guidance=guidance,
        ready=ready,
        notes=notes,
    )


# ---------------------------------------------------------------------------
# Internals
# ---------------------------------------------------------------------------


def _primary_slugs(result: ComposioSearchQueryResult) -> List[str]:
    return list(result.primary_tool_slugs)


def _all_toolkits(search: ComposioSearchResult) -> List[str]:
    toolkits: List[str] = []
    seen: Set[str] = set()
    for result in search.results:
        for toolkit in result.toolkits:
            key = toolkit.lower()
            if key not in seen:
                seen.add(key)
                toolkits.append(toolkit)
    for schema in search.tool_schemas.values():
        if schema.toolkit and schema.toolkit.lower() not in seen:
            seen.add(schema.toolkit.lower())
            toolkits.append(schema.toolkit)
    return toolkits


def _translate_one(
    result: ComposioSearchQueryResult,
    *,
    search: ComposioSearchResult,
    connection_states: Dict[str, ConnectionRequirement],
    limit_alternatives: int,
    is_trigger: bool,
) -> Capability:
    primary_slugs = _primary_slugs(result)
    note = _TRIGGER_CAPABILITY_NOTE if is_trigger else None

    if not primary_slugs:
        return Capability(use_case=result.use_case, note=note)

    primary_slug = primary_slugs[0]
    integration, action = split_composio_slug(primary_slug, result.toolkits)
    schema = search.tool_schemas.get(primary_slug)
    requirement = connection_states.get(integration)

    is_ready = (
        requirement is not None and requirement.state == ToolConnectionState.READY
    )
    tool = DiscoveredTool(
        integration=integration,
        action=action,
        connection=requirement.slug if is_ready else None,
        input_schema=schema.input_schema if schema else None,
        description=schema.description if schema else None,
        provider_action=primary_slug,
    )

    connection = None
    if requirement is not None:
        connection = CapabilityConnection(
            state=requirement.state,
            slug=requirement.slug if is_ready else None,
        )

    alternatives = _translate_alternatives(
        result,
        search=search,
        limit_alternatives=limit_alternatives,
    )

    return Capability(
        use_case=result.use_case,
        integration=integration,
        tool=tool,
        alternatives=alternatives,
        connection=connection,
        difficulty=result.difficulty,
        note=note,
    )


def _translate_alternatives(
    result: ComposioSearchQueryResult,
    *,
    search: ComposioSearchResult,
    limit_alternatives: int,
) -> List[DiscoveredAlternative]:
    alternatives: List[DiscoveredAlternative] = []
    for slug in result.related_tool_slugs[: max(limit_alternatives, 0)]:
        integration, action = split_composio_slug(slug, result.toolkits)
        schema = search.tool_schemas.get(slug)
        alternatives.append(
            DiscoveredAlternative(
                integration=integration,
                action=action,
                description=schema.description if schema else None,
                provider_action=slug,
            )
        )
    return alternatives


def _translate_guidance(
    search: ComposioSearchResult,
    toolkits: List[str],
) -> CapabilityGuidance:
    plan_steps: List[str] = []
    pitfalls: List[str] = []
    for result in search.results:
        plan_steps.extend(result.recommended_plan_steps)
        pitfalls.extend(result.known_pitfalls)

    return CapabilityGuidance(
        plan_steps=_dedupe(map_guidance_text(step, toolkits) for step in plan_steps),
        pitfalls=_dedupe(map_guidance_text(item, toolkits) for item in pitfalls),
    )


def _dedupe(items) -> List[str]:
    seen: Set[str] = set()
    out: List[str] = []
    for item in items:
        if item and item not in seen:
            seen.add(item)
            out.append(item)
    return out
