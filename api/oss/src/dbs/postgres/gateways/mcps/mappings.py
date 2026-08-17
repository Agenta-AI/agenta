"""MCP plane DBE <-> DTO mappings (entities.md §2, §4.4)."""

from datetime import datetime, timezone
from uuid import UUID

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.mcps.dtos import (
    MCPEndpoint,
    MCPEndpointCreate,
    MCPEndpointData,
    MCPEndpointEdit,
    MCPEndpointFlags,
)
from oss.src.core.shared.dtos import Status
from oss.src.dbs.postgres.gateways.mcps.dbes import MCPEndpointDBE


def map_mcp_endpoint_create_to_dbe(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    dto: MCPEndpointCreate,
) -> MCPEndpointDBE:
    return MCPEndpointDBE(
        project_id=project_id,
        slug=dto.slug,
        name=dto.name,
        description=dto.description,
        #
        auth_mode=dto.auth_mode,
        secret_id=dto.secret_id,
        #
        data=dto.data.model_dump(mode="json", exclude_none=True),
        flags=dto.flags.model_dump(mode="json", exclude_none=True),
        tags=dto.tags,
        meta=dto.meta,
        #
        created_by_id=user_id,
    )


def map_mcp_endpoint_dbe_to_dto(
    *,
    dbe: MCPEndpointDBE,
) -> MCPEndpoint:
    data = MCPEndpointData(**(dbe.data or {}))
    flags = MCPEndpointFlags(**(dbe.flags or {}))
    status = Status(**dbe.status) if dbe.status else None

    return MCPEndpoint(
        id=dbe.id,
        slug=dbe.slug,
        name=dbe.name,
        description=dbe.description,
        #
        auth_mode=dbe.auth_mode,
        namespace=GatewayEndpointNamespace.CUSTOM,
        secret_id=dbe.secret_id,
        # BUILTIN-only fields (§2.3): never set on a row this package persists.
        connection_id=None,
        provider_key=None,
        integration_key=None,
        #
        data=data,
        flags=flags,
        status=status,
        tags=dbe.tags,
        meta=dbe.meta,
        #
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
        created_by_id=dbe.created_by_id,
        updated_by_id=dbe.updated_by_id,
        deleted_by_id=dbe.deleted_by_id,
    )


def map_mcp_endpoint_edit_to_dbe(
    *,
    dbe: MCPEndpointDBE,
    user_id: UUID,
    #
    dto: MCPEndpointEdit,
) -> MCPEndpointDBE:
    """Full PUT over the editable surface (§4.4): data, flags, header, secret_id,
    and — unlike the LLM plane — auth_mode, which can move none -> oauth."""
    dbe.name = dto.name
    dbe.description = dto.description
    dbe.auth_mode = dto.auth_mode
    dbe.secret_id = dto.secret_id
    dbe.data = dto.data.model_dump(mode="json", exclude_none=True)
    dbe.flags = dto.flags.model_dump(mode="json", exclude_none=True)
    dbe.tags = dto.tags
    dbe.meta = dto.meta
    dbe.updated_at = datetime.now(timezone.utc)
    dbe.updated_by_id = user_id

    return dbe
