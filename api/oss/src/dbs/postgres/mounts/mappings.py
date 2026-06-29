from uuid import UUID

from oss.src.core.mounts.dtos import (
    Mount,
    MountCreate,
    MountData,
    MountEdit,
    MountFlags,
)
from oss.src.dbs.postgres.mounts.dbes import MountDBE


def map_mount_dto_to_dbe_create(
    *,
    project_id: UUID,
    user_id: UUID,
    #
    mount_create: MountCreate,
) -> MountDBE:
    return MountDBE(
        project_id=project_id,
        #
        created_by_id=user_id,
        #
        slug=mount_create.slug,
        session_id=mount_create.session_id,
        #
        name=mount_create.name,
        description=mount_create.description,
        #
        flags=mount_create.flags.model_dump(),
        #
        data=mount_create.data.model_dump(mode="json"),
    )


def map_mount_dbe_to_dto(
    *,
    mount_dbe: MountDBE,
) -> Mount:
    return Mount(
        id=mount_dbe.id,
        #
        created_at=mount_dbe.created_at,
        updated_at=mount_dbe.updated_at,
        deleted_at=mount_dbe.deleted_at,
        created_by_id=mount_dbe.created_by_id,
        updated_by_id=mount_dbe.updated_by_id,
        deleted_by_id=mount_dbe.deleted_by_id,
        #
        project_id=mount_dbe.project_id,
        slug=mount_dbe.slug,
        session_id=mount_dbe.session_id,
        #
        name=mount_dbe.name,
        description=mount_dbe.description,
        #
        data=MountData.model_validate(mount_dbe.data),
        #
        flags=MountFlags(**(mount_dbe.flags or {})),
    )


def map_mount_dto_to_dbe_edit(
    *,
    mount_dbe: MountDBE,
    #
    user_id: UUID,
    #
    mount_edit: MountEdit,
) -> None:
    mount_dbe.updated_by_id = user_id

    mount_dbe.name = mount_edit.name
    mount_dbe.description = mount_edit.description

    mount_dbe.flags = mount_edit.flags.model_dump()
