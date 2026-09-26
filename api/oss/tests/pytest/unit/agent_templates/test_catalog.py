import json
import shutil
from pathlib import Path

import pytest

from oss.src.core.agent_templates.catalog import AgentTemplateCatalog, tools_summary
from oss.src.core.agent_templates.exceptions import (
    TemplatePackageInvalid,
    TemplateSourceInvalid,
    TemplateSourceNotFound,
)
from oss.src.core.agent_templates.models import AgentTemplateEntry


RESOURCES = (
    Path(__file__).resolve().parents[4] / "src" / "resources" / "agent_templates"
)
CATALOG = RESOURCES / "catalog.json"
# Frozen copy of the handwritten frontend gallery taken before the migration.
# Test-only: it proves the reader reproduces every card, never a runtime source.
GALLERY_PARITY = Path(__file__).parent / "fixtures" / "gallery_parity.json"
UNLISTED_KEYS = {"outbound-prospecting"}


def _gallery_card(entry: AgentTemplateEntry) -> dict:
    card = {
        "key": entry.key,
        "source": entry.source.model_dump(),
        "name": entry.name,
        "category": entry.category,
        "initials": entry.initials,
        "color": entry.color,
        "description": entry.summary,
        "overview": entry.description,
        "instructions": entry.instructions_summary,
        "toolsSummary": entry.tools_summary,
        "trigger": entry.trigger,
        "triggerDescription": entry.trigger_description,
        "seedMessage": entry.seed_message,
        "builderMessage": entry.builder_message,
        "model": entry.model,
        "connections": [],
    }
    if entry.example:
        card["example"] = entry.example.model_dump(exclude_none=True)
    for connection in entry.connections:
        primary = {"slug": connection.primary.slug, "scope": connection.primary.scope}
        if connection.primary.tools:
            primary["tools"] = [tool.model_dump() for tool in connection.primary.tools]
        slot = {
            "key": connection.key,
            "role": connection.role,
            "required": connection.required,
            "primary": primary,
        }
        if connection.alternatives:
            slot["alternatives"] = connection.alternatives
        card["connections"].append(slot)
    return card


def _copy_catalog(tmp_path: Path) -> Path:
    root = tmp_path / "agent_templates"
    shutil.copytree(RESOURCES, root, ignore=shutil.ignore_patterns("schemas"))
    return root / "catalog.json"


def _rewrite(catalog: Path, change) -> None:
    value = json.loads(catalog.read_text(encoding="utf-8"))
    change(value)
    catalog.write_text(json.dumps(value), encoding="utf-8")


def test_reader_reproduces_the_frozen_gallery_in_order():
    expected = json.loads(GALLERY_PARITY.read_text(encoding="utf-8"))
    entries = AgentTemplateCatalog(catalog_path=CATALOG).entries()

    assert [_gallery_card(entry) for entry in entries] == expected


def test_whole_bundled_catalog_and_every_package_version_validate():
    catalog = AgentTemplateCatalog(catalog_path=CATALOG)
    catalog.validate()

    document = json.loads(CATALOG.read_text(encoding="utf-8"))
    listed = {
        key
        for key, record in document["templates"].items()
        if record.get("listed", True)
    }
    assert set(document["templates"]) - listed == UNLISTED_KEYS
    assert {entry.key for entry in catalog.entries()} == listed
    assert {author.id for author in catalog.authors()} == {"agenta"}


def test_unlisted_template_is_hidden_from_query_and_detail():
    catalog = AgentTemplateCatalog(catalog_path=CATALOG)

    assert "outbound-prospecting" not in {entry.key for entry in catalog.query()}
    with pytest.raises(TemplateSourceNotFound):
        catalog.fetch(key="outbound-prospecting")


def test_query_filters_by_search_category_and_author():
    catalog = AgentTemplateCatalog(catalog_path=CATALOG)
    everything = catalog.query()

    engineering = catalog.query(category="engineering")
    assert engineering and all(entry.category == "Engineering" for entry in engineering)
    assert [entry.key for entry in engineering] == [
        entry.key for entry in everything if entry.category == "Engineering"
    ]
    assert [entry.key for entry in catalog.query(search="PR REVIEW")] == ["pr-reviewer"]
    assert catalog.query(author_id="agenta") == everything
    assert catalog.query(author_id="someone-else") == []


def test_fetch_selects_latest_or_requested_version():
    catalog = AgentTemplateCatalog(catalog_path=CATALOG)

    entry = catalog.fetch(key="pr-reviewer")
    assert entry.version == entry.latest == "1.0.0"
    assert entry.digest.startswith("sha256:")
    assert catalog.fetch(key="pr-reviewer", version="1.0.0") == entry
    with pytest.raises(TemplateSourceNotFound):
        catalog.fetch(key="pr-reviewer", version="9.9.9")
    with pytest.raises(TemplateSourceNotFound):
        catalog.fetch(key="missing-template")


