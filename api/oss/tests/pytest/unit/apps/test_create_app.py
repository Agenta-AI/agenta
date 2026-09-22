"""``create_app``: what it writes, what it refuses, what an update leaves alone."""

from __future__ import annotations

import json
from uuid import uuid4

import pytest
from oss.src.core.apps.handlers import (
    CREATE_APP_CALL_REF,
    CREATE_APP_TOOL_DEFINITION,
    handle_create_app,
)
from oss.src.core.apps.service import AppsError, AppsService
from oss.src.core.tools.exceptions import (
    PlatformToolHandlerRefused,
    PlatformToolHandlerUnavailable,
)
from oss.src.core.tools.platform_handlers import dispatch_platform_tool_handler

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


@pytest.mark.parametrize(
    "update,fail_at", [(False, 1), (False, 2), (False, 3), (True, 1), (True, 2)]
)
async def test_failed_copy_restores_previous_files(fake_mounts, update, fail_at):
    if update:
        await _create(fake_mounts)
        fake_mounts.files["apps/sprint/index.html"] = "custom entry"
    before = dict(fake_mounts.files)
    original = fake_mounts.write_file
    calls = 0

    async def fail_once(**kwargs):
        nonlocal calls
        calls += 1
        if calls == fail_at:
            raise RuntimeError("storage disconnected")
        return await original(**kwargs)

    fake_mounts.write_file = fail_once
    with pytest.raises(RuntimeError, match="storage disconnected"):
        await _create(fake_mounts, update=update)
    assert fake_mounts.files == before
    fake_mounts.write_file = original
    await _create(fake_mounts, update=update)


@pytest.mark.parametrize("fail_at", [1, 2, 3])
async def test_lost_write_response_is_reconciled_before_rollback(fake_mounts, fail_at):
    original = fake_mounts.write_file
    calls = 0

    async def lose_response(**kwargs):
        nonlocal calls
        calls += 1
        result = await original(**kwargs)
        if calls == fail_at:
            raise TimeoutError("response lost after commit")
        return result

    fake_mounts.write_file = lose_response
    with pytest.raises(TimeoutError):
        await _create(fake_mounts)
    assert fake_mounts.files == {}


async def test_manifest_is_published_last(fake_mounts):
    await _create(fake_mounts)
    assert fake_mounts.writes[-1] == "apps/sprint/app.json"


async def test_create_does_not_overwrite_existing_entry_without_manifest(fake_mounts):
    fake_mounts.files["apps/sprint/index.html"] = "unrelated document"
    before = dict(fake_mounts.files)
    with pytest.raises(AppsError, match="already exists"):
        await _create(fake_mounts)
    assert fake_mounts.files == before
    assert fake_mounts.writes == []


async def test_failed_copy_preserves_concurrent_edit_and_reports_path(fake_mounts):
    original = fake_mounts.write_file

    async def concurrent_edit(**kwargs):
        if kwargs["path"].endswith("config.json"):
            fake_mounts.files["apps/sprint/index.html"] = "someone else's edit"
            raise RuntimeError("disconnected")
        return await original(**kwargs)

    fake_mounts.write_file = concurrent_edit
    with pytest.raises(AppsError) as exc:
        await _create(fake_mounts)
    assert exc.value.code == "app_copy_incomplete"
    assert exc.value.details == {"paths": ["apps/sprint/index.html"]}
    assert fake_mounts.files == {"apps/sprint/index.html": "someone else's edit"}


async def test_concurrent_create_is_not_overwritten(fake_mounts):
    original = fake_mounts.write_file

    async def concurrent_create(**kwargs):
        if kwargs["path"].endswith("config.json"):
            fake_mounts.files[kwargs["path"]] = "concurrent config"
        return await original(**kwargs)

    fake_mounts.write_file = concurrent_create
    with pytest.raises(AppsError) as exc:
        await _create(fake_mounts)
    assert exc.value.code == "conflict"
    assert fake_mounts.files == {"apps/sprint/config.json": "concurrent config"}


async def test_update_true_on_new_app_still_creates_config(fake_mounts):
    await _create(fake_mounts, update=True)
    assert "apps/sprint/config.json" in fake_mounts.files


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


@pytest.mark.parametrize("update", ["false", "true", "", 0, 1, None, [], {}])
async def test_handler_rejects_non_boolean_update_before_mount_creation(
    fake_mounts, update
):
    result = await handle_create_app(
        arguments={
            "starter": "board",
            "dir": "apps/sprint",
            "session_id": "sess-1",
            "update": update,
        },
        project_id=PROJECT,
        user_id=uuid4(),
        mounts_service=fake_mounts,
    )
    assert result.ok is False
    assert result.content.code == "invalid_arguments"
    assert fake_mounts.session_calls == []
    assert fake_mounts.writes == []


@pytest.mark.parametrize("update", [False, True])
async def test_handler_accepts_boolean_update(fake_mounts, update):
    result = await handle_create_app(
        arguments={
            "starter": "board",
            "dir": "apps/sprint",
            "session_id": "sess-1",
            "update": update,
        },
        project_id=PROJECT,
        user_id=uuid4(),
        mounts_service=fake_mounts,
    )
    assert result.ok is True


def test_tool_definition_hides_the_bound_field_from_the_model():
    schema = CREATE_APP_TOOL_DEFINITION["input_schema"]
    assert set(schema["required"]) == {"starter", "dir"}
    assert CREATE_APP_TOOL_DEFINITION["context_bindings"] == {
        "session_id": "$ctx.session.id"
    }
    assert CREATE_APP_TOOL_DEFINITION["read_only"] is False


# --- dispatch --------------------------------------------------------------------


async def test_dispatch_hands_the_handler_the_routers_mounts_service(fake_mounts):
    result = await dispatch_platform_tool_handler(
        call_ref=CREATE_APP_CALL_REF,
        arguments={"starter": "board", "dir": "apps/sprint", "session_id": "sess-1"},
        headers=None,
        project_id=PROJECT,
        user_id=uuid4(),
        workflows_service=None,
        tracing_service=None,
        mounts_service=fake_mounts,
    )
    assert result.ok is True
    assert fake_mounts.session_calls == [
        {"project_id": PROJECT, "session_id": "sess-1"}
    ]


async def test_dispatch_without_a_mounts_service_is_unavailable():
    with pytest.raises(PlatformToolHandlerUnavailable):
        await dispatch_platform_tool_handler(
            call_ref=CREATE_APP_CALL_REF,
            arguments={"starter": "board", "dir": "apps/x", "session_id": "sess-1"},
            headers=None,
            project_id=PROJECT,
            user_id=uuid4(),
            workflows_service=None,
            tracing_service=None,
        )
