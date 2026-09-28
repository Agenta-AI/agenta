"""Sharing agent HTML apps: publish a frozen snapshot of an app folder behind a share link.

A share lives in `mounts.data.shares[<app path>]` (settings, versions) plus objects under the
drive's share prefix (content-addressed blobs and one manifest per version). Publishing writes
blobs first, then the manifest, and moves the `latest` pointer last, so a failed publish never
exposes a partial version. Every change to a share entry runs under the drive row's lock.
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
from uuid import UUID

from oss.src.core.apps import share_token
from oss.src.core.apps.service import APP_MANIFEST_FILENAME, AppsError, validate_manifest
from oss.src.core.apps.share_capture import (
    Fetcher,
    LocalFile,
    capture,
    fetch_external,
)
from oss.src.core.apps.share_dtos import ShareFileEntry, ShareIssue, ShareManifest
from oss.src.core.mounts.dtos import AppShare, AppShareVersion, Mount
from oss.src.core.mounts.service import MountsService, validate_file_path
from oss.src.core.mounts.types import MountPathInvalid
from oss.src.core.store.storage import ObjectStore
from oss.src.utils.crypting import is_default_crypt_key

MAX_FILES = 200
MAX_FILE_BYTES = 5 * 1024 * 1024
MAX_TOTAL_BYTES = 25 * 1024 * 1024

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
    version: int
    manifest: ShareManifest


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _content_type(path: str) -> str:
    guessed, _ = mimetypes.guess_type(path)
    return guessed or "application/octet-stream"


def _app_path(path: str) -> str:
    clean = (path or "").strip().strip("/")
    if not clean:
        raise AppShareError("not_shareable", "The drive root is not an app. Share an app folder.")
    try:
        validate_file_path(clean)
    except MountPathInvalid as exc:
        raise AppShareError("not_shareable", exc.message) from exc
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
            raise AppShareError("storage_unavailable", "File storage is not configured.")
        return self.store, self.bucket

    def _blob_key(self, *, project_id: UUID, mount_id: UUID, sha256: str) -> str:
        return self.mounts_service.share_storage_key(
            project_id=project_id, mount_id=mount_id, path=f"blobs/{sha256}"
        )

    def _manifest_key(
        self, *, project_id: UUID, mount_id: UUID, app_path: str, version: int
    ) -> str:
        return self.mounts_service.share_storage_key(
            project_id=project_id,
            mount_id=mount_id,
            path=f"apps/{app_path}/v{version}.json",
        )

    async def _put_blob(self, *, project_id: UUID, mount_id: UUID, content: bytes) -> str:
        store, bucket = self._require_store()
        sha256 = hashlib.sha256(content).hexdigest()
        await store.put_object_if_absent(
            bucket=bucket,
            key=self._blob_key(project_id=project_id, mount_id=mount_id, sha256=sha256),
            body=content,
        )
        return sha256

    async def _read_manifest(
        self, *, project_id: UUID, mount_id: UUID, app_path: str, version: int
    ) -> Optional[ShareManifest]:
        store, bucket = self._require_store()
        key = self._manifest_key(
            project_id=project_id, mount_id=mount_id, app_path=app_path, version=version
        )
        try:
            return ShareManifest.model_validate_json(
                await store.get_object(bucket=bucket, key=key)
            )
        except Exception:  # noqa: BLE001 - a missing or unreadable manifest is no version
            return None

    async def _write_manifest(
        self, *, project_id: UUID, mount_id: UUID, app_path: str, manifest: ShareManifest
    ) -> None:
        store, bucket = self._require_store()
        await store.put_object(
            bucket=bucket,
            key=self._manifest_key(
                project_id=project_id,
                mount_id=mount_id,
                app_path=app_path,
                version=manifest.version,
            ),
            body=manifest.model_dump_json().encode(),
        )

    async def _put_blobs(
        self, *, project_id: UUID, mount_id: UUID, contents: Dict[str, bytes]
    ) -> Dict[str, str]:
        """Key -> sha256 for each content, written with bounded parallelism."""
        gate = asyncio.Semaphore(8)

        async def put(key: str, content: bytes) -> Tuple[str, str]:
            async with gate:
                return key, await self._put_blob(
                    project_id=project_id, mount_id=mount_id, content=content
                )

        return dict(await asyncio.gather(*(put(k, c) for k, c in contents.items())))

    # ---------------------------------------------------------------------------------------
    # Owner side
    # ---------------------------------------------------------------------------------------

    async def _shareable_mount(self, *, project_id: UUID, mount_id: UUID) -> Mount:
        mount = await self.mounts_service.fetch_mount_for_share(
            project_id=project_id, mount_id=mount_id
        )
        if mount is None:
            raise AppShareError("not_found", "Drive not found.")
        if not self.mounts_service.is_session_cwd_mount(mount):
            raise AppShareError(
                "not_shareable", "Only apps in a session's working drive can be shared."
            )
        if mount.deleted_at is not None:
            raise AppShareError(
                "session_archived", "This session is archived. Unarchive it to share its apps."
            )
        return mount

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

    def link_token(self, *, project_id: UUID, mount_id: UUID, path: str, share: AppShare) -> str:
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
        except Exception as exc:  # noqa: BLE001 - the store reports a missing key its own way
            raise AppShareError("not_an_app", "This folder has no app.json.") from exc
        try:
            app_manifest = validate_manifest(manifest_text.decode("utf-8", "replace"))
        except AppsError as exc:
            raise AppShareError("not_an_app", exc.message) from exc

        listing = await self.mounts_service.list_files(
            project_id=project_id, mount_id=mount.id, path=app_path
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
                    f"{entry.path[len(prefix):]} is over the 5 MB limit for one file.",
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

        file_shas = await self._put_blobs(
            project_id=project_id,
            mount_id=mount.id,
            contents={k: v.content for k, v in files.items()},
        )
        external_shas = await self._put_blobs(
            project_id=project_id,
            mount_id=mount.id,
            contents={k: v.content for k, v in captured.external.items()},
        )
        file_map = {
            relative: ShareFileEntry(
                sha256=file_shas[relative],
                size=len(item.content),
                content_type=item.content_type,
            )
            for relative, item in files.items()
        }
        external_map = {
            url: ShareFileEntry(
                sha256=external_shas[url],
                size=len(fetched.content),
                content_type=fetched.content_type,
                final_url=fetched.final_url,
            )
            for url, fetched in captured.external.items()
        }

        now = _now()

        async def mutate(_mount: Mount, current: Optional[AppShare]) -> AppShare:
            version = (current.latest + 1) if current else 1
            await self._write_manifest(
                project_id=project_id,
                mount_id=mount.id,
                app_path=app_path,
                manifest=ShareManifest(
                    version=version,
                    name=app_manifest["name"],
                    entry=app_manifest["entry"],
                    kit=app_manifest.get("kit", True),
                    created_at=now,
                    created_by_id=user_id,
                    files=file_map,
                    external=external_map,
                    refs=captured.refs,
                    warnings=captured.warnings,
                ),
            )
            entry = AppShareVersion(version=version, created_at=now, created_by_id=user_id)
            if current is None:
                return AppShare(
                    enabled=True,
                    visibility=visibility or "workspace",
                    nonce=secrets.token_urlsafe(16),
                    latest=version,
                    versions=[entry],
                    created_by_id=user_id,
                    created_at=now,
                    updated_at=now,
                )
            return current.model_copy(
                update={
                    # Sharing again after a stop mints a new link; the old one stays dead.
                    "nonce": current.nonce if current.enabled else secrets.token_urlsafe(16),
                    "enabled": True,
                    "visibility": visibility or current.visibility,
                    "latest": version,
                    "versions": [*current.versions, entry],
                    "updated_at": now,
                }
            )

        share = await self.mounts_service.update_app_share(
            project_id=project_id, mount_id=mount.id, path=app_path, mutate=mutate
        )
        if share is None:
            raise AppShareError("not_found", "Drive not found.")
        return PublishResult(
            share=share,
            token=self.link_token(
                project_id=project_id, mount_id=mount.id, path=app_path, share=share
            ),
            external_failed=captured.failed,
            warnings=captured.warnings,
        )

    async def restore(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        mount_id: UUID,
        path: str,
        version: int,
    ) -> AppShare:
        app_path = _app_path(path)
        mount = await self._shareable_mount(project_id=project_id, mount_id=mount_id)
        source = await self._read_manifest(
            project_id=project_id, mount_id=mount.id, app_path=app_path, version=version
        )
        if source is None:
            raise AppShareError("version_not_found", f"Version {version} does not exist.")
        now = _now()

        async def mutate(_mount: Mount, current: Optional[AppShare]) -> AppShare:
            if current is None:
                raise AppShareError("share_not_found", "This app is not shared.")
            if version not in {v.version for v in current.versions}:
                raise AppShareError("version_not_found", f"Version {version} does not exist.")
            next_version = current.latest + 1
            await self._write_manifest(
                project_id=project_id,
                mount_id=mount.id,
                app_path=app_path,
                manifest=source.model_copy(
                    update={
                        "version": next_version,
                        "created_at": now,
                        "created_by_id": user_id,
                        "restored_from": version,
                    }
                ),
            )
            return current.model_copy(
                update={
                    "latest": next_version,
                    "versions": [
                        *current.versions,
                        AppShareVersion(
                            version=next_version,
                            created_at=now,
                            created_by_id=user_id,
                            restored_from=version,
                        ),
                    ],
                    "updated_at": now,
                }
            )

        share = await self.mounts_service.update_app_share(
            project_id=project_id, mount_id=mount.id, path=app_path, mutate=mutate
        )
        if share is None:
            raise AppShareError("not_found", "Drive not found.")
        return share

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

        async def mutate(_mount: Mount, current: Optional[AppShare]) -> AppShare:
            if current is None or not current.enabled:
                raise AppShareError("share_not_found", "This app is not shared.")
            return current.model_copy(update={"visibility": visibility, "updated_at": _now()})

        share = await self.mounts_service.update_app_share(
            project_id=project_id, mount_id=mount.id, path=app_path, mutate=mutate
        )
        if share is None:
            raise AppShareError("not_found", "Drive not found.")
        return share

    async def stop(self, *, project_id: UUID, mount_id: UUID, path: str) -> Optional[AppShare]:
        app_path = _app_path(path)
        mount = await self.mounts_service.fetch_mount_for_share(
            project_id=project_id, mount_id=mount_id
        )
        if mount is None:
            raise AppShareError("not_found", "Drive not found.")

        async def mutate(_mount: Mount, current: Optional[AppShare]) -> Optional[AppShare]:
            if current is None:
                return None
            return current.model_copy(update={"enabled": False, "updated_at": _now()})

        return await self.mounts_service.update_app_share(
            project_id=project_id, mount_id=mount.id, path=app_path, mutate=mutate
        )

    # ---------------------------------------------------------------------------------------
    # Viewer side
    # ---------------------------------------------------------------------------------------

    async def open_shared_app(
        self, *, token: str, version: Optional[int] = None
    ) -> SharedAppSnapshot:
        """Check the token, the drive, and the share. The caller checks who the viewer is."""
        try:
            claims = share_token.parse(token)
        except share_token.SharingDisabled as exc:
            raise AppShareError("sharing_disabled", "Sharing is not available.") from exc
        except share_token.ShareTokenInvalid as exc:
            raise AppShareError("share_not_found", "This link does not work.") from exc

        mount = await self.mounts_service.fetch_mount_for_share(
            project_id=claims.project_id, mount_id=claims.mount_id
        )
        if mount is None:
            raise AppShareError("share_not_found", "This link does not work.")
        if mount.deleted_at is not None:
            raise AppShareError(
                "share_unavailable", "This app is paused because its session is archived."
            )
        share = mount.data.shares.get(claims.app_path)
        if (
            share is None
            or not share.enabled
            or not secrets.compare_digest(share.nonce, claims.nonce)
        ):
            raise AppShareError("share_not_found", "This link does not work.")

        shown = version if version is not None else share.latest
        manifest = (
            await self._read_manifest(
                project_id=claims.project_id,
                mount_id=mount.id,
                app_path=claims.app_path,
                version=shown,
            )
            if shown in {v.version for v in share.versions}
            else None
        )
        if manifest is None:
            raise AppShareError("version_not_found", f"Version {shown} does not exist.")
        return SharedAppSnapshot(
            project_id=claims.project_id,
            mount=mount,
            app_path=claims.app_path,
            share=share,
            version=shown,
            manifest=manifest,
        )

    async def iter_blobs(
        self, snapshot: SharedAppSnapshot, section: Literal["files", "external"]
    ) -> AsyncIterator[Tuple[str, ShareFileEntry, bytes]]:
        """Each entry of one manifest section with its bytes, read one blob at a time."""
        store, bucket = self._require_store()
        entries = snapshot.manifest.files if section == "files" else snapshot.manifest.external
        for key, entry in entries.items():
            content = await store.get_object(
                bucket=bucket,
                key=self._blob_key(
                    project_id=snapshot.project_id,
                    mount_id=snapshot.mount.id,
                    sha256=entry.sha256,
                ),
            )
            yield key, entry, content
