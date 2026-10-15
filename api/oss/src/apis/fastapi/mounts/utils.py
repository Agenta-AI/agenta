import asyncio
from datetime import datetime, timezone
from mimetypes import guess_type
from posixpath import basename
from stat import S_IFREG
from typing import Any, Callable, Coroutine, List, Optional
from urllib.parse import quote
from uuid import UUID

from fastapi import HTTPException, Request, Response, UploadFile, status
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute
from stream_zip import ZIP_AUTO, async_stream_zip

from oss.src.core.mounts.dtos import (
    MountArchiveSource,
    MountCredentials,
    MountFileWritten,
    MountQuery,
)
from oss.src.core.mounts.service import MountsService
from oss.src.utils.env import env

# Regular-file mode for archive members (owner rw, group/other r).
_ARCHIVE_FILE_MODE = S_IFREG | 0o644

# OpenAPI declarations for the routes below that return raw bytes rather than JSON. Without them
# FastAPI advertises `application/json`, and the generated clients then parse the body as JSON and
# corrupt the payload. A route must also declare a `response_class` with no media type, or FastAPI
# keeps its default `application/json` entry alongside these.
ZIP_RESPONSE = {
    200: {
        "content": {
            "application/zip": {"schema": {"type": "string", "format": "binary"}}
        }
    }
}
TEXT_READ_TOO_LARGE_RESPONSE = {
    413: {
        "description": "The `read` file is too large to return as text; "
        "download it from `/mounts/{mount_id}/files/download` instead."
    }
}
BINARY_RESPONSE = {
    200: {
        "content": {
            "application/octet-stream": {
                "schema": {"type": "string", "format": "binary"}
            }
        }
    }
}


# Room for the multipart boundaries and part headers around the file itself.
_UPLOAD_MULTIPART_OVERHEAD_BYTES = 64 * 1024


def _upload_too_large() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_413_CONTENT_TOO_LARGE,
        detail=f"The upload exceeds the {env.mounts.max_upload_bytes}-byte limit.",
    )


def check_upload_size(size: int) -> None:
    """Refuse file bytes over `AGENTA_MOUNTS_MAX_UPLOAD_BYTES`.

    The route class allows room for multipart framing, so it lets a file slightly over the
    limit through. This check applies the exact limit to the file itself.
    """
    if size > env.mounts.max_upload_bytes:
        raise _upload_too_large()


# A refused upload is read to its end, up to this many bytes, before the 413 goes out. A browser
# that gets the response while it still sends a file from disk stalls the upload and never shows
# the 413 (seen with Chrome behind the GKE load balancer). Reading the rest and throwing it away
# costs bandwidth, not memory. A body declared larger than this is refused at once.
_UPLOAD_DRAIN_LIMIT_BYTES = 1024 * 1024 * 1024
# A client that stops sending, or sends empty chunks, must not hold the 413 back forever.
_UPLOAD_DRAIN_TIMEOUT_SECONDS = 120.0


async def _drain(receive: Callable[[], Coroutine[Any, Any, dict]], budget: int) -> None:
    """Read and drop the rest of the request body: at most `budget` bytes, within the timeout."""

    async def read_rest() -> None:
        remaining = budget
        while remaining > 0:
            message = await receive()
            if message["type"] != "http.request":
                return
            remaining -= len(message.get("body", b""))
            if not message.get("more_body", False):
                return

    try:
        await asyncio.wait_for(read_rest(), timeout=_UPLOAD_DRAIN_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        pass


async def _size_capped_request(request: Request) -> Request:
    """Return `request` with its body capped at `AGENTA_MOUNTS_MAX_UPLOAD_BYTES`.

    A declared Content-Length over the cap is refused before any byte is kept: the body is read
    and dropped first (see `_UPLOAD_DRAIN_LIMIT_BYTES`), so the client gets the 413. A request
    without Content-Length is counted as it arrives and refused once it passes the cap.
    """
    max_body_bytes = env.mounts.max_upload_bytes + _UPLOAD_MULTIPART_OVERHEAD_BYTES
    receive = request.receive

    content_length = request.headers.get("content-length")
    if content_length is not None:
        try:
            declared = int(content_length)
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Content-Length must be an integer.",
            ) from error
        if declared > max_body_bytes:
            if declared <= _UPLOAD_DRAIN_LIMIT_BYTES:
                await _drain(receive, declared)
            raise _upload_too_large()

    received = 0

    async def capped_receive():
        nonlocal received
        message = await receive()
        if message["type"] == "http.request":
            received += len(message.get("body", b""))
            if received > max_body_bytes:
                if message.get("more_body", False):
                    await _drain(receive, _UPLOAD_DRAIN_LIMIT_BYTES - received)
                raise _upload_too_large()
        return message

    return Request(request.scope, capped_receive)


class SizeCappedUploadRoute(APIRoute):
    """A route whose request body is capped before FastAPI reads it.

    FastAPI parses a `File(...)` parameter before the handler runs, so a check inside the
    handler comes after the whole body is read. Use this for every route that takes a file body.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def capped_handler(request: Request) -> Response:
            return await handler(await _size_capped_request(request))

        return capped_handler


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
    check_upload_size(len(content))
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
    mounts: List[MountArchiveSource],
    filename: str = "files.zip",
) -> StreamingResponse:
    """STREAM a zip of EVERY file across the given mounts as a binary download ("download all").

    The drive folds cwd + agent-files into one tree, so each ``(mount_id, prefix)`` is placed under
    ``prefix/`` in the zip. The archive is streamed member-by-member (never buffered whole), and the
    service prefetches file bodies with bounded concurrency. ``ZIP_AUTO`` picks zip32/zip64 per entry
    by size; very large individual files are out of product scope for "download all".
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
    agent_id: Optional[str] = None,
    include_archived: bool = False,
    body_query: Optional[MountQuery] = None,
) -> MountQuery:
    """Merge query-param filters with an optional body query."""
    base = body_query or MountQuery()

    if session_id is not None:
        base.session_id = session_id

    if agent_id is not None:
        base.agent_id = agent_id

    if include_archived:
        base.include_archived = include_archived

    return base
