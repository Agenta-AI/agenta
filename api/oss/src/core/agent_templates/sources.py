import hashlib
import json
import re
from contextlib import asynccontextmanager
from pathlib import Path, PurePosixPath
from tempfile import TemporaryDirectory
from typing import AsyncIterator, Mapping
from uuid import UUID

from oss.src.core.agent_templates.archive import (
    PackageLimits,
    PackageTreeWriter,
    extract_zip,
)
from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
    SessionFileTemplateSource,
    TemplateSource,
    TemplateSourcePin,
    UploadTemplateSource,
)
from oss.src.core.agent_templates.exceptions import (
    TemplatePackageInvalid,
    TemplateSourceDigestMismatch,
    TemplateSourceInvalid,
    TemplateSourceNotFound,
)
from oss.src.core.agent_templates.interfaces import TemplatePackageStager
from oss.src.core.mounts.dtos import MountQuery
from oss.src.core.mounts.service import MountsService
from oss.src.core.mounts.types import MountFileNotFound, MountPathInvalid
from oss.src.core.sessions.attachments.service import SessionAttachmentsService
from oss.src.core.sessions.attachments.types import AttachmentError

_MAX_FILES = 256
_MAX_TOTAL_BYTES = 4 * 1024 * 1024
_MAX_FILE_BYTES = 1024 * 1024
_MAX_PATH_SEGMENTS = 12


def _invalid(code: str, message: str, **details: object) -> TemplateSourceInvalid:
    return TemplateSourceInvalid(code, message, details=details or None)


def confined_child(parent: Path, relative: str) -> Path:
    relative_path = PurePosixPath(relative)
    if (
        not relative
        or relative_path.is_absolute()
        or "\\" in relative
        or any(part in {"", ".", ".."} for part in relative_path.parts)
    ):
        raise _invalid(
            "template_source_path_invalid",
            "The template catalog contains an invalid package path.",
        )

    try:
        parent_root = parent.resolve(strict=True)
        candidate = parent_root.joinpath(*relative_path.parts)
        current = parent_root
        for part in relative_path.parts:
            current = current / part
            if current.is_symlink():
                raise _invalid(
                    "template_source_symlink",
                    "Template package paths cannot be symbolic links.",
                )
        resolved = candidate.resolve(strict=True)
        resolved.relative_to(parent_root)
    except (FileNotFoundError, RuntimeError, ValueError) as exc:
        raise _invalid(
            "template_source_path_invalid",
            "The template package path is unavailable or leaves the catalog directory.",
        ) from exc

    if not resolved.is_dir():
        raise _invalid(
            "template_source_path_invalid",
            "The template package path must identify a directory.",
        )
    return resolved


def package_digest(root: Path) -> str:
    if root.is_symlink() or not root.is_dir():
        raise _invalid(
            "template_source_path_invalid",
            "The template package root must be a regular directory.",
        )

    files: list[tuple[str, Path]] = []
    for path in root.rglob("*"):
        if path.is_symlink():
            raise _invalid(
                "template_source_symlink",
                "Template packages cannot contain symbolic links.",
                path=path.relative_to(root).as_posix(),
            )
        if path.is_dir():
            continue
        if not path.is_file():
            raise _invalid(
                "template_source_file_invalid",
                "Template packages can contain only regular files and directories.",
                path=path.relative_to(root).as_posix(),
            )
        relative = path.relative_to(root).as_posix()
        if len(PurePosixPath(relative).parts) > _MAX_PATH_SEGMENTS:
            raise _invalid(
                "template_source_limit_exceeded",
                "A template package path is too deep.",
                path=relative,
            )
        files.append((relative, path))

    files.sort(key=lambda item: item[0])
    if len(files) > _MAX_FILES:
        raise _invalid(
            "template_source_limit_exceeded",
            "The template package contains too many files.",
            limit=_MAX_FILES,
        )

    digest = hashlib.sha256()
    total_bytes = 0
    for relative, path in files:
        content = path.read_bytes()
        size = len(content)
        if size > _MAX_FILE_BYTES:
            raise _invalid(
                "template_source_limit_exceeded",
                "A template package file is too large.",
                path=relative,
                limit=_MAX_FILE_BYTES,
            )
        total_bytes += size
        if total_bytes > _MAX_TOTAL_BYTES:
            raise _invalid(
                "template_source_limit_exceeded",
                "The template package is too large.",
                limit=_MAX_TOTAL_BYTES,
            )
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")

    return f"sha256:{digest.hexdigest()}"


