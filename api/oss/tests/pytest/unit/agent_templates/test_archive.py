import io
import stat
import zipfile
from pathlib import Path
from uuid import uuid4

import pytest

from oss.src.core.agent_templates.archive import (
    PackageLimits,
    PackageTreeWriter,
    extract_zip,
)
from oss.src.core.agent_templates.dtos import (
    SessionFileTemplateSource,
    TemplateSourcePin,
    UploadTemplateSource,
)
from oss.src.core.agent_templates.exceptions import (
    TemplateSourceDigestMismatch,
    TemplateSourceInvalid,
)
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.sources import (
    StagedTemplateSourceResolver,
    package_digest,
)


FIXTURE = Path(__file__).parent / "fixtures" / "current"
PROJECT_ID = uuid4()


def _fixture_files(prefix: str = "") -> dict[str, bytes]:
    return {
        prefix + path.relative_to(FIXTURE).as_posix(): path.read_bytes()
        for path in sorted(FIXTURE.rglob("*"))
        if path.is_file()
    }


def _zip(
    files: dict[str, bytes], *, infos: list[zipfile.ZipInfo] | None = None
) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
        for info in infos or []:
            archive.writestr(info, b"target")
    return buffer.getvalue()


class _BytesStager:
    def __init__(self, data: bytes) -> None:
        self.data = data
        self.roots: list[Path] = []

    async def stage(self, *, project_id, source, writer):
        extract_zip(self.data, writer)
        self.roots.append(writer.finish())


def _resolver(
    data: bytes, **limits
) -> tuple[StagedTemplateSourceResolver, _BytesStager]:
    stager = _BytesStager(data)
    return (
        StagedTemplateSourceResolver(
            stagers={"upload": stager, "session_file": stager},
            limits=PackageLimits(**limits),
        ),
        stager,
    )


def _upload() -> UploadTemplateSource:
    return UploadTemplateSource(staging_session_id="staging", attachment_id=uuid4())


async def _reason(data: bytes, **limits) -> str:
    resolver, _ = _resolver(data, **limits)
    with pytest.raises(TemplateSourceInvalid) as error:
        async with resolver.open(project_id=PROJECT_ID, source=_upload()):
            pass
    return error.value.code


@pytest.mark.asyncio
async def test_zip_resolves_to_the_same_digest_as_its_directory_and_parses():
    resolver, stager = _resolver(_zip(_fixture_files()))

    async with resolver.open(project_id=PROJECT_ID, source=_upload()) as resolved:
        package = TemplatePackageParser().parse(resolved)
        root = resolved.root
        assert root.is_dir()

    assert resolved.digest == package_digest(FIXTURE)
    assert resolved.version == package.version
    assert resolved.key == "outbound-prospecting"
    assert package.agent.setup
    # The temporary copy is gone once the context closes.
    assert not stager.roots[0].exists()


@pytest.mark.asyncio
async def test_one_wrapper_folder_and_macos_metadata_are_tolerated():
    files = _fixture_files("outbound/")
    files["__MACOSX/outbound/._plugin.json"] = b"resource fork"
    resolver, _ = _resolver(_zip(files))

    async with resolver.open(project_id=PROJECT_ID, source=_upload()) as resolved:
        assert resolved.digest == package_digest(FIXTURE)


@pytest.mark.asyncio
async def test_pin_rejects_changed_bytes_and_session_file_pin_is_applied():
    data = _zip(_fixture_files())
    resolver, _ = _resolver(data)
    stale = TemplateSourcePin(version="1.0.0", digest="sha256:" + "0" * 64)

    with pytest.raises(TemplateSourceDigestMismatch):
        async with resolver.open(project_id=PROJECT_ID, source=_upload(), pin=stale):
            pass

    source = SessionFileTemplateSource(session_id="s", path="t.zip", pin=stale)
    with pytest.raises(TemplateSourceDigestMismatch):
        async with resolver.open(project_id=PROJECT_ID, source=source):
            pass


@pytest.mark.asyncio
async def test_cleanup_happens_when_the_caller_fails():
    resolver, stager = _resolver(_zip(_fixture_files()))

    with pytest.raises(RuntimeError):
        async with resolver.open(project_id=PROJECT_ID, source=_upload()):
            raise RuntimeError("parser failed")

    assert not stager.roots[0].exists()


