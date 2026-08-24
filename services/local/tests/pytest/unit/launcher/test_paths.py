import os
import sys
from pathlib import Path

import pytest
from agenta_local.launcher.paths import (
    ComponentError,
    create_mutable_directories,
    resolve_installation,
    resolve_mutable_paths,
    validate_installation,
)


def _bundle(root: Path) -> None:
    files = {
        "runtime/python/bin/python3": b"runtime",
        "runtime/node/bin/node": b"runtime",
        "runner/node_modules/tsx/dist/cli.mjs": b"runner",
        "runner/src/server.ts": b"runner",
        "bin/sandbox-agent-wrapper": b"runner",
        "app/web/index.html": b"html",
        "app/migrations/runner.py": b"migration",
        "app/migrations/env.py": b"migration",
        "app/migrations/alembic.ini": b"migration",
        "app/migrations/script.py.mako": b"migration",
        "app/migrations/versions/0001.py": b"migration",
    }
    (root / "app/python/site-packages").mkdir(parents=True)
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
    for relative in (
        "runtime/python/bin/python3",
        "runtime/node/bin/node",
        "bin/sandbox-agent-wrapper",
    ):
        (root / relative).chmod(0o755)


def test_paths_are_cwd_independent_with_spaces_and_read_only_install(
    tmp_path, monkeypatch
):
    root = tmp_path / "read only install with spaces"
    _bundle(root)
    for directory, _, _ in os.walk(root):
        Path(directory).chmod(0o555)
    monkeypatch.chdir(tmp_path)

    installation = resolve_installation(root)
    mutable = resolve_mutable_paths(
        {
            "HOME": str(tmp_path / "home with spaces"),
            "XDG_DATA_HOME": str(tmp_path / "mutable data"),
            "XDG_STATE_HOME": str(tmp_path / "mutable state"),
        }
    )
    create_mutable_directories(mutable)

    assert installation.renderer_dir == root / "app/web"
    assert mutable.data_dir == tmp_path / "mutable data/agenta-local"
    assert mutable.logs_dir == tmp_path / "mutable state/agenta-local/logs"
    assert mutable.data_dir.stat().st_mode & 0o777 == 0o700
    assert mutable.logs_dir.stat().st_mode & 0o777 == 0o700


def test_relative_xdg_values_are_ignored_instead_of_becoming_cwd_relative(tmp_path):
    paths = resolve_mutable_paths(
        {
            "HOME": str(tmp_path / "home"),
            "XDG_DATA_HOME": "relative-data",
            "XDG_STATE_HOME": "relative-state",
        }
    )

    assert paths.data_dir == tmp_path / "home/.local/share/agenta-local"
    assert paths.state_dir == tmp_path / "home/.local/state/agenta-local"


def test_darwin_defaults_data_to_application_support_but_xdg_override_wins(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(sys, "platform", "darwin")
    home = tmp_path / "mac home"

    defaults = resolve_mutable_paths({"HOME": str(home)})
    overridden = resolve_mutable_paths(
        {
            "HOME": str(home),
            "XDG_DATA_HOME": str(tmp_path / "xdg data"),
        }
    )
    monkeypatch.setattr(sys, "platform", "linux")
    linux = resolve_mutable_paths({"HOME": str(home)})

    assert defaults.data_dir == home / "Library/Application Support/agenta-local"
    assert defaults.lock_file.parent == defaults.data_dir
    assert overridden.data_dir == tmp_path / "xdg data/agenta-local"
    assert linux.data_dir == home / ".local/share/agenta-local"


@pytest.mark.parametrize(
    ("relative", "component", "log_name"),
    [
        ("runtime/python/bin/python3", "Python runtime", "service.log"),
        ("runtime/node/bin/node", "Node runtime", "runner.log"),
        ("runner/node_modules/tsx/dist/cli.mjs", "runner", "runner.log"),
        ("app/web/index.html", "renderer", "service.log"),
        ("app/migrations/runner.py", "migrations", "service.log"),
    ],
)
def test_missing_component_names_component_and_log(
    tmp_path, relative, component, log_name
):
    root = tmp_path / "bundle"
    _bundle(root)
    (root / relative).unlink()
    paths = resolve_installation(root)

    with pytest.raises(ComponentError) as caught:
        validate_installation(
            paths,
            runner_log=tmp_path / "runner.log",
            service_log=tmp_path / "service.log",
            probe_runtimes=False,
        )

    assert caught.value.component == component
    assert caught.value.log_path.name == log_name
    assert component in str(caught.value)
    assert log_name in str(caught.value)


def test_corrupt_runtime_names_component_and_log(tmp_path):
    root = tmp_path / "bundle"
    _bundle(root)
    python = root / "runtime/python/bin/python3"
    python.write_text("not an executable format")
    paths = resolve_installation(root)

    with pytest.raises(ComponentError, match=r"Python runtime.*service\.log"):
        validate_installation(
            paths,
            runner_log=tmp_path / "runner.log",
            service_log=tmp_path / "service.log",
        )


def test_corrupt_migration_names_component_and_log(tmp_path):
    root = tmp_path / "bundle"
    _bundle(root)
    (root / "app/migrations/runner.py").write_text("not valid python !")

    with pytest.raises(ComponentError, match=r"migrations.*service\.log"):
        validate_installation(
            resolve_installation(root),
            runner_log=tmp_path / "runner.log",
            service_log=tmp_path / "service.log",
            probe_runtimes=False,
        )


@pytest.mark.parametrize(
    ("relative", "component", "log_name"),
    [
        ("runner/src/server.ts", "runner", "runner.log"),
        ("app/web/index.html", "renderer", "service.log"),
    ],
)
def test_empty_asset_names_component_and_log(tmp_path, relative, component, log_name):
    root = tmp_path / "bundle"
    _bundle(root)
    (root / relative).write_bytes(b"")

    with pytest.raises(ComponentError) as caught:
        validate_installation(
            resolve_installation(root),
            runner_log=tmp_path / "runner.log",
            service_log=tmp_path / "service.log",
            probe_runtimes=False,
        )

    assert caught.value.component == component
    assert caught.value.log_path.name == log_name
