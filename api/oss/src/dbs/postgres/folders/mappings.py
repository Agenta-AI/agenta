from typing import Optional
from uuid import UUID

from sqlalchemy_utils import Ltree

from oss.src.core.folders.types import Folder, FolderCreate, FolderEdit
from oss.src.dbs.postgres.folders.dbes import FolderDBE


def create_dbe_from_dto(
    *,
    DBE,
    project_id: UUID,
    dto: FolderCreate,
    parent_path: Optional[str] = None,
) -> FolderDBE:
    """Create a FolderDBE from a FolderCreate DTO."""
    path_str = dto.slug if not parent_path else f"{parent_path}.{dto.slug}"
    path = Ltree(path_str)

    return DBE(
        project_id=project_id,
        #
        slug=dto.slug,
        #
        name=dto.name,
        description=dto.description,
        #
        tags=dto.tags,
        flags=dto.flags,
        meta=dto.meta,
        #
        parent_id=dto.parent_id,
        path=path,
        kind=dto.kind.value if dto.kind else None,
    )


def edit_dbe_from_dto(
    dbe: FolderDBE,
    dto: FolderEdit,
    **kwargs,
) -> FolderDBE:
    """Update a FolderDBE from a FolderEdit DTO."""
    if dto.slug is not None:
        dbe.slug = dto.slug

    if dto.name is not None:
        dbe.name = dto.name

    if dto.description is not None:
        dbe.description = dto.description

    if dto.tags is not None:
        dbe.tags = dto.tags

    if dto.flags is not None:
        dbe.flags = dto.flags

    if dto.meta is not None:
        dbe.meta = dto.meta

    if dto.parent_id is not None:
        dbe.parent_id = dto.parent_id

    if dto.kind is not None:
        dbe.kind = dto.kind.value

    # Apply any additional kwargs (like updated_at, updated_by_id)
    for key, value in kwargs.items():
        if hasattr(dbe, key):
            setattr(dbe, key, value)

    return dbe


def create_dto_from_dbe(
    *,
    DTO,
    dbe: FolderDBE,
) -> Folder:
    """Create a Folder DTO from a FolderDBE."""
    return DTO(
        id=dbe.id,
        slug=dbe.slug,
        #
        name=dbe.name,
        description=dbe.description,
        #
        created_at=dbe.created_at,
        updated_at=dbe.updated_at,
        deleted_at=dbe.deleted_at,
        created_by_id=dbe.created_by_id,
        updated_by_id=dbe.updated_by_id,
        deleted_by_id=dbe.deleted_by_id,
        #
        tags=dbe.tags,
        flags=dbe.flags,
        meta=dbe.meta,
        #
        parent_id=dbe.parent_id,
        path=str(dbe.path),
        kind=dbe.kind,
    )
