# /// script
# requires-python = ">=3.11"
# dependencies = ["daytona", "pytest"]
# ///
"""Unit tests for the snapshot recipe's build decisions. No Daytona account is touched.

Run: uv run test_build_snapshot.py
"""

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import build_snapshot  # noqa: E402
from build_snapshot import SNAPSHOT_NAME, parse_args, plan_build  # noqa: E402
from daytona.common.errors import DaytonaNotFoundError  # noqa: E402


def test_builds_a_missing_snapshot():
    assert plan_build(SNAPSHOT_NAME, False, None) == "build"
    assert plan_build(SNAPSHOT_NAME, True, None) == "build"


def test_force_never_replaces_a_usable_snapshot():
    assert plan_build(SNAPSHOT_NAME, True, "active") == "refuse"
    assert plan_build(SNAPSHOT_NAME, True, "building") == "refuse"


def test_existing_snapshot_without_force_is_left_alone():
    assert plan_build(SNAPSHOT_NAME, False, "active") == "skip"
    assert plan_build(SNAPSHOT_NAME, False, "build_failed") == "skip"


def test_force_replaces_a_snapshot_that_never_built():
    assert plan_build(SNAPSHOT_NAME, True, "build_failed") == "replace-failed"
    assert plan_build(SNAPSHOT_NAME, True, SimpleNamespace(value="error")) == (
        "replace-failed"
    )


def test_parse_args():
    assert parse_args([]) == (SNAPSHOT_NAME, False)
    assert parse_args(["--force"]) == (SNAPSHOT_NAME, True)
    assert parse_args(["--name", "snap-v2", "--force"]) == ("snap-v2", True)
    assert parse_args(["--name=snap-v2"]) == ("snap-v2", False)
    with pytest.raises(SystemExit):
        parse_args(["--name"])
    with pytest.raises(SystemExit):
        parse_args(["--bogus"])


class FakeSnapshots:
    def __init__(self, existing: dict[str, str]):
        self.existing = {
            name: SimpleNamespace(name=name, state=state)
            for name, state in existing.items()
        }
        self.deleted: list[str] = []
        self.created: list[str] = []

    def get(self, name):
        if name not in self.existing:
            raise DaytonaNotFoundError("not found")
        return self.existing[name]

    def delete(self, snapshot):
        self.deleted.append(snapshot.name)
        self.existing.pop(snapshot.name)

    def create(self, params, on_logs=None):
        self.created.append(params.name)


def run_main(monkeypatch, argv, existing):
    snapshots = FakeSnapshots(existing)
    monkeypatch.setattr(
        build_snapshot, "Daytona", lambda _config: SimpleNamespace(snapshot=snapshots)
    )
    monkeypatch.setattr(build_snapshot, "DaytonaConfig", lambda: None)
    monkeypatch.setattr(sys, "argv", ["build_snapshot.py", *argv])
    return snapshots


def test_forced_rebuild_of_the_live_snapshot_deletes_nothing(monkeypatch):
    snapshots = run_main(monkeypatch, ["--force"], {SNAPSHOT_NAME: "active"})
    with pytest.raises(SystemExit) as refused:
        build_snapshot.main()
    assert "--name" in str(refused.value)
    assert snapshots.deleted == []
    assert snapshots.created == []


def test_refresh_builds_beside_the_live_snapshot(monkeypatch):
    snapshots = run_main(
        monkeypatch, ["--name", "snap-next"], {SNAPSHOT_NAME: "active"}
    )
    build_snapshot.main()
    assert snapshots.deleted == []
    assert snapshots.created == ["snap-next"]
    assert snapshots.existing[SNAPSHOT_NAME].state == "active"


def test_forced_rebuild_replaces_a_failed_build(monkeypatch):
    snapshots = run_main(
        monkeypatch, ["--name", "snap-next", "--force"], {"snap-next": "build_failed"}
    )
    build_snapshot.main()
    assert snapshots.deleted == ["snap-next"]
    assert snapshots.created == ["snap-next"]


if __name__ == "__main__":
    # `-c os.devnull`: ignore services/pytest.ini, whose plugins this script does not install.
    raise SystemExit(
        pytest.main([__file__, "-q", "-c", os.devnull, "-p", "no:cacheprovider"])
    )