@pytest.mark.asyncio
async def test_malformed_archive_is_refused():
    assert await _reason(b"not a zip") == "template_archive_invalid"
    assert await _reason(_zip(_fixture_files())[:-40]) == "template_archive_invalid"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "name",
    [
        "../escape.md",
        "a/../../escape.md",
        "/etc/passwd",
        "a\\b.md",
        "C:/windows.md",
        "a//b.md",
        "./plugin.json",
        "bad\x01name.md",
    ],
)
async def test_unsafe_member_paths_are_refused(name):
    info = zipfile.ZipInfo("placeholder")
    info.filename = name  # zipfile normalizes some names on construction
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(info, b"x")
    assert await _reason(buffer.getvalue()) == "template_archive_path_unsafe"


@pytest.mark.asyncio
async def test_duplicate_and_colliding_paths_are_refused():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("plugin.json", b"{}")
        archive.writestr("plugin.json", b"{}")
    assert await _reason(buffer.getvalue()) == "template_archive_duplicate_path"

    assert (
        await _reason(_zip({"README.md": b"a", "readme.md": b"b"}))
        == "template_archive_duplicate_path"
    )
    assert (
        await _reason(_zip({"docs": b"a", "docs/guide.md": b"b"}))
        == "template_archive_duplicate_path"
    )
    assert (
        await _reason(_zip({"docs/guide.md": b"b", "docs": b"a"}))
        == "template_archive_duplicate_path"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("file_type", [stat.S_IFLNK, stat.S_IFIFO, stat.S_IFCHR])
async def test_links_and_special_entries_are_refused(file_type):
    info = zipfile.ZipInfo("link.md")
    info.create_system = 3
    info.external_attr = (file_type | 0o777) << 16
    data = _zip(_fixture_files(), infos=[info])
    assert await _reason(data) == "template_archive_entry_unsupported"


@pytest.mark.asyncio
async def test_encrypted_entries_are_refused():
    data = bytearray(_zip({"plugin.json": b"{}"}))
    # Set the encryption flag in both the local and the central header.
    for signature, offset in ((b"PK\x03\x04", 6), (b"PK\x01\x02", 8)):
        index = data.find(signature)
        data[index + offset] |= 0x1
    assert await _reason(bytes(data)) == "template_archive_entry_unsupported"


@pytest.mark.asyncio
async def test_count_depth_and_transfer_limits_are_enforced():
    many = {f"files/{index}.md": b"x" for index in range(257)}
    assert await _reason(_zip(many)) == "template_source_limit_exceeded"

    deep = "/".join(["d"] * 13) + "/file.md"
    assert await _reason(_zip({deep: b"x"})) == "template_source_limit_exceeded"

    folders = {f"folder-{index}/": b"" for index in range(20)}
    assert (
        await _reason(_zip(folders), max_archive_entries=10)
        == "template_source_limit_exceeded"
    )

    big = _zip(_fixture_files())
    assert (
        await _reason(big, max_archive_bytes=len(big) - 1)
        == "template_archive_too_large"
    )


@pytest.mark.asyncio
async def test_decompressed_bytes_are_counted_not_declared_sizes():
    # A tiny compressed bomb passes the transfer bound and stops while streaming.
    bomb = _zip({"plugin.json": b"\0" * (2 * 1024 * 1024)})
    assert len(bomb) < 64 * 1024
    assert await _reason(bomb) == "template_source_limit_exceeded"

    total = {f"part-{index}.md": b"\0" * (900 * 1024) for index in range(5)}
    assert await _reason(_zip(total)) == "template_source_limit_exceeded"

    # A header that under-declares the size cannot smuggle extra bytes.
    lying = bytearray(_zip({"notes.md": b"a" * 4096}))
    central = lying.find(b"PK\x01\x02")
    lying[central + 24 : central + 28] = (16).to_bytes(4, "little")
    local = lying.find(b"PK\x03\x04")
    lying[local + 22 : local + 26] = (16).to_bytes(4, "little")
    assert await _reason(bytes(lying)) == "template_archive_invalid"


def test_writer_never_writes_execute_bits_or_follows_existing_paths(tmp_path: Path):
    writer = PackageTreeWriter(tmp_path / "package")
    writer.write_file("run.sh", [b"#!/bin/sh\n"])

    mode = stat.S_IMODE((tmp_path / "package" / "run.sh").stat().st_mode)
    assert mode & 0o111 == 0

    with pytest.raises(FileExistsError):
        PackageTreeWriter(tmp_path / "package")
