import io
import json
import zipfile
from pathlib import Path
from uuid import uuid4

import pytest

from oss.src.core.agent_templates.archive import extract_zip
from oss.src.core.agent_templates.dtos import (
    InternalTemplateSource,
    TemplateSourcePin,
    UploadTemplateSource,
)
from oss.src.core.agent_templates.exceptions import TemplateSourceNotFound
from oss.src.core.agent_templates.parser import TemplatePackageParser
from oss.src.core.agent_templates.sources import (
    InternalTemplateSourceResolver,
    StagedTemplateSourceResolver,
    TemplateSources,
    package_digest,
)
from oss.src.core.agent_templates.validation import AgentTemplateValidator


FIXTURE = Path(__file__).parent / "fixtures" / "current"
CATALOG = (
    Path(__file__).resolve().parents[4]
    / "src"
    / "resources"
    / "agent_templates"
    / "catalog.json"
)
PROJECT_ID = uuid4()


def _files() -> dict[str, bytes]:
    return {
        path.relative_to(FIXTURE).as_posix(): path.read_bytes()
        for path in sorted(FIXTURE.rglob("*"))
        if path.is_file()
    }


def _zip(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return buffer.getvalue()


class _Stager:
    def __init__(self, data: bytes | None) -> None:
        self.data = data

    async def stage(self, *, project_id, source, writer):
        if self.data is None:
            raise TemplateSourceNotFound("upload")
        extract_zip(self.data, writer)


def _validator(data: bytes | None) -> AgentTemplateValidator:
    return AgentTemplateValidator(
        source_resolver=TemplateSources(
            internal=InternalTemplateSourceResolver(catalog_path=CATALOG),
            staged=StagedTemplateSourceResolver(stagers={"upload": _Stager(data)}),
        ),
        package_parser=TemplatePackageParser(),
    )


def _upload() -> UploadTemplateSource:
    return UploadTemplateSource(staging_session_id="staging", attachment_id=uuid4())


@pytest.mark.asyncio
async def test_valid_zip_returns_its_pin_and_supported_schemas():
    result = await _validator(_zip(_files())).validate(
        project_id=PROJECT_ID, source=_upload()
    )

    assert result.valid is True
    assert result.issues == []
    assert result.version == "1.0.0"
    assert result.digest == package_digest(FIXTURE)
    assert result.supported_schema_versions == ["ai.agenta/1"]


@pytest.mark.asyncio
async def test_internal_catalog_package_validates_too():
    result = await _validator(None).validate(
        project_id=PROJECT_ID,
        source=InternalTemplateSource(key="outbound-prospecting"),
    )
    assert result.valid is True


@pytest.mark.asyncio
async def test_missing_setup_file_names_manifest_field_and_fix():
    files = _files()
    del files["ai.agenta/agents/outbound/SETUP.md"]

    result = await _validator(_zip(files)).validate(
        project_id=PROJECT_ID, source=_upload()
    )

    assert result.valid is False
    assert result.version is None and result.digest is None
    [issue] = result.issues
    assert issue.code == "file_not_found"
    assert issue.path == "ai.agenta/agents.json"
    assert issue.field == "agents.outbound.setup"
    assert "SETUP.md" in issue.message
    assert issue.next_step


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("mutate", "code", "path", "field"),
    [
        (
            lambda files, manifest: manifest["agents"]["outbound"].update(
                {"llm": {"model": "x"}}
            ),
            "extension_schema_invalid",
            "ai.agenta/agents.json",
            "agents.outbound",
        ),
        (
            lambda files, manifest: files.pop("plugin.json"),
            "plugin_manifest_invalid",
            "plugin.json",
            None,
        ),
        (
            lambda files, manifest: files.pop("skills/prospect-research/SKILL.md"),
            "missing_skill",
            "skills/prospect-research",
            "agents.outbound.skills",
        ),
        (
            lambda files, manifest: files.update({"../escape.md": b"x"}),
            "template_archive_path_unsafe",
            "../escape.md",
            None,
        ),
    ],
)
async def test_invalid_packages_report_file_field_and_next_step(
    mutate, code, path, field
):
    files = _files()
    manifest = json.loads(files["ai.agenta/agents.json"])
    mutate(files, manifest)
    files["ai.agenta/agents.json"] = json.dumps(manifest).encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in files.items():
            info = zipfile.ZipInfo("placeholder")
            info.filename = name
            archive.writestr(info, content)

    result = await _validator(buffer.getvalue()).validate(
        project_id=PROJECT_ID, source=_upload()
    )

    assert result.valid is False
    [issue] = result.issues
    assert (issue.code, issue.path, issue.field) == (code, path, field)
    assert issue.next_step
    # Host paths never leak into an issue.
    assert "/tmp" not in issue.model_dump_json()


@pytest.mark.asyncio
async def test_stale_pin_is_an_issue_not_a_success():
    result = await _validator(_zip(_files())).validate(
        project_id=PROJECT_ID,
        source=_upload(),
        pin=TemplateSourcePin(version="1.0.0", digest="sha256:" + "0" * 64),
    )

    assert result.valid is False
    assert result.issues[0].code == "template_source_digest_mismatch"


@pytest.mark.asyncio
async def test_missing_or_unauthorized_sources_stay_normal_errors():
    with pytest.raises(TemplateSourceNotFound):
        await _validator(None).validate(project_id=PROJECT_ID, source=_upload())
