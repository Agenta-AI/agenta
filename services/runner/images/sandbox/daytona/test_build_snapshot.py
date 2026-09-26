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
from build_snapshot import SNAPSHOT_NAME, parse_args, plan_build, trial_name  # noqa: E402
from daytona.common.errors import DaytonaNotFoundError  # noqa: E402


def test_builds_a_missing_snapshot():
    assert plan_build(SNAPSHOT_NAME, False, None) == "build"
    assert plan_build(SNAPSHOT_NAME, True, None) == "build"


def test_force_on_a_usable_snapshot_runs_a_trial_first():
    assert plan_build(SNAPSHOT_NAME, True, "active") == "trial-then-replace"
    assert plan_build(SNAPSHOT_NAME, True, "building") == "trial-then-replace"


def test_existing_snapshot_without_force_is_left_alone():
    assert plan_build(SNAPSHOT_NAME, False, "active") == "skip"
    assert plan_build(SNAPSHOT_NAME, False, "build_failed") == "skip"


def test_force_replaces_a_snapshot_that_never_built():
    assert plan_build(SNAPSHOT_NAME, True, "build_failed") == "replace-failed"
    assert plan_build(SNAPSHOT_NAME, True, SimpleNamespace(value="error")) == (
        "replace-failed"
    )


def test_trial_names_differ_within_the_same_second(monkeypatch):
    frozen = build_snapshot.time.gmtime(0)
    monkeypatch.setattr(build_snapshot.time, "gmtime", lambda: frozen)
    names = {trial_name(SNAPSHOT_NAME) for _ in range(20)}
    assert len(names) == 20
    assert all(name.startswith(f"{SNAPSHOT_NAME}-candidate-") for name in names)


def test_parse_args():
    assert parse_args([]) == (SNAPSHOT_NAME, False)
    assert parse_args(["--force"]) == (SNAPSHOT_NAME, True)
    assert parse_args(["--name", "snap-v2", "--force"]) == ("snap-v2", True)
    assert parse_args(["--name=snap-v2"]) == ("snap-v2", False)
    with pytest.raises(SystemExit):
        parse_args(["--name"])
    with pytest.raises(SystemExit):
        parse_args(["--name="])
    with pytest.raises(SystemExit):
        parse_args(["--bogus"])


class FakeSnapshots:
    """Records every create/delete in order; a create whose name matches `fail` raises."""

    def __init__(self, existing: dict[str, str], fail=lambda _name: False, size_gb=4.0):
        self.existing = {
            name: SimpleNamespace(name=name, state=state)
            for name, state in existing.items()
        }
        self.fail = fail
        self.size_gb = size_gb
        self.events: list[tuple[str, str]] = []

    def get(self, name):
        if name not in self.existing:
            raise DaytonaNotFoundError("not found")
        return self.existing[name]

    def delete(self, snapshot):
        self.events.append(("delete", snapshot.name))
        self.existing.pop(snapshot.name)

    def create(self, params, on_logs=None):
        self.events.append(("create", params.name))
        if self.fail(params.name):
            self.existing[params.name] = SimpleNamespace(
                name=params.name, state="build_failed"
            )
            raise RuntimeError("build assertion failed")
        created = SimpleNamespace(name=params.name, state="active", size=self.size_gb)
        self.existing[params.name] = created
        return created


def is_trial(name: str) -> bool:
    return name.startswith(f"{SNAPSHOT_NAME}-candidate-")


def run_main(monkeypatch, argv, existing, fail=lambda _name: False, size_gb=4.0):
    snapshots = FakeSnapshots(existing, fail, size_gb)
    monkeypatch.setattr(
        build_snapshot, "Daytona", lambda _config: SimpleNamespace(snapshot=snapshots)
    )
    monkeypatch.setattr(build_snapshot, "DaytonaConfig", lambda: None)
    monkeypatch.setattr(sys, "argv", ["build_snapshot.py", *argv])
    return snapshots


def test_forced_rebuild_proves_a_trial_before_replacing_the_live_snapshot(
    monkeypatch,
):
    snapshots = run_main(monkeypatch, ["--force"], {SNAPSHOT_NAME: "active"})
    build_snapshot.main()
    trial = snapshots.events[0][1]
    assert is_trial(trial)
    assert snapshots.events == [
        ("create", trial),
        ("delete", SNAPSHOT_NAME),
        ("create", SNAPSHOT_NAME),
        ("delete", trial),
    ]
    assert set(snapshots.existing) == {SNAPSHOT_NAME}
    assert snapshots.existing[SNAPSHOT_NAME].state == "active"