class InternalTemplateSourceResolver:
    def __init__(self, *, catalog_path: Path) -> None:
        self._catalog_path = catalog_path

    def _read_catalog(self) -> dict:
        try:
            value = json.loads(self._catalog_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise _invalid(
                "template_source_catalog_invalid",
                "The internal template catalog is invalid.",
            ) from exc
        if not isinstance(value, dict):
            raise _invalid(
                "template_source_catalog_invalid",
                "The internal template catalog must be an object.",
            )
        return value

    async def resolve(
        self,
        *,
        source: InternalTemplateSource,
        pin: TemplateSourcePin | None = None,
    ) -> ResolvedTemplateSource:
        catalog = self._read_catalog()
        record = catalog.get(source.key)
        if not isinstance(record, dict):
            raise TemplateSourceNotFound(source.key)

        version = pin.version if pin else record.get("latest")
        versions = record.get("versions")
        if not isinstance(version, str) or not isinstance(versions, dict):
            raise _invalid(
                "template_source_catalog_invalid",
                "The internal template catalog entry is invalid.",
                key=source.key,
            )

        relative = versions.get(version)
        if not isinstance(relative, str):
            raise TemplateSourceNotFound(f"{source.key}@{version}")

        root = confined_child(self._catalog_path.parent, relative)
        digest = package_digest(root)
        if pin and digest != pin.digest:
            raise TemplateSourceDigestMismatch(source.key, version)

        return ResolvedTemplateSource(
            source=source,
            root=root,
            version=version,
            digest=digest,
        )


_PACKAGE_KEY = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
_SESSION_CWD_MOUNT_NAME = "cwd"


def read_plugin_identity(root: Path) -> tuple[str, str]:
    """The package name and version a staged package declares in plugin.json.

    The parser validates the full manifest later. Staging only needs the two
    values that identify the package before the parser runs.
    """
    path = root / "plugin.json"
    if path.is_symlink() or not path.is_file():
        raise TemplatePackageInvalid(
            "plugin_manifest_invalid",
            "plugin.json is missing from the package root.",
            details={"path": "plugin.json"},
        )
    try:
        plugin = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise TemplatePackageInvalid(
            "plugin_manifest_invalid",
            "plugin.json is missing or invalid JSON.",
            details={"path": "plugin.json"},
        ) from exc
    name = plugin.get("name") if isinstance(plugin, dict) else None
    version = plugin.get("version") if isinstance(plugin, dict) else None
    if not isinstance(name, str) or not _PACKAGE_KEY.fullmatch(name):
        raise TemplatePackageInvalid(
            "plugin_name_invalid",
            "plugin.json needs a lowercase kebab-case name.",
            details={"path": "plugin.json", "field": "name"},
        )
    if not isinstance(version, str) or not version or len(version) > 128:
        raise TemplatePackageInvalid(
            "plugin_version_invalid",
            "plugin.json needs a version.",
            details={"path": "plugin.json", "field": "version"},
        )
    return name, version


class StagedTemplateSourceResolver:
    """The one bounded resolver for every source that is not the bundled catalog.

    A source adapter authorizes and transports bytes into a ``PackageTreeWriter``.
    This resolver owns the temporary directory, identity, digest and pin check, so
    uploads, session files and later GitHub directories behave the same way.
    """

    def __init__(
        self,
        *,
        stagers: Mapping[str, TemplatePackageStager],
        limits: PackageLimits | None = None,
    ) -> None:
        self._stagers = dict(stagers)
        self._limits = limits or PackageLimits()

    @asynccontextmanager
    async def open(
        self,
        *,
        project_id: UUID,
        source: TemplateSource,
        pin: TemplateSourcePin | None = None,
    ) -> AsyncIterator[ResolvedTemplateSource]:
        stager = self._stagers.get(source.kind)
        if stager is None:
            raise TemplateSourceInvalid(
                "template_source_unsupported",
                "This template source kind is not supported here.",
                details={"kind": source.kind},
            )
        if pin is None and isinstance(source, SessionFileTemplateSource):
            pin = source.pin

        with TemporaryDirectory(prefix="agenta-template-") as directory:
            writer = PackageTreeWriter(
                Path(directory) / "package",
                limits=self._limits,
            )
            await stager.stage(project_id=project_id, source=source, writer=writer)
            root = writer.finish()
            key, version = read_plugin_identity(root)
            digest = package_digest(root)
            if pin and (pin.version != version or pin.digest != digest):
                raise TemplateSourceDigestMismatch(key, pin.version)
            yield ResolvedTemplateSource(
                source=source,
                root=root,
                version=version,
                digest=digest,
                package_key=key,
            )


class UploadArchiveStager:
    """Read a zip from a ready attachment in the project's staging session."""

    def __init__(self, *, attachments_service: SessionAttachmentsService) -> None:
        self._attachments = attachments_service

    async def stage(
        self,
        *,
        project_id: UUID,
        source: TemplateSource,
        writer: PackageTreeWriter,
    ) -> None:
        if not isinstance(source, UploadTemplateSource):
            raise TypeError("UploadArchiveStager stages upload sources only.")
        not_found = TemplateSourceNotFound(f"upload:{source.attachment_id}")
        try:
            attachment = await self._attachments.fetch_attachment(
                project_id=project_id,
                session_id=source.staging_session_id,
                attachment_id=source.attachment_id,
            )
            # Check the recorded size before the bytes are read into memory.
            if attachment.size > writer.limits.max_archive_bytes:
                raise _invalid(
                    "template_archive_too_large",
                    "The template archive is too large.",
                    limit=writer.limits.max_archive_bytes,
                )
            content = await self._attachments.fetch_attachment_content(
                project_id=project_id,
                session_id=source.staging_session_id,
                attachment_id=source.attachment_id,
            )
        except (AttachmentError, MountFileNotFound) as exc:
            raise not_found from exc
        extract_zip(content.data, writer)


class SessionFileArchiveStager:
    """Read a zip from the session's working directory in this project.

    The lookup is scoped by project, so a session in another project resolves to
    nothing. The client names a drive path, never a server path.
    """

    def __init__(self, *, mounts_service: MountsService) -> None:
        self._mounts = mounts_service

    async def stage(
        self,
        *,
        project_id: UUID,
        source: TemplateSource,
        writer: PackageTreeWriter,
    ) -> None:
        if not isinstance(source, SessionFileTemplateSource):
            raise TypeError("SessionFileArchiveStager stages session files only.")
        mounts = await self._mounts.query_mounts(
            project_id=project_id,
            mount_query=MountQuery(session_id=source.session_id),
        )
        mount = next(
            (
                item
                for item in mounts
                if item.session_id == source.session_id
                and item.name == _SESSION_CWD_MOUNT_NAME
            ),
            None,
        )
        not_found = TemplateSourceNotFound(f"session_file:{source.path}")
        if mount is None or mount.id is None:
            raise not_found
        path = source.path.strip("/")
        limit = writer.limits.max_archive_bytes
        try:
            stat = await self._mounts.stat_file(
                project_id=project_id,
                mount_id=mount.id,
                path=path,
            )
            if stat.size > limit:
                raise _invalid(
                    "template_archive_too_large",
                    "The template archive is too large.",
                    limit=limit,
                )
            data = await self._mounts.read_file_bytes(
                project_id=project_id,
                mount_id=mount.id,
                path=path,
            )
        except MountFileNotFound as exc:
            raise not_found from exc
        except MountPathInvalid as exc:
            raise _invalid(
                "template_source_path_invalid",
                "The session file path must be a relative path inside the session files.",
                path=source.path[:256],
            ) from exc
        extract_zip(data, writer)


class TemplateSources:
    """Dispatch a load or validation source to the bundled catalog or the staged resolver."""

    def __init__(
        self,
        *,
        internal: InternalTemplateSourceResolver,
        staged: StagedTemplateSourceResolver | None = None,
    ) -> None:
        self._internal = internal
        self._staged = staged

    @asynccontextmanager
    async def open(
        self,
        *,
        project_id: UUID,
        source: TemplateSource,
        pin: TemplateSourcePin | None = None,
    ) -> AsyncIterator[ResolvedTemplateSource]:
        if isinstance(source, InternalTemplateSource):
            yield await self._internal.resolve(source=source, pin=pin)
            return
        if self._staged is None:
            raise TemplateSourceInvalid(
                "template_source_unsupported",
                "This template source kind is not supported here.",
                details={"kind": source.kind},
            )
        async with self._staged.open(
            project_id=project_id,
            source=source,
            pin=pin,
        ) as resolved:
            yield resolved
