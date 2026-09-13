"""Extraction safety: the download cap bounds compressed bytes only, so expansion
gets its own rejection paths (member count, uncompressed size, unsafe paths)."""

import io
import tarfile
from pathlib import Path

import pytest

from oss.src.core.skills.exceptions import (
    SkillSourceFetchError,
    SkillSourceTooLargeError,
)
import oss.src.core.skills.fetcher as fetcher_module
from oss.src.core.skills.fetcher import (
    MAX_ARCHIVE_MEMBERS,
    extract_tarball,
    make_workdir,
)


def _tarball(entries: list[tuple[str, bytes]]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, content in entries:
            info = tarfile.TarInfo(name=name)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def test_extracts_a_normal_archive():
    payload = _tarball([("repo-abc1234/SKILL.md", b"---\nname: x\n---\nbody\n")])
    with make_workdir() as workdir:
        root = extract_tarball(payload, dest=Path(workdir))
        assert (root / "SKILL.md").exists()


def test_rejects_oversized_expansion(monkeypatch):
    # Small real archive, tiny patched cap — proves the cumulative-size gate fires
    # from member headers before extraction.
    monkeypatch.setattr(fetcher_module, "MAX_UNCOMPRESSED_BYTES", 10)
    payload = _tarball([("repo-abc1234/a.txt", b"x" * 64)])
    with make_workdir() as workdir:
        with pytest.raises(SkillSourceTooLargeError):
            extract_tarball(payload, dest=Path(workdir))


def test_rejects_too_many_members():
    payload = _tarball(
        [(f"repo-abc1234/f{i}.txt", b"x") for i in range(MAX_ARCHIVE_MEMBERS + 1)]
    )
    with make_workdir() as workdir:
        with pytest.raises(SkillSourceTooLargeError):
            extract_tarball(payload, dest=Path(workdir))


def test_rejects_traversal_paths():
    payload = _tarball([("../evil.txt", b"x")])
    with make_workdir() as workdir:
        with pytest.raises(SkillSourceFetchError):
            extract_tarball(payload, dest=Path(workdir))
