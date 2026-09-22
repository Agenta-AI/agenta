import hashlib
import json
from pathlib import Path, PurePosixPath

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    ResolvedTemplateSource,
    TemplateSourcePin,
)
from oss.src.core.agent_templates.exceptions import (
    TemplateSourceDigestMismatch,
    TemplateSourceInvalid,
    TemplateSourceNotFound,
)

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
