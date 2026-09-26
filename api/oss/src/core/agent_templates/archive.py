"""Bounded package staging shared by every template source that is not bundled.

Uploaded zips, zips in session files, and later GitHub directories all reach the
parser through one ``PackageTreeWriter``. The writer applies the package path and
byte rules while bytes arrive, so no source can hand the parser a tree that the
bundled catalog could not contain. Declared zip sizes are never trusted: every
limit counts the bytes actually read.
"""

import io
import stat
import unicodedata
import zipfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

from oss.src.core.agent_templates.exceptions import TemplateSourceInvalid

_READ_CHUNK_BYTES = 64 * 1024
# macOS Finder adds resource forks under this folder when it compresses a folder.
_IGNORED_ARCHIVE_ROOTS = {"__MACOSX"}
_ZIP_ENCRYPTED_FLAG = 0x1
_ZIP_UNIX_SYSTEM = 3
# Common filesystem name limit; longer names fail on write with a host-path error.
_MAX_SEGMENT_BYTES = 255


@dataclass(frozen=True)
class PackageLimits:
    # The same bounds the bundled catalog enforces through ``package_digest``.
    max_files: int = 256
    max_total_bytes: int = 4 * 1024 * 1024
    max_file_bytes: int = 1024 * 1024
    max_path_segments: int = 12
    # Transfer bound for the archive itself, checked before it is opened.
    max_archive_bytes: int = 5 * 1024 * 1024
    # Directory entries count too, so an archive cannot list unbounded folders.
    max_archive_entries: int = 1024


def _invalid(code: str, message: str, **details: object) -> TemplateSourceInvalid:
    return TemplateSourceInvalid(code, message, details=details or None)


def _unsafe(name: str) -> TemplateSourceInvalid:
    return _invalid(
        "template_archive_path_unsafe",
        "The archive contains a path that could leave the package folder.",
        path=name[:256],
    )


def _unwritable(name: str) -> TemplateSourceInvalid:
    # The OS error names the host temp path, so it is not passed on.
    return _invalid(
        "template_archive_invalid",
        "A path in the archive cannot be stored.",
        path=name[:256],
    )


def _member_parts(name: str) -> tuple[str, ...]:
    """Split one archive name into safe POSIX parts, or refuse it.

    The rules refuse anything a different extractor could place outside the
    package: absolute paths, drive letters, backslashes, NUL and control
    characters, and empty, ``.`` or ``..`` segments.
    """
    if (
        not name
        or "\\" in name
        or any(ord(char) < 32 or ord(char) == 127 for char in name)
    ):
        raise _unsafe(name)
    trimmed = name[:-1] if name.endswith("/") else name
    if not trimmed or trimmed.startswith("/"):
        raise _unsafe(name)
    parts = tuple(trimmed.split("/"))
    if any(
        part in {"", ".", ".."} or len(part.encode("utf-8")) > _MAX_SEGMENT_BYTES
        for part in parts
    ):
        raise _unsafe(name)
    if len(parts[0]) == 2 and parts[0][1] == ":" and parts[0][0].isalpha():
        raise _unsafe(name)
    return parts


def _collision_key(parts: tuple[str, ...]) -> str:
    # Two names that one filesystem would store as the same file are duplicates.
    return unicodedata.normalize("NFC", "/".join(parts)).casefold()


