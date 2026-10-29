from pathlib import Path

import pytest
from pydantic import ValidationError

from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    TemplateSourcePin,
)
from oss.src.core.agent_templates.exceptions import (
    TemplateSourceDigestMismatch,
    TemplateSourceInvalid,
    TemplateSourceNotFound,
)
from oss.src.core.agent_templates.sources import (
    InternalTemplateSourceResolver,
    package_digest,
)


CATALOG = (
    Path(__file__).resolve().parents[4]
    / "src"
    / "resources"
    / "agent_templates"
    / "catalog.json"
)


@pytest.mark.asyncio
async def test_internal_source_resolves_latest_and_can_reopen_pin():
    resolver = InternalTemplateSourceResolver(catalog_path=CATALOG)

    latest = await resolver.resolve(
        source=InternalTemplateSource(key="outbound-prospecting")
    )
    pinned = await resolver.resolve(
        source=latest.source,
        pin=TemplateSourcePin(version=latest.version, digest=latest.digest),
    )

    assert pinned.version == latest.version == "1.0.1"
    assert pinned.digest == latest.digest
    assert pinned.root == latest.root
    assert (pinned.root / "plugin.json").is_file()


@pytest.mark.asyncio
async def test_unknown_key_fails_without_accepting_an_arbitrary_path():
    resolver = InternalTemplateSourceResolver(catalog_path=CATALOG)

    with pytest.raises(ValidationError):
        InternalTemplateSource(key="../../etc")

    with pytest.raises(TemplateSourceNotFound):
        await resolver.resolve(source=InternalTemplateSource(key="missing-template"))


@pytest.mark.asyncio
async def test_changed_bytes_fail_a_stored_pin(tmp_path: Path):
    package = tmp_path / "packages" / "sample" / "1.0.0"
    package.mkdir(parents=True)
    (package / "plugin.json").write_text('{"name":"sample"}', encoding="utf-8")
    catalog = tmp_path / "catalog.json"
    catalog.write_text(
        '{"schema_version":1,"templates":{"sample":{"latest":"1.0.0",'
        '"versions":{"1.0.0":"packages/sample/1.0.0"},"listed":false}}}',
        encoding="utf-8",
    )
    resolver = InternalTemplateSourceResolver(catalog_path=catalog)
    first = await resolver.resolve(source=InternalTemplateSource(key="sample"))

    (first.root / "plugin.json").write_text("{}", encoding="utf-8")

    with pytest.raises(TemplateSourceDigestMismatch):
        await resolver.resolve(
            source=first.source,
            pin=TemplateSourcePin(version=first.version, digest=first.digest),
        )


def test_digest_is_path_and_content_sensitive(tmp_path: Path):
    package = tmp_path / "package"
    package.mkdir()
    (package / "a.txt").write_bytes(b"same")
    first = package_digest(package)

    (package / "a.txt").rename(package / "b.txt")
    second = package_digest(package)

    assert first.startswith("sha256:")
    assert len(first) == 71
    assert second != first


def test_digest_rejects_symlinks(tmp_path: Path):
    package = tmp_path / "package"
    package.mkdir()
    target = tmp_path / "outside.txt"
    target.write_text("secret", encoding="utf-8")
    (package / "linked.txt").symlink_to(target)

    with pytest.raises(TemplateSourceInvalid) as error:
        package_digest(package)

    assert error.value.code == "template_source_symlink"


@pytest.mark.asyncio
async def test_catalog_path_must_remain_below_catalog_directory(tmp_path: Path):
    outside = tmp_path.parent / "outside-template"
    outside.mkdir(exist_ok=True)
    (outside / "plugin.json").write_text("{}", encoding="utf-8")
    catalog = tmp_path / "catalog.json"
    catalog.write_text(
        '{"schema_version":1,"templates":{"sample":{"latest":"1.0.0",'
        '"versions":{"1.0.0":"../outside-template"},"listed":false}}}',
        encoding="utf-8",
    )
    resolver = InternalTemplateSourceResolver(catalog_path=catalog)

    with pytest.raises(TemplateSourceInvalid) as error:
        await resolver.resolve(source=InternalTemplateSource(key="sample"))

    assert error.value.code == "template_source_path_invalid"


@pytest.mark.asyncio
async def test_unwrapped_catalog_is_rejected_with_actionable_error(tmp_path: Path):
    catalog = tmp_path / "catalog.json"
    catalog.write_text(
        '{"sample":{"latest":"1.0.0","versions":{"1.0.0":"packages/sample/1.0.0"}}}',
        encoding="utf-8",
    )
    resolver = InternalTemplateSourceResolver(catalog_path=catalog)

    with pytest.raises(TemplateSourceInvalid) as error:
        await resolver.resolve(source=InternalTemplateSource(key="sample"))

    assert error.value.code == "template_catalog_format_unsupported"
    assert error.value.details == {"supported_schema_versions": [1]}
    assert '"schema_version": 1' in error.value.message


@pytest.mark.asyncio
async def test_unsupported_catalog_schema_version_is_rejected(tmp_path: Path):
    catalog = tmp_path / "catalog.json"
    catalog.write_text('{"schema_version":2,"templates":{}}', encoding="utf-8")
    resolver = InternalTemplateSourceResolver(catalog_path=catalog)

    with pytest.raises(TemplateSourceInvalid) as error:
        await resolver.resolve(source=InternalTemplateSource(key="sample"))

    assert error.value.code == "template_catalog_format_unsupported"
