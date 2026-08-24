"""CWD-independent installation and XDG mutable path resolution."""

from __future__ import annotations

import os
import shutil
import stat
import subprocess
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class InstallationPaths:
    root: Path
    python: Path
    site_packages: Path
    node: Path
    runner_dir: Path
    runner_entry: Path
    sandbox_agent: Path
    renderer_dir: Path
    migrations_dir: Path


@dataclass(frozen=True)
class MutablePaths:
    data_dir: Path
    state_dir: Path
    logs_dir: Path
    lock_file: Path


class ComponentError(RuntimeError):
    """A staged runtime component is absent or cannot execute."""

    def __init__(self, component: str, detail: str, log_path: Path) -> None:
        self.component = component
        self.detail = detail
        self.log_path = log_path
        super().__init__(f"{component}: {detail}; log: {log_path}")


def resolve_installation(root: Path | None = None) -> InstallationPaths:
    """Resolve the bundle from this module, never from the process CWD."""
    if root is None:
        root = _find_bundle_root(Path(__file__).resolve())
    root = root.expanduser().resolve()
    return InstallationPaths(
        root=root,
        python=root / "runtime" / "python" / "bin" / "python3",
        site_packages=root / "app" / "python" / "site-packages",
        node=root / "runtime" / "node" / "bin" / "node",
        runner_dir=root / "runner",
        runner_entry=root / "runner" / "node_modules" / "tsx" / "dist" / "cli.mjs",
        sandbox_agent=root / "bin" / "sandbox-agent-wrapper",
        renderer_dir=root / "app" / "web",
        migrations_dir=root / "app" / "migrations",
    )


def _find_bundle_root(module_path: Path) -> Path:
    for parent in module_path.parents:
        if (parent / "runtime" / "python" / "bin" / "python3").exists() and (
            parent / "app" / "python" / "site-packages"
        ).is_dir():
            return parent
    raise RuntimeError(
        f"cannot locate the Agenta Local installation from {module_path}; "
        "the bundle layout is incomplete"
    )


def resolve_mutable_paths(environ: Mapping[str, str] | None = None) -> MutablePaths:
    source = os.environ if environ is None else environ
    home = Path(source.get("HOME", str(Path.home()))).expanduser()
    if not home.is_absolute():
        home = Path.home()
    data_home = _data_home(source, home)
    state_home = _xdg_home(source.get("XDG_STATE_HOME"), home / ".local" / "state")
    data_dir = data_home / "agenta-local"
    state_dir = state_home / "agenta-local"
    return MutablePaths(
        data_dir=data_dir,
        state_dir=state_dir,
        logs_dir=state_dir / "logs",
        lock_file=data_dir / "workspace.lock",
    )


def _data_home(source: Mapping[str, str], home: Path) -> Path:
    """XDG_DATA_HOME wins everywhere; otherwise darwin uses Application Support."""
    configured = source.get("XDG_DATA_HOME")
    if configured:
        path = Path(configured).expanduser()
        if path.is_absolute():
            return path
    if sys.platform == "darwin":
        return home / "Library" / "Application Support"
    return home / ".local" / "share"


def _xdg_home(configured: str | None, fallback: Path) -> Path:
    if configured:
        path = Path(configured).expanduser()
        if path.is_absolute():
            return path
    return fallback


def create_mutable_directories(paths: MutablePaths) -> None:
    for path in (paths.data_dir, paths.state_dir, paths.logs_dir):
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        path.chmod(0o700)