class PackageTreeWriter:
    """Write package files into a fresh directory under strict limits.

    Paths are checked before anything touches the disk. Sizes are counted from the
    bytes written. Files are written without execute bits. The writer allows one
    extra leading folder, because zipping a folder usually wraps its contents in
    that folder, and ``finish`` removes that wrapper.
    """

    def __init__(
        self, destination: Path, *, limits: PackageLimits | None = None
    ) -> None:
        self._root = destination
        self._limits = limits or PackageLimits()
        self._root.mkdir(mode=0o700, parents=True, exist_ok=False)
        self._files: set[str] = set()
        self._directories: set[str] = set()
        self._total_bytes = 0

    @property
    def limits(self) -> PackageLimits:
        return self._limits

    def _claim(self, name: str, *, directory: bool) -> tuple[str, ...]:
        parts = _member_parts(name)
        # One wrapper folder may precede the package's own depth limit.
        if len(parts) > self._limits.max_path_segments + 1:
            raise _invalid(
                "template_source_limit_exceeded",
                "A template package path is too deep.",
                path=name[:256],
                limit=self._limits.max_path_segments,
            )
        key = _collision_key(parts)
        for depth in range(1, len(parts)):
            if _collision_key(parts[:depth]) in self._files:
                raise _invalid(
                    "template_archive_duplicate_path",
                    "The archive uses one path as both a file and a folder.",
                    path=name[:256],
                )
        if key in self._files or (not directory and key in self._directories):
            raise _invalid(
                "template_archive_duplicate_path",
                "The archive contains the same path more than once.",
                path=name[:256],
            )
        for depth in range(1, len(parts) + (1 if directory else 0)):
            self._directories.add(_collision_key(parts[:depth]))
        return parts

    def add_directory(self, name: str) -> None:
        parts = self._claim(name, directory=True)
        try:
            self._root.joinpath(*parts).mkdir(mode=0o700, parents=True, exist_ok=True)
        except OSError as exc:
            raise _unwritable(name) from exc

    def write_file(self, name: str, chunks: Iterable[bytes]) -> None:
        parts = self._claim(name, directory=False)
        if len(self._files) >= self._limits.max_files:
            raise _invalid(
                "template_source_limit_exceeded",
                "The template package contains too many files.",
                limit=self._limits.max_files,
            )
        self._files.add(_collision_key(parts))

        target = self._root.joinpath(*parts)
        try:
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            # "x" refuses to follow or replace anything already at the path.
            handle = target.open("xb")
        except OSError as exc:
            raise _unwritable(name) from exc
        size = 0
        with handle:
            for chunk in chunks:
                size += len(chunk)
                self._total_bytes += len(chunk)
                if size > self._limits.max_file_bytes:
                    raise _invalid(
                        "template_source_limit_exceeded",
                        "A template package file is too large.",
                        path="/".join(parts),
                        limit=self._limits.max_file_bytes,
                    )
                if self._total_bytes > self._limits.max_total_bytes:
                    raise _invalid(
                        "template_source_limit_exceeded",
                        "The template package is too large.",
                        limit=self._limits.max_total_bytes,
                    )
                handle.write(chunk)
        target.chmod(0o600)

    def finish(self) -> Path:
        """Return the package root, removing one wrapper folder if present."""
        if (self._root / "plugin.json").is_file():
            return self._root
        children = list(self._root.iterdir())
        if (
            len(children) == 1
            and children[0].is_dir()
            and not children[0].is_symlink()
            and (children[0] / "plugin.json").is_file()
        ):
            return children[0]
        return self._root


def _is_link_or_special(info: zipfile.ZipInfo) -> bool:
    if info.create_system != _ZIP_UNIX_SYSTEM:
        return False
    file_type = stat.S_IFMT(info.external_attr >> 16)
    return file_type not in (0, stat.S_IFREG, stat.S_IFDIR)


def extract_zip(data: bytes, writer: PackageTreeWriter) -> None:
    """Stream one zip's regular files and folders into the writer."""
    limits = writer.limits
    if len(data) > limits.max_archive_bytes:
        raise _invalid(
            "template_archive_too_large",
            "The template archive is too large.",
            limit=limits.max_archive_bytes,
        )
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except (zipfile.BadZipFile, zipfile.LargeZipFile, ValueError, EOFError) as exc:
        raise _invalid(
            "template_archive_invalid",
            "The file is not a readable zip archive.",
        ) from exc

    with archive:
        members = archive.infolist()
        if len(members) > limits.max_archive_entries:
            raise _invalid(
                "template_source_limit_exceeded",
                "The template archive contains too many entries.",
                limit=limits.max_archive_entries,
            )
        for info in members:
            name = info.filename
            if name.split("/", 1)[0] in _IGNORED_ARCHIVE_ROOTS:
                continue
            if _is_link_or_special(info):
                raise _invalid(
                    "template_archive_entry_unsupported",
                    "The archive can contain only regular files and folders.",
                    path=name[:256],
                )
            if info.flag_bits & _ZIP_ENCRYPTED_FLAG:
                raise _invalid(
                    "template_archive_entry_unsupported",
                    "The archive cannot contain encrypted files.",
                    path=name[:256],
                )
            if info.is_dir():
                writer.add_directory(name)
                continue
            try:
                with archive.open(info) as member:
                    writer.write_file(
                        name,
                        iter(lambda: member.read(_READ_CHUNK_BYTES), b""),
                    )
            except TemplateSourceInvalid:
                raise
            except (
                zipfile.BadZipFile,
                zlib.error,
                EOFError,
                NotImplementedError,
                RuntimeError,
                ValueError,
            ) as exc:
                raise _invalid(
                    "template_archive_invalid",
                    "A file in the archive is damaged or uses an unsupported format.",
                    path=name[:256],
                ) from exc
