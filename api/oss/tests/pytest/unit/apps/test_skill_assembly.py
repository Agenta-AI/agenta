"""The ``agenta-apps`` skill: checked-in text equals the assembly, budget, catalogue entry."""

from __future__ import annotations

from oss.src.core.apps.assembly import (
    AGENTA_APPS_SKILL,
    AGENTA_APPS_SLUG,
    BODY_BUDGET_BYTES,
    SECTIONS_DIR,
    SKILL_MD_PATH,
    STARTERS_SECTION,
    TOTAL_BUDGET_BYTES,
    assemble_body,
    instruction_body,
    render_skill_md,
    render_starters_table,
    section_files,
)
from oss.src.core.apps.service import AppsService
from oss.src.core.workflows.static_catalog import StaticWorkflowCatalog

REGENERATE = "regenerate with: uv run --no-sync python -m oss.src.core.apps.assembly"


def test_checked_in_skill_md_equals_the_assembly():
    assert SKILL_MD_PATH.read_text(encoding="utf-8") == render_skill_md(), REGENERATE


def test_checked_in_starters_section_matches_the_bundle():
    starters = AppsService().list_bundle_starters()
    on_disk = (SECTIONS_DIR / STARTERS_SECTION).read_text(encoding="utf-8")
    assert on_disk == render_starters_table(starters), REGENERATE
    for starter in starters:
        assert f"`{starter.ref}`" in on_disk


def test_sections_concatenate_in_filename_order():
    names = [p.name for p in section_files()]
    assert names == sorted(names)
    assert names[0].startswith("01-") and names[-1] == "08-agent-level.md"
    body = assemble_body()
    headings = [
        "## When",
        "## First",
        "## Folder",
        "## Bridge",
        "## Custom app rules",
        "## Starters",
        "## After",
    ]
    positions = [body.index(h) for h in headings]
    assert positions == sorted(positions)
    assert "owned by lane F" in body


def test_size_budget():
    assert len(instruction_body().encode("utf-8")) <= BODY_BUDGET_BYTES
    assert len(assemble_body().encode("utf-8")) <= TOTAL_BUDGET_BYTES


def test_skill_template_carries_starter_references():
    assert AGENTA_APPS_SKILL.name == "agenta-apps"
    assert AGENTA_APPS_SKILL.body == assemble_body()
    paths = [f.path for f in AGENTA_APPS_SKILL.files]
    assert paths == ["references/starters/board@1.md"]
    assert AGENTA_APPS_SKILL.files[0].content.startswith("---\nname: board")


def test_catalogue_serves_the_skill_as_a_static_builtin():
    catalog = StaticWorkflowCatalog()
    assert AGENTA_APPS_SLUG in catalog.list_slugs()
    revision = catalog.retrieve_revision(slug=AGENTA_APPS_SLUG)
    assert revision is not None
    assert revision.flags.is_skill is True
    assert revision.flags.is_static is True
    skill = revision.data.parameters["skill"]
    assert skill["name"] == "agenta-apps"
    assert skill["body"].startswith("# Agenta apps")
