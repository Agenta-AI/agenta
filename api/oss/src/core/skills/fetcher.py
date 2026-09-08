"""Shared archive safety rails for catalog providers: bounded tarball
extraction (path-traversal rejection, member-count and uncompressed-size
ceilings) and the scan workdir. Provider-specific fetching lives in
`providers/` — this module knows nothing about where an archive came from.
"""

import io
import re
import tarfile
import tempfile
from pathlib import Path
from typing import Optional

from oss.src.core.skills.exceptions import (
    SkillSourceFetchError,
    SkillSourceTooLargeError,
)

# Decompression-bomb bounds: the download cap limits COMPRESSED bytes only, so
# expansion gets its own ceilings before anything touches the disk.
MAX_ARCHIVE_MEMBERS = 20_000
MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024


def extract_tarball(payload: bytes, *, dest: Path) -> Path:
    """Extract safely (no absolute paths / traversal / decompression bombs) and
    return the tree root.

    GitHub tarballs wrap everything in one `<owner>-<repo>-<sha>/` directory;
    when exactly one top-level directory exists, it IS the root.
    """
    try:
        with tarfile.open(fileobj=io.BytesIO(payload), mode="r:*") as tar:
            members = tar.getmembers()
            if len(members) > MAX_ARCHIVE_MEMBERS:
                raise SkillSourceTooLargeError(
                    f"The archive holds more than {MAX_ARCHIVE_MEMBERS} entries "
                    "and was rejected.",
                )
            total = 0
            for member in members:
                member_path = Path(member.name)
                if member_path.is_absolute() or ".." in member_path.parts:
                    raise SkillSourceFetchError(
                        "The archive contains unsafe paths and was rejected.",
                    )
                total += max(member.size, 0)
                if total > MAX_UNCOMPRESSED_BYTES:
                    raise SkillSourceTooLargeError(
                        "The archive expands beyond the "
                        f"{MAX_UNCOMPRESSED_BYTES // (1024 * 1024)} MB extraction cap.",
                    )
            tar.extractall(dest, filter="data")
    except tarfile.TarError as e:
        raise SkillSourceFetchError(
            f"The downloaded archive could not be extracted: {e}.",
        ) from e

    entries = [p for p in dest.iterdir() if not p.name.startswith(".")]
    if len(entries) == 1 and entries[0].is_dir():
        return entries[0]
    return dest


def sha_from_extracted_root(*, extracted: Path) -> Optional[str]:
    entries = [p for p in extracted.iterdir() if p.is_dir()]
    if len(entries) == 1:
        tail = entries[0].name.rsplit("-", 1)[-1]
        if re.fullmatch(r"[0-9a-f]{7,40}", tail):
            return tail
    return None


def make_workdir() -> tempfile.TemporaryDirectory:
    return tempfile.TemporaryDirectory(prefix="agenta-skill-import-")
