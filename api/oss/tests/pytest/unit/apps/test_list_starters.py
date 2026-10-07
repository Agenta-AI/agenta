"""``list_starters``: front matter parsing, version resolution, the agent-mount union."""

from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from oss.src.core.apps.handlers import (
    LIST_STARTERS_TOOL_DEFINITION,
    handle_list_starters,
)
from oss.src.core.apps.service import AppsError, AppsService, parse_starter_skill

PROJECT = uuid4()

AGENT_STARTER = """---
name: retro
version: 2
kind: app-starter
access: read
config_keys:
  - title
data_files:
  - retro.json
---

Use this when the team wants a retro board.
"""


def test_bundle_lists_the_board_starter():
    starters = AppsService().list_bundle_starters()
    assert [s.ref for s in starters] == ["board@1"]
    board = starters[0]
    assert board.when.startswith("Use this when")
    assert board.access == "read-write"
    assert board.config_keys == ("title", "columns")
    assert board.data_files == ("board.json",)
    assert board.source == "bundle"


def test_front_matter_parsing_accepts_flow_and_block_lists():
    info = parse_starter_skill(AGENT_STARTER, source="agent")
    assert (info.name, info.version, info.access) == ("retro", 2, "read")
    assert info.config_keys == ("title",)
    assert info.data_files == ("retro.json",)
    assert info.when == "Use this when the team wants a retro board."
    assert info.ref == "agent:retro@2"


@pytest.mark.parametrize(
    "text",
    [
        "no front matter",
        "---\nname: x\n---\nbody",  # missing kind
        "---\nname: Not A Slug\nkind: app-starter\n---\nbody",
        "---\nname: x\nkind: app-starter\nversion: two\n---\nbody",
    ],
)
def test_front_matter_rejects_malformed_starters(text):
    with pytest.raises(AppsError) as info:
        parse_starter_skill(text)
    assert info.value.code == "invalid_starter"


def _write_starter(root: Path, name: str, version: int) -> None:
    folder = root / f"{name}@{version}"
    folder.mkdir()
    (folder / "SKILL.md").write_text(
        f"---\nname: {name}\nversion: {version}\nkind: app-starter\n---\nUse when v{version}.\n"
    )
    (folder / "app.json").write_text('{"agenta_app": 1, "name": "X"}')
    (folder / "index.html").write_text("<!doctype html>")


def test_versions_resolve_to_latest_unless_pinned(tmp_path):
    _write_starter(tmp_path, "x", 1)
    _write_starter(tmp_path, "x", 2)
    (tmp_path / "junk").mkdir()  # not a starter dir; ignored
    service = AppsService(starters_dir=tmp_path)

    assert [s.ref for s in service.list_bundle_starters()] == ["x@1", "x@2"]
    assert service.resolve_bundle_starter("x")[0].version == 2
    assert service.resolve_bundle_starter("x@1")[0].version == 1
    with pytest.raises(AppsError):
        service.resolve_bundle_starter("x@3")


def test_dir_name_and_front_matter_must_agree(tmp_path):
    folder = tmp_path / "x@1"
    folder.mkdir()
    (folder / "SKILL.md").write_text(
        "---\nname: y\nversion: 1\nkind: app-starter\n---\nw\n"
    )
    with pytest.raises(AppsError) as info:
        AppsService(starters_dir=tmp_path).list_bundle_starters()
    assert "disagrees" in info.value.message


async def test_union_with_agent_mount_starters(fake_mounts):
    fake_mounts.files[".apps/starters/retro/SKILL.md"] = AGENT_STARTER
    fake_mounts.files[".apps/starters/broken/SKILL.md"] = "not a starter"
    fake_mounts.files[".apps/starters/retro/index.html"] = "<!doctype html>"
    service = AppsService(mounts_service=fake_mounts)

    starters = await service.list_starters(
        project_id=PROJECT, agent_mount_id=fake_mounts.agent_mount_id
    )

    assert [s.ref for s in starters] == ["board@1", "agent:retro@2"]
    assert starters[1].source == "agent"


async def test_bundle_only_when_no_agent_mount(fake_mounts):
    starters = await AppsService(mounts_service=fake_mounts).list_starters(
        project_id=PROJECT
    )
    assert [s.ref for s in starters] == ["board@1"]


# --- handler ---------------------------------------------------------------------


async def test_handler_returns_rows_and_reaches_the_agent_mount(fake_mounts):
    fake_mounts.files[".apps/starters/retro/SKILL.md"] = AGENT_STARTER
    result = await handle_list_starters(
        arguments={"session_id": "s", "artifact_id": "art-1"},
        project_id=PROJECT,
        user_id=uuid4(),
        mounts_service=fake_mounts,
    )
    assert result.ok is True
    assert [row["name"] for row in result.content] == ["board", "retro"]
    assert set(result.content[0]) == {
        "name",
        "version",
        "when",
        "config_keys",
        "data_files",
        "access",
        "source",
    }
    assert fake_mounts.agent_calls == [{"project_id": PROJECT, "artifact_id": "art-1"}]


async def test_handler_is_bundle_only_without_an_artifact(fake_mounts):
    result = await handle_list_starters(
        arguments=None, project_id=PROJECT, user_id=uuid4(), mounts_service=fake_mounts
    )
    assert [row["name"] for row in result.content] == ["board"]
    assert fake_mounts.agent_calls == []


def test_tool_definition_is_read_only_with_bound_context():
    assert LIST_STARTERS_TOOL_DEFINITION["read_only"] is True
    assert LIST_STARTERS_TOOL_DEFINITION["context_bindings"] == {
        "session_id": "$ctx.session.id",
        "artifact_id": "$ctx.workflow.artifact.id",
    }
