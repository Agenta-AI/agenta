from uuid import UUID
from typing import Optional

from oss.src.core.interactions.dtos import (
    Interaction,
    InteractionCreate,
    InteractionData,
    InteractionFlags,
    InteractionKind,
)
from oss.src.core.shared.dtos import Status
from oss.src.dbs.postgres.interactions.dbes import InteractionDBE


def map_interaction_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: Optional[UUID],
    #
    interaction: InteractionCreate,
) -> InteractionDBE:
    return InteractionDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        session_id=interaction.session_id,
        run_id=interaction.run_id,
        token=interaction.token,
        kind=interaction.kind.value,
        #
        status={"code": "pending"},
        #
        data=interaction.data.model_dump(mode="json", exclude_none=True)
        if interaction.data
        else None,
        #
        flags=interaction.flags.model_dump(),
    )


def map_interaction_dbe_to_dto(
    dbe: InteractionDBE,
) -> Interaction:
    return Interaction(
        id=dbe.id,
        #
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
        created_by_id=dbe.created_by_id,
        updated_by_id=dbe.updated_by_id,
        deleted_by_id=dbe.deleted_by_id,
        #
        project_id=dbe.project_id,
        session_id=dbe.session_id,
        run_id=dbe.run_id,
        token=dbe.token,
        kind=InteractionKind(dbe.kind),
        #
        status=Status.model_validate(dbe.status) if dbe.status else Status(),
        #
        data=InteractionData.model_validate(dbe.data) if dbe.data else None,
        #
        flags=InteractionFlags(**(dbe.flags or {})),
    )