def validate_installation(
    paths: InstallationPaths,
    *,
    runner_log: Path,
    service_log: Path,
    probe_runtimes: bool = True,
) -> None:
    _require_executable("Python runtime", paths.python, service_log)
    _require_executable("Node runtime", paths.node, runner_log)
    _require_file("runner", paths.runner_entry, runner_log)
    _require_file("runner", paths.runner_dir / "src" / "server.ts", runner_log)
    _require_nonempty("runner", paths.runner_entry, runner_log)
    _require_nonempty("runner", paths.runner_dir / "src" / "server.ts", runner_log)
    _require_file("runner sandbox", paths.sandbox_agent, runner_log, executable=True)
    _require_file("renderer", paths.renderer_dir / "index.html", service_log)
    _require_nonempty("renderer", paths.renderer_dir / "index.html", service_log)
    _require_file("migrations", paths.migrations_dir / "runner.py", service_log)
    _require_file("migrations", paths.migrations_dir / "env.py", service_log)
    _require_file("migrations", paths.migrations_dir / "alembic.ini", service_log)
    _require_file("migrations", paths.migrations_dir / "script.py.mako", service_log)
    versions = paths.migrations_dir / "versions"
    if not versions.is_dir() or not any(versions.glob("*.py")):
        raise ComponentError(
            "migrations", f"missing migration versions in {versions}", service_log
        )
    _validate_python_assets("migrations", paths.migrations_dir, service_log)
    if probe_runtimes:
        _probe_runtime("Python runtime", paths.python, service_log)
        _probe_runtime("Node runtime", paths.node, runner_log)


def _require_executable(component: str, path: Path, log_path: Path) -> None:
    _require_file(component, path, log_path, executable=True)


def _require_file(
    component: str,
    path: Path,
    log_path: Path,
    *,
    executable: bool = False,
) -> None:
    try:
        metadata = path.stat()
    except OSError as exc:
        raise ComponentError(
            component, f"missing {path}: {exc.strerror}", log_path
        ) from exc
    if not stat.S_ISREG(metadata.st_mode):
        raise ComponentError(component, f"not a regular file: {path}", log_path)
    if executable and not os.access(path, os.X_OK):
        raise ComponentError(component, f"not executable: {path}", log_path)


def _probe_runtime(component: str, executable: Path, log_path: Path) -> None:
    try:
        result = subprocess.run(
            [str(executable), "--version"],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env={},
            timeout=10,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ComponentError(
            component, f"runtime probe failed: {exc}", log_path
        ) from exc
    if result.returncode != 0:
        raise ComponentError(
            component,
            f"runtime probe exited with status {result.returncode}",
            log_path,
        )


def _require_nonempty(component: str, path: Path, log_path: Path) -> None:
    try:
        if not path.read_bytes().strip():
            raise ComponentError(component, f"empty asset: {path}", log_path)
    except OSError as exc:
        raise ComponentError(
            component, f"cannot read asset {path}: {exc}", log_path
        ) from exc


def _validate_python_assets(component: str, directory: Path, log_path: Path) -> None:
    for path in directory.rglob("*.py"):
        try:
            compile(path.read_bytes(), str(path), "exec")
        except (OSError, SyntaxError) as exc:
            raise ComponentError(
                component, f"invalid Python asset {path}: {exc}", log_path
            ) from exc


def source_installation() -> InstallationPaths:
    """Developer-only path plan used by tests and source checkout diagnostics."""
    repository = Path(__file__).resolve().parents[5]
    node = shutil.which("node")
    return InstallationPaths(
        root=repository,
        python=Path(sys.executable),
        site_packages=repository / "services" / "local" / "src",
        node=Path(node) if node else Path("/missing/node"),
        runner_dir=repository / "services" / "runner",
        runner_entry=repository
        / "services"
        / "runner"
        / "node_modules"
        / "tsx"
        / "dist"
        / "cli.mjs",
        sandbox_agent=repository
        / "services"
        / "runner"
        / "node_modules"
        / "@sandbox-agent"
        / "cli-linux-x64"
        / "bin"
        / "sandbox-agent",
        renderer_dir=repository / "web" / "agenta-local" / "out",
        migrations_dir=repository
        / "services"
        / "local"
        / "databases"
        / "sqlite"
        / "migrations",
    )
