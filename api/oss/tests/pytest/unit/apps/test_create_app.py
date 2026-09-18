"""``create_app``: what it writes, what it refuses, what an update leaves alone."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from oss.src.core.apps.handlers import (
    CREATE_APP_TOOL_DEFINITION,
    handle_create_app,
)
from oss.src.core.apps.service import AppsError, AppsService
from oss.src.core.tools.exceptions import PlatformToolHandlerRefused

PROJECT = uuid4()
MOUNT = uuid4()


async def _create(fake_mounts, **kwargs):
    service = AppsService(mounts_service=fake_mounts)
    return await service.create_app(
        project_id=PROJECT,
        mount_id=MOUNT,
        **{"starter": "board", "dir": "apps/sprint", **kwargs},
    )


async def test_create_writes_template_files_and_stamps_template(fake_mounts):
    result = await _create(fake_mounts)

    assert result.template == "board@1"
    assert result.paths == [
        "apps/sprint/app.json",
        "apps/sprint/index.html",
        "apps/sprint/config.json",
    ]
    assert result.skipped == []
    manifest = json.loads(fake_mounts.files["apps/sprint/app.json"])
    assert manifest["template"] == "board@1"
    assert manifest["agenta_app"] == 1
    assert manifest["data"] == ["board.json"]
    # The starter's own reference files never land in the app folder.
    assert "apps/sprint/SKILL.md" not in fake_mounts.files
    assert "apps/sprint/config.defaults.json" not in fake_mounts.files
    # The data file is the app's to create; the copy leaves it absent (not_found -> empty).
    assert "apps/sprint/board.json" not in fake_mounts.files
    config = json.loads(fake_mounts.files["apps/sprint/config.json"])
    assert [c["id"] for c in config["columns"]] == ["todo", "doing", "done"]


async def test_create_accepts_pinned_version_and_strips_slashes(fake_mounts):
    result = await _create(fake_mounts, starter="board@1", dir="/apps/sprint/")
    assert result.template == "board@1"
    assert result.paths[0] == "apps/sprint/app.json"


async def test_create_refuses_existing_manifest(fake_mounts):
    await _create(fake_mounts)
    with pytest.raises(AppsError) as info:
        await _create(fake_mounts)
    assert info.value.code == "app_exists"
    assert "update=true" in (info.value.next_step or "")


async def test_update_replaces_only_non_data_files(fake_mounts):
    await _create(fake_mounts)
    fake_mounts.files["apps/sprint/index.html"] = "<!doctype html>stale"
    fake_mounts.files["apps/sprint/board.json"] = '{"columns": [{"id": "todo"}]}'
    fake_mounts.files["apps/sprint/config.json"] = '{"title": "Mine"}'
    fake_mounts.writes.clear()

    result = await _create(fake_mounts, update=True)

    assert sorted(result.paths) == ["apps/sprint/app.json", "apps/sprint/index.html"]
    assert result.skipped == ["apps/sprint/config.json"]
    assert fake_mounts.files["apps/sprint/index.html"] != "<!doctype html>stale"
    assert (
        fake_mounts.files["apps/sprint/board.json"] == '{"columns": [{"id": "todo"}]}'
    )
    assert fake_mounts.files["apps/sprint/config.json"] == '{"title": "Mine"}'
    assert (
        json.loads(fake_mounts.files["apps/sprint/app.json"])["template"] == "board@1"
    )


async def test_update_honours_the_live_manifests_data_list(fake_mounts):
    """A person who renamed the data file keeps it: the LIVE manifest's ``data`` wins."""
    await _create(fake_mounts)
    live = json.loads(fake_mounts.files["apps/sprint/app.json"])
    live["data"] = ["board.json", "index.html"]  # contrived: protect the entry too
    fake_mounts.files["apps/sprint/app.json"] = json.dumps(live)
    fake_mounts.files["apps/sprint/index.html"] = "custom"

    result = await _create(fake_mounts, update=True)

    assert fake_mounts.files["apps/sprint/index.html"] == "custom"
    assert "apps/sprint/index.html" in result.skipped


@pytest.mark.parametrize("starter", ["board@2", "nope", "Board", "board@x"])
async def test_unknown_starter_is_a_clear_error(fake_mounts, starter):
    with pytest.raises(AppsError) as info:
        await _create(fake_mounts, starter=starter)
    assert info.value.code == "unknown_starter"
    assert "board@1" in (info.value.next_step or "")
    assert fake_mounts.writes == []


async def test_agent_starters_are_not_copyable_yet(fake_mounts):
    with pytest.raises(AppsError) as info:
        await _create(fake_mounts, starter="agent:retro")
    assert info.value.code == "starter_not_copyable"


@pytest.mark.parametrize("bad_dir", ["", "/", "apps/../etc", "apps/./x", "a\\b"])
async def test_invalid_dir_is_refused_before_any_write(fake_mounts, bad_dir):
    with pytest.raises(AppsError) as info:
        await _create(fake_mounts, dir=bad_dir)
    assert info.value.code == "invalid_dir"
    assert fake_mounts.writes == []


# --- handler ---------------------------------------------------------------------


async def test_handler_resolves_the_session_mount_from_the_bound_session_id(
    fake_mounts,
):
    result = await handle_create_app(
        arguments={"starter": "board", "dir": "apps/sprint", "session_id": "sess-1"},
        project_id=PROJECT,
        user_id=uuid4(),
        mounts_service=fake_mounts,
    )
    assert result.ok is True
    assert result.content["template"] == "board@1"
    assert fake_mounts.session_calls == [
        {"project_id": PROJECT, "session_id": "sess-1"}
    ]


async def test_handler_fails_closed_without_the_binding(fake_mounts):
    with pytest.raises(PlatformToolHandlerRefused):
        await handle_create_app(
            arguments={"starter": "board", "dir": "apps/sprint"},
            project_id=PROJECT,
            user_id=uuid4(),
            mounts_service=fake_mounts,
        )


async def test_handler_returns_the_agent_error_envelope(fake_mounts):
    result = await handle_create_app(
        arguments=json.dumps(
            {"starter": "missing", "dir": "apps/sprint", "session_id": "sess-1"}
        ),
        project_id=PROJECT,
        user_id=uuid4(),
        mounts_service=fake_mounts,
    )
    assert result.ok is False
    assert result.content.code == "unknown_starter"
    assert result.content.retryable is False


def test_tool_definition_hides_the_bound_field_from_the_model():
    schema = CREATE_APP_TOOL_DEFINITION["input_schema"]
    assert set(schema["required"]) == {"starter", "dir"}
    assert CREATE_APP_TOOL_DEFINITION["context_bindings"] == {
        "session_id": "$ctx.session.id"
    }
    assert CREATE_APP_TOOL_DEFINITION["read_only"] is False
