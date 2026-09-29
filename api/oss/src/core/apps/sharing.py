"""Sharing agent HTML apps: publish a frozen snapshot of an app folder behind a share link.

A share lives in `mounts.data.shares[<app path>]` (settings, the live snapshot id) plus one folder
per publish under the drive's share prefix. A publish writes its whole folder first, then swaps
the snapshot id under the drive row's lock, then removes the folder it replaced, so a viewer never
sees a partial snapshot and nothing outlives the share.
"""

from __future__ import annotations

import asyncio
import hashlib
import mimetypes
import posixpath
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, List, Literal, Optional, Tuple
from uuid import UUID, uuid4

from oss.src.core.apps import share_token
from oss.src.core.apps.service import (
    APP_MANIFEST_FILENAME,
    AppsError,
    validate_manifest,
)
from oss.src.core.apps.share_capture import (
    Fetcher,
    LocalFile,
    capture,
    fetch_external,
)
from oss.src.core.apps.share_dtos import ShareFileEntry, ShareIssue, ShareManifest
from oss.src.core.mounts.dtos import AppShare, Mount
from oss.src.core.mounts.service import MountsService, validate_file_path
from oss.src.core.mounts.types import MountFileNotFound, MountPathInvalid
from oss.src.core.store.storage import ObjectStore, read_in_order
from oss.src.utils.crypting import is_default_crypt_key
from oss.src.utils.logging import get_module_logger

log = get_module_logger(__name__)

MAX_FILES = 200
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024
# Object reads and writes in flight at once, per publish or per view.
STORE_CONCURRENCY = 8

Visibility = Literal["workspace", "link"]