def test_display_overrides_fall_back_to_the_package(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)

    def change(value):
        metadata = value["templates"]["pr-reviewer"]["metadata"]
        metadata["display_name"] = "Pull request reviewer"
        metadata["display"]["builder_message"] = "Build it."

    _rewrite(catalog_path, change)
    entry = AgentTemplateCatalog(catalog_path=catalog_path).fetch(key="pr-reviewer")

    assert entry.name == "Pull request reviewer"
    assert entry.description.startswith("Reviews every opened pull request.")
    assert entry.builder_message == "Build it."


def test_missing_author_is_rejected(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    _rewrite(
        catalog_path,
        lambda value: value["templates"]["pr-reviewer"]["metadata"].update(
            author_id="nobody"
        ),
    )

    with pytest.raises(TemplateSourceInvalid) as error:
        AgentTemplateCatalog(catalog_path=catalog_path).validate()

    assert error.value.code == "template_author_missing"
    assert error.value.details["key"] == "pr-reviewer"


def test_author_file_name_must_match_its_id(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    authors = catalog_path.parent / "authors"
    (authors / "agenta.json").rename(authors / "someone.json")

    with pytest.raises(TemplateSourceInvalid) as error:
        AgentTemplateCatalog(catalog_path=catalog_path).validate()

    assert error.value.code == "template_author_invalid"


def test_listed_template_without_metadata_is_rejected(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    _rewrite(
        catalog_path, lambda value: value["templates"]["pr-reviewer"].pop("metadata")
    )

    with pytest.raises(TemplateSourceInvalid) as error:
        AgentTemplateCatalog(catalog_path=catalog_path).validate()

    assert error.value.code == "template_catalog_metadata_missing"


def test_missing_package_reference_is_rejected(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    _rewrite(
        catalog_path,
        lambda value: value["templates"]["pr-reviewer"]["versions"].update(
            {"1.0.0": "packages/pr-reviewer/9.9.9"}
        ),
    )

    with pytest.raises(TemplateSourceInvalid) as error:
        AgentTemplateCatalog(catalog_path=catalog_path).validate()

    assert error.value.code == "template_source_path_invalid"


def test_latest_version_must_be_mapped(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    _rewrite(
        catalog_path,
        lambda value: value["templates"]["pr-reviewer"].update(latest="2.0.0"),
    )

    with pytest.raises(TemplateSourceInvalid) as error:
        AgentTemplateCatalog(catalog_path=catalog_path).validate()

    assert error.value.code == "template_catalog_version_missing"


def test_tool_lists_must_name_package_connections(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    _rewrite(
        catalog_path,
        lambda value: value["templates"]["pr-reviewer"]["metadata"]["display"][
            "connection_tools"
        ].update({"not-a-connection": [{"name": "x", "description": "y"}]}),
    )

    with pytest.raises(TemplateSourceInvalid) as error:
        AgentTemplateCatalog(catalog_path=catalog_path).validate()

    assert error.value.code == "template_catalog_connection_unknown"


def test_unknown_metadata_field_is_rejected(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    _rewrite(
        catalog_path,
        lambda value: value["templates"]["pr-reviewer"]["metadata"].update(
            dispaly_name="typo"
        ),
    )

    with pytest.raises(TemplateSourceInvalid) as error:
        AgentTemplateCatalog(catalog_path=catalog_path).validate()

    assert error.value.code == "template_source_catalog_invalid"


def test_unwrapped_catalog_is_rejected(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    _rewrite(catalog_path, lambda value: value.pop("schema_version"))

    with pytest.raises(TemplateSourceInvalid) as error:
        AgentTemplateCatalog(catalog_path=catalog_path).entries()

    assert error.value.code == "template_catalog_format_unsupported"


def test_package_schema_checks_still_apply(tmp_path: Path):
    catalog_path = _copy_catalog(tmp_path)
    manifest = (
        catalog_path.parent
        / "packages"
        / "pr-reviewer"
        / "1.0.0"
        / "ai.agenta"
        / "agents.json"
    )
    value = json.loads(manifest.read_text(encoding="utf-8"))
    value["schema_version"] = 2
    manifest.write_text(json.dumps(value), encoding="utf-8")

    with pytest.raises(TemplatePackageInvalid):
        AgentTemplateCatalog(catalog_path=catalog_path).validate()


def test_catalog_migration_leaves_package_bytes_unchanged():
    # Digests of every published package at the pre-migration baseline.
    expected = json.loads(
        (Path(__file__).parent / "fixtures" / "package_digests.json").read_text(
            encoding="utf-8"
        )
    )
    catalog = AgentTemplateCatalog(catalog_path=CATALOG)
    document = json.loads(CATALOG.read_text(encoding="utf-8"))

    actual = {
        f"{key}@{version}": catalog.package_digest(key=key, version=version)
        for key, record in document["templates"].items()
        for version in record["versions"]
    }
    assert actual == expected


def test_tools_summary_joins_primary_tool_counts():
    entry = AgentTemplateCatalog(catalog_path=CATALOG).fetch(key="bug-report-router")

    assert tools_summary(entry.connections) == "2 Slack + 2 Linear tools"
    assert tools_summary([]) == ""
