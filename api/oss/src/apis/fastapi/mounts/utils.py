from datetime import datetime, timezone
from mimetypes import guess_type
from posixpath import basename
from stat import S_IFREG
from typing import List, Optional, Tuple
from urllib.parse import quote
from uuid import UUID

from fastapi import Response, UploadFile
from fastapi.responses import StreamingResponse
from stream_zip import ZIP_AUTO, async_stream_zip

from oss.src.core.mounts.dtos import MountCredentials, MountFileWritten, MountQuery
from oss.src.core.mounts.service import MountsService

# Regular-file mode for archive members (owner rw, group/other r).
_ARCHIVE_FILE_MODE = S_IFREG | 0o644


def _content_disposition_attachment(filename: str) -> str:
    """Build a safe `Content-Disposition: attachment` header value (RFC 6266).

    `filename` is client-supplied (a download path's basename or the archive name), so it must never
    be interpolated raw: a `"` or control char would break out of the quoted parameter and inject
    further header directives. The quoted `filename` is stripped to an ASCII, printable, quote-free
    fallback (the header is latin-1 encoded); `filename*` carries the exact (percent-encoded) value for
    clients that honour it.
    """
    safe = (
        "".join(
            c for c in filename if c.isascii() and c.isprintable() and c not in '"\\'
        )
        or "download"
    )
    return (
        f"attachment; filename=\"{safe}\"; filename*=UTF-8''{quote(filename, safe='')}"
    )


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
        headers={"Content-Disposition": _content_disposition_attachment(name)},
    )


async def stream_mounts_archive(
    *,
    mounts_service: MountsService,
    project_id: UUID,
    mounts: List[Tuple[UUID, str, str]],
    filename: str = "files.zip",
) -> StreamingResponse:
    """STREAM a zip of EVERY file across the given mounts as a binary download ("download all").

    The drive folds cwd + agent-files into one tree, so each ``(mount_id, prefix)`` is placed under
    ``prefix/`` in the zip. The archive is streamed member-by-member (never buffered whole), and the
    service prefetches file bodies with bounded concurrency. ``ZIP_AUTO`` picks zip32/zip64 per file
    by size, so large drives and >4 GB archives are handled.
    """
    work = await mounts_service.build_archive_work_list(
        project_id=project_id,
        mounts=mounts,
    )

    async def members():
        async for (
            zip_path,
            _size,
            mtime,
            body,
        ) in mounts_service.iter_archive_members(
            work=work,
        ):
            # `mtime` is the store's LastModified as epoch MILLISECONDS (see StoreObject.mtime);
            # `datetime.fromtimestamp` wants SECONDS — passing ms overflows to a year out of range
            # and RAISES mid-stream (after 200 headers are sent), truncating the zip to 0 bytes.
            modified_at = (
                datetime.fromtimestamp(mtime / 1000, tz=timezone.utc)
                if mtime
                else datetime.now(tz=timezone.utc)
            )

            async def _data(_body=body):
                yield _body

            # Size from the actual bytes (not the pre-read listing) so a file changed between list
            # and read can't desync the zip entry; ZIP_AUTO then picks zip32/zip64 accordingly.
            yield (
                zip_path,
                modified_at,
                _ARCHIVE_FILE_MODE,
                ZIP_AUTO(len(body)),
                _data(),
            )

    return StreamingResponse(
        async_stream_zip(members()),
        media_type="application/zip",
        headers={"Content-Disposition": _content_disposition_attachment(filename)},
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
