from mimetypes import guess_type
from posixpath import basename
from typing import Optional
from uuid import UUID

from fastapi import Response, UploadFile

from oss.src.core.mounts.dtos import MountCredentials, MountFileWritten, MountQuery
from oss.src.core.mounts.service import MountsService


async def upload_mount_file(
    *,
    mounts_service: MountsService,
    project_id: UUID,
    mount_id: UUID,
    file: UploadFile,
    path: Optional[str] = None,
) -> MountFileWritten:
    """Write an uploaded file to a mount. Shared by /mounts and /sessions/mounts.

    `path` controls the destination; it falls back to the uploaded filename when the
    path omits a filename (trailing slash) or is absent.
    """
    dest = path
    if not dest:
        dest = file.filename
    elif dest.endswith("/"):
        dest = f"{dest}{file.filename}"

    content = await file.read()
    return await mounts_service.write_file(
        project_id=project_id,
        mount_id=mount_id,
        path=dest,
        content=content,
    )


async def download_mount_file(
    *,
    mounts_service: MountsService,
    project_id: UUID,
    mount_id: UUID,
    path: str,
) -> Response:
    """Return raw object bytes as a binary download. Shared by both routers.

    Reads bytes directly (no lossy UTF-8 decode), so binary files round-trip.
    """
    body = await mounts_service.read_file_bytes(
        project_id=project_id,
        mount_id=mount_id,
        path=path,
    )
    name = basename(path.rstrip("/")) or "download"
    media_type = guess_type(name)[0] or "application/octet-stream"
    return Response(
        content=body,
        media_type=media_type,
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


async def sign_mount_credentials(
    *,
    mounts_service: MountsService,
    project_id: UUID,
    mount_id: UUID,
) -> MountCredentials:
    """Mint scoped, short-lived credentials for a mount. Shared by both routers."""
    return await mounts_service.sign_mount_credentials(
        project_id=project_id,
        mount_id=mount_id,
    )


def merge_mount_query(
    *,
    session_id: Optional[str] = None,
    include_archived: bool = False,
    body_query: Optional[MountQuery] = None,
) -> MountQuery:
    """Merge query-param filters with an optional body query."""
    base = body_query or MountQuery()

    if session_id is not None:
        base.session_id = session_id

    if include_archived:
        base.include_archived = include_archived

    return base
