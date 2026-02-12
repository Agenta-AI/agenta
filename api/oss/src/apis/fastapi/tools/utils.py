from typing import Any, Literal, Optional
from uuid import UUID

from fastapi import Query

from oss.src.core.shared.dtos import Windowing
from oss.src.core.tools.dtos import (
    ActionQuery,
    ActionQueryRequest,
    ToolQuery,
    ToolQueryFlags,
    ToolQueryRequest,
)


# ---------------------------------------------------------------------------
# Slug parsing
# ---------------------------------------------------------------------------


class ParsedSlug:
    """Result of parsing a tool slug."""

    def __init__(
        self,
        *,
        provider_key: str,
        integration_key: Optional[str] = None,
        action_key: Optional[str] = None,
        connection_slug: Optional[str] = None,
    ):
        self.provider_key = provider_key
        self.integration_key = integration_key
        self.action_key = action_key
        self.connection_slug = connection_slug


def parse_tool_slug(slug: str) -> ParsedSlug:
    """Parse a tool slug into its components.

    Format: tools.{provider_key}.{integration_key}[.{action_key}[.{connection_slug}]]

    Examples:
        tools.composio.gmail                              → provider + integration
        tools.composio.gmail.SEND_EMAIL                   → + action
        tools.composio.gmail.SEND_EMAIL.support_inbox     → + connection
    """
    parts = slug.split(".")

    if len(parts) < 3 or parts[0] != "tools":
        raise ValueError(f"Invalid tool slug: {slug}")

    result = ParsedSlug(provider_key=parts[1])

    if len(parts) >= 3:
        result.integration_key = parts[2]
    if len(parts) >= 4:
        result.action_key = parts[3]
    if len(parts) >= 5:
        result.connection_slug = parts[4]

    return result


# ---------------------------------------------------------------------------
# Query param parsing — tool query
# ---------------------------------------------------------------------------


def parse_tool_query_request_from_params(
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    provider_key: Optional[str] = Query(None),
    integration_key: Optional[str] = Query(None),
    is_connected: Optional[bool] = Query(None),
    #
    include_connections: Optional[bool] = Query(None),
    #
    next: Optional[UUID] = Query(None),
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> ToolQueryRequest:
    flags = None
    if is_connected is not None:
        flags = ToolQueryFlags(is_connected=is_connected)

    tool = None
    if any([name, description, provider_key, integration_key, flags]):
        tool = ToolQuery(
            name=name,
            description=description,
            provider_key=provider_key,
            integration_key=integration_key,
            flags=flags,
        )

    windowing = None
    if any([next, limit, order]):
        windowing = Windowing(
            next=next,
            limit=limit,
            order=order,
        )

    return ToolQueryRequest(
        tool=tool,
        include_connections=include_connections,
        windowing=windowing,
    )


def parse_tool_query_request_from_body(
    **kwargs: Any,
) -> ToolQueryRequest:
    try:
        return ToolQueryRequest(**kwargs)
    except Exception:
        return ToolQueryRequest()


def merge_tool_query_requests(
    params: Optional[ToolQueryRequest] = None,
    body: Optional[ToolQueryRequest] = None,
) -> ToolQueryRequest:
    if params and not body:
        return params
    if not params and body:
        return body
    if params and body:
        return ToolQueryRequest(
            tool=body.tool or params.tool,
            include_connections=(
                body.include_connections
                if body.include_connections is not None
                else params.include_connections
            ),
            windowing=body.windowing or params.windowing,
        )
    return ToolQueryRequest()


# ---------------------------------------------------------------------------
# Query param parsing — catalog query
# ---------------------------------------------------------------------------


def parse_action_query_request_from_params(
    name: Optional[str] = Query(None),
    description: Optional[str] = Query(None),
    provider_key: Optional[str] = Query(None),
    integration_key: Optional[str] = Query(None),
    #
    next: Optional[UUID] = Query(None),
    limit: Optional[int] = Query(None),
    order: Optional[Literal["ascending", "descending"]] = Query(None),
) -> ActionQueryRequest:
    action = None
    if any([name, description, provider_key, integration_key]):
        action = ActionQuery(
            name=name,
            description=description,
            provider_key=provider_key,
            integration_key=integration_key,
        )

    windowing = None
    if any([next, limit, order]):
        windowing = Windowing(
            next=next,
            limit=limit,
            order=order,
        )

    return ActionQueryRequest(
        action=action,
        windowing=windowing,
    )


def merge_action_query_requests(
    params: Optional[ActionQueryRequest] = None,
    body: Optional[ActionQueryRequest] = None,
) -> ActionQueryRequest:
    if params and not body:
        return params
    if not params and body:
        return body
    if params and body:
        return ActionQueryRequest(
            action=body.action or params.action,
            windowing=body.windowing or params.windowing,
        )
    return ActionQueryRequest()