def test_failed_trial_never_touches_the_live_snapshot(monkeypatch):
    snapshots = run_main(
        monkeypatch, ["--force"], {SNAPSHOT_NAME: "active"}, fail=is_trial
    )
    with pytest.raises(SystemExit) as failed:
        build_snapshot.main()
    assert "was not touched" in str(failed.value)
    assert ("delete", SNAPSHOT_NAME) not in snapshots.events
    assert ("create", SNAPSHOT_NAME) not in snapshots.events
    assert snapshots.existing[SNAPSHOT_NAME].state == "active"
    # The failed trial never served a sandbox, so it is cleaned up.
    assert set(snapshots.existing) == {SNAPSHOT_NAME}


def test_failed_rebuild_keeps_the_trial_and_prints_the_fallback(monkeypatch):
    snapshots = run_main(
        monkeypatch,
        ["--force"],
        {SNAPSHOT_NAME: "active"},
        fail=lambda name: name == SNAPSHOT_NAME,
    )
    with pytest.raises(SystemExit) as failed:
        build_snapshot.main()
    trial = snapshots.events[0][1]
    assert is_trial(trial)
    assert snapshots.existing[trial].state == "active"
    assert ("delete", trial) not in snapshots.events
    assert f"AGENTA_RUNNER_DAYTONA_SNAPSHOT={trial}" in str(failed.value)


def test_existing_snapshot_without_force_builds_nothing(monkeypatch):
    snapshots = run_main(monkeypatch, [], {SNAPSHOT_NAME: "active"})
    build_snapshot.main()
    assert snapshots.events == []


def test_named_build_leaves_the_live_snapshot_alone(monkeypatch):
    snapshots = run_main(
        monkeypatch, ["--name", "snap-next"], {SNAPSHOT_NAME: "active"}
    )
    build_snapshot.main()
    assert snapshots.events == [("create", "snap-next")]
    assert snapshots.existing[SNAPSHOT_NAME].state == "active"


def test_forced_rebuild_replaces_a_failed_build_directly(monkeypatch):
    snapshots = run_main(
        monkeypatch, ["--name", "snap-next", "--force"], {"snap-next": "build_failed"}
    )
    build_snapshot.main()
    assert snapshots.events == [("delete", "snap-next"), ("create", "snap-next")]


def test_size_budget():
    build_snapshot.check_size_budget("snap", None)
    build_snapshot.check_size_budget("snap", build_snapshot.SIZE_BUDGET_GB)
    with pytest.raises(RuntimeError, match="over the"):
        build_snapshot.check_size_budget("snap", build_snapshot.SIZE_BUDGET_GB + 0.01)


def test_trial_over_the_size_budget_never_touches_the_live_snapshot(monkeypatch):
    snapshots = run_main(
        monkeypatch, ["--force"], {SNAPSHOT_NAME: "active"}, size_gb=5.3
    )
    with pytest.raises(SystemExit) as failed:
        build_snapshot.main()
    assert "over the" in str(failed.value)
    assert "was not touched" in str(failed.value)
    assert ("delete", SNAPSHOT_NAME) not in snapshots.events
    assert set(snapshots.existing) == {SNAPSHOT_NAME}


def test_adapter_pins_never_reinstall_the_native_clis():
    for agent, version in [("pi", "0.0.29"), ("codex", "1.1.7"), ("claude", "0.81.0")]:
        command = build_snapshot.pin_agent_process_command(agent, version)
        assert "--reinstall" not in command
        assert f"install-agent {agent} --agent-process-version {version}" in command
        # The npm cache is cleared in the same RUN, or it stays in the layer.
        assert command.endswith("rm -rf /home/sandbox/.npm/_cacache")


if __name__ == "__main__":
    # `-c os.devnull`: ignore services/pytest.ini, whose plugins this script does not install.
    raise SystemExit(
        pytest.main([__file__, "-q", "-c", os.devnull, "-p", "no:cacheprovider"])
    )