class AppShareError(Exception):
    """An expected share failure. `code` is stable; the router maps it to a status."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        details: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.code = code
        self.message = message
        self.details = details


@dataclass
class PublishResult:
    share: AppShare
    token: str
    external_failed: List[ShareIssue] = field(default_factory=list)
    warnings: List[ShareIssue] = field(default_factory=list)


@dataclass
class SharedAppSnapshot:
    """What the viewer route needs after the token, drive, and share checks passed."""

    project_id: UUID
    mount: Mount
    app_path: str
    share: AppShare
    manifest: ShareManifest


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _content_type(path: str) -> str:
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def _app_path(path: str) -> str:
    clean = (path or "").strip().strip("/")
    if not clean:
        raise AppShareError(
            "not_shareable", "The drive root is not an app. Share an app folder."
        )
    try:
        validate_file_path(clean)
    except MountPathInvalid as exc:
        raise AppShareError("not_shareable", exc.message) from exc
    # A hidden folder holds runner or template files (the agent's `.apps/starters`), not an app.
    if any(part.startswith(".") for part in clean.split("/")):
        raise AppShareError("not_shareable", "Apps in hidden folders cannot be shared.")
    return clean


class AppSharesService:
    def __init__(
        self,
        *,
        mounts_service: MountsService,
        store: Optional[ObjectStore],
        bucket: Optional[str],
        fetch: Fetcher = fetch_external,
    ):
        self.mounts_service = mounts_service
        self.store = store
        self.bucket = bucket
        self.fetch = fetch

    # ---------------------------------------------------------------------------------------
    # Storage
    # ---------------------------------------------------------------------------------------

    def _require_store(self) -> Tuple[ObjectStore, str]:
        if self.store is None or not self.bucket:
            raise AppShareError(
                "storage_unavailable", "File storage is not configured."
            )
        return self.store, self.bucket

    def _snapshot_key(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        app_path: str,
        snapshot: str,
        path: str = "",
    ) -> str:
        return self.mounts_service.share_storage_key(
            project_id=project_id,
            mount_id=mount_id,
            path=f"apps/{app_path}/{snapshot}/{path}",
        )

    async def _write_snapshot(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        app_path: str,
        snapshot: str,
        contents: List[bytes],
        manifest: ShareManifest,
    ) -> None:
        """Every blob of one publish, then its manifest, all under the publish's own folder."""
        store, bucket = self._require_store()
        gate = asyncio.Semaphore(STORE_CONCURRENCY)

        async def put(key: str, body: bytes) -> None:
            async with gate:
                await store.put_object(bucket=bucket, key=key, body=body)

        blobs = {hashlib.sha256(c).hexdigest(): c for c in contents}
        await asyncio.gather(
            *(
                put(
                    self._snapshot_key(
                        project_id=project_id,
                        mount_id=mount_id,
                        app_path=app_path,
                        snapshot=snapshot,
                        path=f"blobs/{sha}",
                    ),
                    body,
                )
                for sha, body in blobs.items()
            )
        )
        await put(
            self._snapshot_key(
                project_id=project_id,
                mount_id=mount_id,
                app_path=app_path,
                snapshot=snapshot,
                path="manifest.json",
            ),
            manifest.model_dump_json().encode(),
        )

    async def _read_manifest(
        self, *, project_id: UUID, mount_id: UUID, app_path: str, snapshot: str
    ) -> ShareManifest:
        store, bucket = self._require_store()
        key = self._snapshot_key(
            project_id=project_id,
            mount_id=mount_id,
            app_path=app_path,
            snapshot=snapshot,
            path="manifest.json",
        )
        try:
            return ShareManifest.model_validate_json(
                await store.get_object(bucket=bucket, key=key)
            )
        except Exception as exc:  # noqa: BLE001 - missing or unreadable is the same answer
            raise AppShareError(
                "storage_unavailable", "This app could not be loaded."
            ) from exc

    async def _delete_snapshot(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        app_path: str,
        snapshot: Optional[str],
    ) -> None:
        """Best effort: a folder left behind is removed with the session."""
        if snapshot is None:
            return
        store, bucket = self._require_store()
        try:
            await store.delete_prefix(
                bucket=bucket,
                prefix=self._snapshot_key(
                    project_id=project_id,
                    mount_id=mount_id,
                    app_path=app_path,
                    snapshot=snapshot,
                ),
            )
        except Exception:  # noqa: BLE001
            log.warning(
                "app share: could not remove snapshot %s", snapshot, exc_info=True
            )

    # ---------------------------------------------------------------------------------------
    # Owner side
    # ---------------------------------------------------------------------------------------

    async def _shareable_mount(self, *, project_id: UUID, mount_id: UUID) -> Mount:
        mount = await self.mounts_service.fetch_mount_for_share(
            project_id=project_id, mount_id=mount_id
        )
        if mount is None:
            raise AppShareError("not_found", "Drive not found.")
        if self.mounts_service.share_drive_kind(mount) is None:
            raise AppShareError(
                "not_shareable",
                "Only apps in a chat's working drive or its agent's drive can be shared.",
            )
        await self._refuse_if_archived(project_id=project_id, mount=mount)
        return mount

    async def _refuse_if_archived(self, *, project_id: UUID, mount: Mount) -> None:
        if not await self.mounts_service.is_drive_archived(
            project_id=project_id, mount=mount
        ):
            return
        if self.mounts_service.share_drive_kind(mount) == "agent":
            raise AppShareError(
                "agent_archived",
                "This agent is archived. Unarchive it to share its apps.",
            )
        raise AppShareError(
            "session_archived",
            "This session is archived. Unarchive it to share its apps.",
        )

    async def fetch_share(
        self, *, project_id: UUID, mount_id: UUID, path: str
    ) -> Optional[AppShare]:
        app_path = _app_path(path)
        mount = await self.mounts_service.fetch_mount_for_share(
            project_id=project_id, mount_id=mount_id
        )
        if mount is None:
            raise AppShareError("not_found", "Drive not found.")
        return mount.data.shares.get(app_path)

    def link_token(
        self, *, project_id: UUID, mount_id: UUID, path: str, share: AppShare
    ) -> str:
        try:
            return share_token.mint(
                project_id=project_id,
                mount_id=mount_id,
                app_path=_app_path(path),
                nonce=share.nonce,
            )
        except share_token.SharingDisabled as exc:
            raise AppShareError(
                "sharing_disabled",
                "Sharing is not available: this deployment has no AGENTA_CRYPT_KEY set.",
            ) from exc

    async def _read_app(
        self, *, project_id: UUID, mount: Mount, app_path: str
    ) -> Tuple[Dict[str, Any], Dict[str, LocalFile]]:
        try:
            manifest_text = await self.mounts_service.read_file_bytes(
                project_id=project_id,
                mount_id=mount.id,
                path=f"{app_path}/{APP_MANIFEST_FILENAME}",
            )
        except MountFileNotFound as exc:
            raise AppShareError("not_an_app", "This folder has no app.json.") from exc
        try:
            app_manifest = validate_manifest(manifest_text.decode("utf-8", "replace"))
        except AppsError as exc:
            raise AppShareError("not_an_app", exc.message) from exc

        # The curated flat view: it walks past `.git`, `.gitignore`d folders (`node_modules`) and
        # runner files without listing them, and drops dotfiles, so an `.env` never reaches a link.
        listing = await self.mounts_service.list_files(
            project_id=project_id,
            mount_id=mount.id,
            path=app_path,
            order="path",
            git_aware=True,
        )
        prefix = f"{app_path}/"
        entries = [
            f for f in listing.files if not f.is_folder and f.path.startswith(prefix)
        ]
        # A subfolder with its own app.json is a different app.
        nested = {
            posixpath.dirname(f.path)
            for f in entries
            if posixpath.basename(f.path) == APP_MANIFEST_FILENAME
            and posixpath.dirname(f.path) != app_path
        }
        entries = [
            f
            for f in entries
            if not any(f.path == n or f.path.startswith(f"{n}/") for n in nested)
        ]

        if len(entries) > MAX_FILES:
            raise AppShareError(
                "too_large",
                f"This app has {len(entries)} files. A share holds at most {MAX_FILES}.",
                details={"limit": "files", "max": MAX_FILES},
            )
        for entry in entries:
            if (entry.size or 0) > MAX_FILE_BYTES:
                raise AppShareError(
                    "too_large",
                    f"{entry.path[len(prefix) :]} is over the 5 MB limit for one file.",
                    details={"limit": "file_size", "max": MAX_FILE_BYTES},
                )
        if sum(entry.size or 0 for entry in entries) > MAX_TOTAL_BYTES:
            raise AppShareError(
                "too_large",
                "This app is over the 25 MB limit for a share.",
                details={"limit": "total_size", "max": MAX_TOTAL_BYTES},
            )
        contents = await self.mounts_service.read_files_bytes(
            project_id=project_id,
            mount_id=mount.id,
            paths=[entry.path for entry in entries],
        )
        files: Dict[str, LocalFile] = {}
        for path, content in contents.items():
            relative = path[len(prefix) :]
            files[relative] = LocalFile(
                path=relative, content=content, content_type=_content_type(relative)
            )
        return app_manifest, files

    async def publish(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        mount_id: UUID,
        path: str,
        visibility: Optional[Visibility] = None,
    ) -> PublishResult:
        app_path = _app_path(path)
        mount = await self._shareable_mount(project_id=project_id, mount_id=mount_id)
        # Fail before any work when links cannot be issued at all.
        if is_default_crypt_key():
            raise AppShareError(
                "sharing_disabled",
                "Sharing is not available: this deployment has no AGENTA_CRYPT_KEY set.",
            )
        app_manifest, files = await self._read_app(
            project_id=project_id, mount=mount, app_path=app_path
        )

        local_bytes = sum(len(f.content) for f in files.values())
        captured = await capture(
            files=files,
            byte_budget=MAX_TOTAL_BYTES - local_bytes,
            max_file_bytes=MAX_FILE_BYTES,
            fetch=self.fetch,
        )

        def entry(content: bytes, content_type: str) -> ShareFileEntry:
            return ShareFileEntry(
                sha256=hashlib.sha256(content).hexdigest(),
                size=len(content),
                content_type=content_type,
            )

        now = _now()
        manifest = ShareManifest(
            name=app_manifest["name"],
            entry=app_manifest["entry"],
            kit=app_manifest.get("kit", True),
            created_at=now,
            created_by_id=user_id,
            files={k: entry(f.content, f.content_type) for k, f in files.items()},
            external={
                url: entry(f.content, f.content_type)
                for url, f in captured.external.items()
            },
            refs=captured.refs,
            warnings=captured.warnings,
        )
        snapshot = uuid4().hex
        replaced: List[Optional[str]] = []

        def mutate(locked: Mount, current: Optional[AppShare]) -> AppShare:
            # The capture took a while: the session may have been archived since the first check.
            if locked.deleted_at is not None:
                raise AppShareError(
                    "session_archived",
                    "This session is archived. Unarchive it to share its apps.",
                )
            replaced.append(current.snapshot if current else None)
            if current is None:
                return AppShare(
                    enabled=True,
                    visibility=visibility or "workspace",
                    nonce=secrets.token_urlsafe(16),
                    snapshot=snapshot,
                    created_by_id=user_id,
                    created_at=now,
                    updated_at=now,
                )
            return current.model_copy(
                update={
                    # Sharing again after a stop mints a new link; the old one stays dead.
                    "nonce": current.nonce
                    if current.enabled
                    else secrets.token_urlsafe(16),
                    "enabled": True,
                    "visibility": visibility or current.visibility,
                    "snapshot": snapshot,
                    "updated_at": now,
                }
            )

        where = dict(project_id=project_id, mount_id=mount.id, app_path=app_path)
        try:
            await self._write_snapshot(
                **where,
                snapshot=snapshot,
                contents=[f.content for f in files.values()]
                + [f.content for f in captured.external.values()],
                manifest=manifest,
            )
            # The agent may have been archived during the capture; a session drive is rechecked
            # under the row lock below.
            await self._refuse_if_archived(project_id=project_id, mount=mount)
            share = await self.mounts_service.update_app_share(
                project_id=project_id, mount_id=mount.id, path=app_path, mutate=mutate
            )
            if share is None:
                raise AppShareError("not_found", "Drive not found.")
        except Exception:
            await self._delete_snapshot(**where, snapshot=snapshot)
            raise
        await self._delete_snapshot(**where, snapshot=replaced[0])
        return PublishResult(
            share=share,
            token=self.link_token(
                project_id=project_id, mount_id=mount.id, path=app_path, share=share
            ),
            external_failed=captured.failed,
            warnings=captured.warnings,
        )

    async def edit(
        self,
        *,
        project_id: UUID,
        mount_id: UUID,
        path: str,
        visibility: Visibility,
    ) -> AppShare:
        app_path = _app_path(path)
        mount = await self._shareable_mount(project_id=project_id, mount_id=mount_id)

        def mutate(_mount: Mount, current: Optional[AppShare]) -> AppShare:
            if current is None or not current.enabled:
                raise AppShareError("share_not_found", "This app is not shared.")
            return current.model_copy(
                update={"visibility": visibility, "updated_at": _now()}
            )

        share = await self.mounts_service.update_app_share(
            project_id=project_id, mount_id=mount.id, path=app_path, mutate=mutate
        )
        if share is None:
            raise AppShareError("not_found", "Drive not found.")
        return share

    async def stop(
        self, *, project_id: UUID, mount_id: UUID, path: str
    ) -> Optional[AppShare]:
        app_path = _app_path(path)
        mount = await self.mounts_service.fetch_mount_for_share(
            project_id=project_id, mount_id=mount_id
        )
        if mount is None:
            raise AppShareError("not_found", "Drive not found.")

        replaced: List[Optional[str]] = []

        def mutate(_mount: Mount, current: Optional[AppShare]) -> Optional[AppShare]:
            if current is None:
                return None
            replaced.append(current.snapshot)
            return current.model_copy(
                update={"enabled": False, "snapshot": None, "updated_at": _now()}
            )

        share = await self.mounts_service.update_app_share(
            project_id=project_id, mount_id=mount.id, path=app_path, mutate=mutate
        )
        # A stopped share keeps its settings, not its files: sharing again publishes anew.
        if replaced:
            await self._delete_snapshot(
                project_id=project_id,
                mount_id=mount.id,
                app_path=app_path,
                snapshot=replaced[0],
            )
        return share

    # ---------------------------------------------------------------------------------------
    # Viewer side
    # ---------------------------------------------------------------------------------------

    async def open_shared_app(self, *, token: str) -> SharedAppSnapshot:
        """Check the token, the drive, and the share. The caller checks who the viewer is."""
        try:
            claims = share_token.parse(token)
        except share_token.SharingDisabled as exc:
            raise AppShareError(
                "sharing_disabled", "Sharing is not available."
            ) from exc
        except share_token.ShareTokenInvalid as exc:
            raise AppShareError("share_not_found", "This link does not work.") from exc

        mount = await self.mounts_service.fetch_mount_for_share(
            project_id=claims.project_id, mount_id=claims.mount_id
        )
        if mount is None:
            raise AppShareError("share_not_found", "This link does not work.")
        if await self.mounts_service.is_drive_archived(
            project_id=claims.project_id, mount=mount
        ):
            raise AppShareError(
                "share_unavailable",
                "This app is paused because its chat or agent is archived.",
            )
        share = mount.data.shares.get(claims.app_path)
        if (
            share is None
            or not share.enabled
            or share.snapshot is None
            or not secrets.compare_digest(share.nonce, claims.nonce)
        ):
            raise AppShareError("share_not_found", "This link does not work.")

        manifest = await self._read_manifest(
            project_id=claims.project_id,
            mount_id=mount.id,
            app_path=claims.app_path,
            snapshot=share.snapshot,
        )
        return SharedAppSnapshot(
            project_id=claims.project_id,
            mount=mount,
            app_path=claims.app_path,
            share=share,
            manifest=manifest,
        )

    async def iter_blobs(
        self, snapshot: SharedAppSnapshot, section: Literal["files", "external"]
    ) -> AsyncIterator[Tuple[str, ShareFileEntry, bytes]]:
        """Each entry of one manifest section with its bytes, in order, a few reads ahead."""
        store, bucket = self._require_store()
        entries = (
            snapshot.manifest.files
            if section == "files"
            else snapshot.manifest.external
        )
        async for (key, entry), content in read_in_order(
            store,
            bucket=bucket,
            items=(
                (
                    (key, entry),
                    self._snapshot_key(
                        project_id=snapshot.project_id,
                        mount_id=snapshot.mount.id,
                        app_path=snapshot.app_path,
                        snapshot=snapshot.share.snapshot or "",
                        path=f"blobs/{entry.sha256}",
                    ),
                )
                for key, entry in entries.items()
            ),
            window=STORE_CONCURRENCY,
        ):
            yield key, entry, content
