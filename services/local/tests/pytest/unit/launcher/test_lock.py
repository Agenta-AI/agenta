import json

import pytest
from agenta_local.launcher.lock import WorkspaceLock, WorkspaceLocked


def test_second_lock_names_active_workspace_and_cannot_replace_metadata(tmp_path):
    path = tmp_path / "data" / "workspace.lock"
    workspace = tmp_path / "workspace one"
    first = WorkspaceLock.acquire(path, workspace)
    original = path.read_text()
    try:
        with pytest.raises(WorkspaceLocked) as caught:
            WorkspaceLock.acquire(path, tmp_path / "other")
        assert str(workspace.resolve()) in str(caught.value)
        assert path.read_text() == original
    finally:
        first.close()


def test_stale_unlocked_lock_is_recovered_and_rewritten_mode_0600(tmp_path):
    path = tmp_path / "workspace.lock"
    path.write_text("corrupt stale metadata")
    path.chmod(0o666)

    lock = WorkspaceLock.acquire(path, tmp_path / "new workspace")
    try:
        payload = json.loads(path.read_text())
        assert payload["workspace"] == str((tmp_path / "new workspace").resolve())
        assert path.stat().st_mode & 0o777 == 0o600
    finally:
        lock.close()


def test_inherited_descriptor_matches_lock_file(tmp_path):
    path = tmp_path / "workspace.lock"
    parent = WorkspaceLock.acquire(path, tmp_path)
    child_fd = __import__("os").dup(parent.fd)
    child = WorkspaceLock.inherited(path, child_fd, tmp_path)
    child.close()
    try:
        with pytest.raises(WorkspaceLocked):
            WorkspaceLock.acquire(path, tmp_path)
    finally:
        parent.close()
