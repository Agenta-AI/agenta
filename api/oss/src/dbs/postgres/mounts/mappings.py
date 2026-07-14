from datetime import datetime
from typing import Any, Dict
from uuid import UUID

import uuid_utils.compat as uuid_utils

from oss.src.core.mounts.dtos import (
    Mount,
    MountCreate,
    MountData,
    MountEdit,
    MountFlags,
)
from oss.src.dbs.postgres.mounts.dbes import MountDBE


def map_mount_dto_to_dbe_upsert(
    *,
    project_id: UUID,
    user_id: UUID,
    now: datetime,
    #
    mount_create: MountCreate,
) -> Dict[str, Any]:
    """Column values for an `insert(...).on_conflict_do_update` upsert.

    `id` is minted here because explicit `insert().values()` bypasses the ORM's
    `default=uuid7` (it only fires on `session.add`), so the pk would be null otherwise.
    """
    return {
        "id": uuid_utils.uuid7(),
        "project_id": project_id,
        "created_by_id": user_id,
        "created_at": now,
        "updated_at": None,
        "updated_by_id": None,
        "deleted_at": None,
        "deleted_by_id": None,
        "slug": mount_create.slug,
        "session_id": mount_create.session_id,
        "name": mount_create.name,
        "description": mount_create.description,
        "flags": mount_create.flags.model_dump(),
        "tags": mount_create.tags,
        "meta": mount_create.meta,
        "data": {},
    }


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
        tags=mount_create.tags,
        meta=mount_create.meta,
        #
        data={},
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
        tags=mount_dbe.tags,
        meta=mount_dbe.meta,
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
    if mount_edit.tags is not None:
        mount_dbe.tags = mount_edit.tags
    if mount_edit.meta is not None:
        mount_dbe.meta = mount_edit.meta
