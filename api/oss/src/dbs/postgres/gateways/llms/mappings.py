"""LLM plane DBE <-> DTO mappings (entities.md §2, §4.3)."""

from datetime import datetime, timezone
from uuid import UUID

from oss.src.core.gateways.dtos import GatewayEndpointNamespace
from oss.src.core.gateways.llms.dtos import (
    LlmEndpoint,
    LlmEndpointCreate,
    LlmEndpointData,
    LlmEndpointEdit,
    LlmEndpointFlags,
)
from oss.src.core.shared.dtos import Status
from oss.src.dbs.postgres.gateways.llms.dbes import LlmEndpointDBE


def map_llm_endpoint_create_to_dbe(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    dto: LlmEndpointCreate,
) -> LlmEndpointDBE:
    return LlmEndpointDBE(
        project_id=project_id,
        slug=dto.slug,
        name=dto.name,
        description=dto.description,
        #
        provider_key=dto.provider_key,
        deployment=dto.deployment,
        secret_id=dto.secret_id,
        #
        data=dto.data.model_dump(mode="json", exclude_none=True),
        flags=dto.flags.model_dump(mode="json", exclude_none=True),
        tags=dto.tags,
        meta=dto.meta,
        #
        created_by_id=user_id,
    )


def map_llm_endpoint_dbe_to_dto(
    *,
    dbe: LlmEndpointDBE,
) -> LlmEndpoint:
    data = LlmEndpointData(**(dbe.data or {}))
    flags = LlmEndpointFlags(**(dbe.flags or {}))
    status = Status(**dbe.status) if dbe.status else None

    return LlmEndpoint(
        id=dbe.id,
        slug=dbe.slug,
        name=dbe.name,
        description=dbe.description,
        #
        provider_key=dbe.provider_key,
        deployment=dbe.deployment,
        namespace=GatewayEndpointNamespace.CUSTOM,
        secret_id=dbe.secret_id,
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


def map_llm_endpoint_edit_to_dbe(
    *,
    dbe: LlmEndpointDBE,
    user_id: UUID,
    #
    dto: LlmEndpointEdit,
) -> LlmEndpointDBE:
    """Full PUT over the editable surface (§4.3): data, flags, header, secret_id.
    provider_key and deployment are absent from LlmEndpointEdit and therefore
    untouched here."""
    dbe.name = dto.name
    dbe.description = dto.description
    dbe.secret_id = dto.secret_id
    dbe.data = dto.data.model_dump(mode="json", exclude_none=True)
    dbe.flags = dto.flags.model_dump(mode="json", exclude_none=True)
    dbe.tags = dto.tags
    dbe.meta = dto.meta
    dbe.updated_at = datetime.now(timezone.utc)
    dbe.updated_by_id = user_id

    return dbe
