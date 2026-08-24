import subprocess
import sys
import threading
from io import BytesIO
from pathlib import Path

from agenta_local.entrypoints import launcher
from agenta_local.launcher.lock import WorkspaceLock
from agenta_local.launcher.logs import ComponentLog
from agenta_local.launcher.paths import InstallationPaths
from agenta_local.launcher.processes import ManagedProcess


class FakeProcess:
    _next_pid = 1000

    def __init__(self, status=None):
        self.status = status
        self.pid = FakeProcess._next_pid
        FakeProcess._next_pid += 1

    def poll(self):
        return self.status


def managed(name, status=None):
    return ManagedProcess(name, FakeProcess(status), Path(f"/{name}.log"))


def test_runner_timeout_prevents_service_start(tmp_path, monkeypatch):
    installation = object()
    service_started = False
    shutdown = []
    monkeypatch.setattr(
        launcher, "resolve_mutable_paths", lambda env: _mutable(tmp_path)
    )
    monkeypatch.setattr(launcher, "create_mutable_directories", lambda paths: None)
    monkeypatch.setattr(launcher, "validate_installation", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        launcher,
        "_start_runner",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("runner timeout")),
    )

    def start_service(*args, **kwargs):
        nonlocal service_started
        service_started = True

    monkeypatch.setattr(launcher, "_start_service", start_service)
    monkeypatch.setattr(
        launcher,
        "_graceful_shutdown",
        lambda service, runner, **kwargs: shutdown.append((service, runner)),
    )

    assert (
        launcher.run(
            installation=installation,
            source_environment={},
            open_browser=False,
        )
        == 1
    )
    assert service_started is False
    assert shutdown == [(None, None)]


def test_second_launcher_validates_nothing_and_starts_nothing(tmp_path, monkeypatch):
    mutable = _mutable(tmp_path)
    active = WorkspaceLock.acquire(mutable.lock_file, mutable.data_dir)
    called = []
    monkeypatch.setattr(launcher, "resolve_mutable_paths", lambda env: mutable)
    monkeypatch.setattr(launcher, "create_mutable_directories", lambda paths: None)
    monkeypatch.setattr(
        launcher,
        "validate_installation",
        lambda *args, **kwargs: called.append("validate"),
    )
    monkeypatch.setattr(
        launcher, "_start_runner", lambda *args, **kwargs: called.append("runner")
    )
    try:
        status = launcher.run(
            installation=object(),
            source_environment={},
            open_browser=False,
        )
    finally:
        active.close()

    assert status == 2
    assert called == []


def test_service_timeout_stops_runner(tmp_path, monkeypatch):
    runner = managed("runner")
    shutdown = []
    monkeypatch.setattr(
        launcher, "resolve_mutable_paths", lambda env: _mutable(tmp_path)
    )
    monkeypatch.setattr(launcher, "create_mutable_directories", lambda paths: None)
    monkeypatch.setattr(launcher, "validate_installation", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        launcher, "_start_runner", lambda *args, **kwargs: (runner, 8001)
    )
    monkeypatch.setattr(
        launcher,
        "_start_service",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("service timeout")),
    )
    monkeypatch.setattr(
        launcher,
        "_graceful_shutdown",
        lambda service, owned_runner, **kwargs: shutdown.append(
            (service, owned_runner)
        ),
    )

    assert (
        launcher.run(
            installation=object(),
            source_environment={},
            open_browser=False,
        )
        == 1
    )
    assert shutdown == [(None, runner)]


def test_signal_ui_quit_and_child_failure_are_detected():
    stop = threading.Event()
    stop.set()
    assert launcher._wait_for_stop(managed("service"), managed("runner"), stop) == (
        0,
        None,
    )

    assert launcher._wait_for_stop(
        managed("service", 0), managed("runner"), threading.Event()
    ) == (0, None)

    status, message = launcher._wait_for_stop(
        managed("service"), managed("runner", 7), threading.Event()
    )
    assert status == 1
    assert "runner exited with status 7" in message


def test_shutdown_orders_service_before_runner_and_escalates(monkeypatch):
    service = managed("service")
    runner = managed("runner")
    calls = []
    monkeypatch.setattr(
        launcher,
        "request_service_shutdown",
        lambda url, cookie: calls.append(("request", url, cookie)) or True,
    )
    monkeypatch.setattr(
        launcher,
        "wait_for_exit",
        lambda process, timeout: calls.append(("wait", process.name, timeout)) or False,
    )
    monkeypatch.setattr(
        launcher,
        "terminate_process_group",
        lambda process, **kwargs: calls.append(("terminate", process.name, kwargs)),
    )

    launcher._graceful_shutdown(
        service,
        runner,
        service_url="http://127.0.0.1:8765",
        browser_session="cookie",
    )

    assert [call[0:2] for call in calls] == [
        ("request", "http://127.0.0.1:8765"),
        ("wait", "service"),
        ("terminate", "service"),
        ("terminate", "runner"),
    ]


def test_exact_child_commands_keep_tokens_out_of_argv(tmp_path, monkeypatch):
    installation = InstallationPaths(
        root=tmp_path / "install root",
        python=tmp_path / "install root/runtime/python/bin/python3",
        site_packages=tmp_path / "install root/app/python/site-packages",
        node=tmp_path / "install root/runtime/node/bin/node",
        runner_dir=tmp_path / "install root/runner",
        runner_entry=tmp_path / "install root/runner/node_modules/tsx/dist/cli.mjs",
        sandbox_agent=tmp_path / "install root/bin/sandbox-agent-wrapper",
        renderer_dir=tmp_path / "install root/app/web",
        migrations_dir=tmp_path / "install root/app/migrations",
    )
    captured = []

    def start(name, argv, **kwargs):
        captured.append((name, argv, kwargs))
        return managed(name)

    def retry(attempt, **kwargs):
        process, ready = attempt(48123 if not captured else 48124)
        assert ready
        return process, 48123 if len(captured) == 1 else 48124

    monkeypatch.setattr(launcher, "start_process", start)
    monkeypatch.setattr(launcher, "retry_eaddrinuse", retry)
    monkeypatch.setattr(launcher, "wait_for_runner", lambda *args, **kwargs: True)
    monkeypatch.setattr(launcher, "wait_for_endpoint", lambda *args, **kwargs: True)
    log = ComponentLog(tmp_path / "child.log", BytesIO())
    stop = threading.Event()

    launcher._start_runner(
        installation,
        log,
        {"PATH": "/usr/bin", "OPENAI_API_KEY": "drop-me"},
        "runner-secret",
        stop,
    )
    lock = type("Lock", (), {"fd": 17})()
    launcher._start_service(
        installation,
        log,
        {"PATH": "/usr/bin", "AGENTA_API_KEY": "drop-me"},
        lock,
        data_dir=tmp_path / "data",
        runner_url="http://127.0.0.1:48123",
        runner_token="runner-secret",
        browser_session="browser-secret",
        stop_requested=stop,
    )

    runner_name, runner_argv, runner_options = captured[0]
    service_name, service_argv, service_options = captured[1]
    assert runner_name == "runner"
    assert runner_argv == [
        str(installation.node),
        str(installation.runner_entry),
        "src/server.ts",
    ]
    assert service_name == "service"
    assert service_argv == [
        str(installation.python),
        "-m",
        "agenta_local.entrypoints.server",
    ]
    assert service_options["pass_fds"] == (17,)
    assert "runner-secret" not in " ".join(runner_argv + service_argv)
    assert "browser-secret" not in " ".join(runner_argv + service_argv)
    assert runner_options["env"]["AGENTA_RUNNER_TOKEN"] == "runner-secret"
    assert service_options["env"]["AGENTA_LOCAL_BROWSER_SESSION"] == "browser-secret"
    assert "OPENAI_API_KEY" not in runner_options["env"]
    assert "AGENTA_API_KEY" not in service_options["env"]


def _mutable(tmp_path):
    from agenta_local.launcher.paths import MutablePaths

    data = tmp_path / "data"
    logs = tmp_path / "logs"
    data.mkdir(exist_ok=True)
    logs.mkdir(exist_ok=True)
    return MutablePaths(data, tmp_path, logs, data / "workspace.lock")


URL = "http://127.0.0.1:8765"


def test_browser_open_uses_platform_opener(monkeypatch, capsys):
    opened = []
    monkeypatch.setattr(
        launcher.subprocess,
        "run",
        lambda argv, **kwargs: (
            opened.append(argv) or subprocess.CompletedProcess(argv, 0)
        ),
    )

    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setattr(launcher.shutil, "which", lambda name: f"/usr/bin/{name}")
    launcher.open_ui_url(URL)
    assert opened == [["/usr/bin/open", URL]]

    monkeypatch.setattr(sys, "platform", "linux")
    launcher.open_ui_url(URL)
    assert opened[-1] == ["/usr/bin/xdg-open", URL]

    assert URL not in capsys.readouterr().out


def test_browser_open_fails_soft_to_printing_url(monkeypatch, capsys):
    def failing_run(argv, **kwargs):
        return subprocess.CompletedProcess(argv, 1)

    monkeypatch.setattr(launcher.subprocess, "run", failing_run)
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(launcher.shutil, "which", lambda name: "/usr/bin/xdg-open")

    launcher.open_ui_url(URL)
    assert URL in capsys.readouterr().out

    monkeypatch.setattr(launcher.shutil, "which", lambda name: None)
    launcher.open_ui_url(URL)
    assert URL in capsys.readouterr().out

    def raising_run(argv, **kwargs):
        raise OSError("no desktop")

    monkeypatch.setattr(launcher.subprocess, "run", raising_run)
    monkeypatch.setattr(launcher.shutil, "which", lambda name: "/usr/bin/xdg-open")
    launcher.open_ui_url(URL)
    assert URL in capsys.readouterr().out


def test_run_opens_browser_only_when_requested(tmp_path, monkeypatch):
    mutable = _mutable(tmp_path)
    opened = []
    terminated = []
    runner = managed("runner")
    service = managed("service", 0)

    monkeypatch.setattr(launcher, "resolve_mutable_paths", lambda env: mutable)
    monkeypatch.setattr(launcher, "create_mutable_directories", lambda paths: None)
    monkeypatch.setattr(launcher, "validate_installation", lambda *args, **kwargs: None)
    monkeypatch.setattr(
        launcher, "_start_runner", lambda *args, **kwargs: (runner, 48131)
    )
    monkeypatch.setattr(
        launcher, "_start_service", lambda *args, **kwargs: (service, 48132)
    )
    monkeypatch.setattr(
        launcher,
        "terminate_process_group",
        lambda process, **kwargs: terminated.append(process.name),
    )
    monkeypatch.setattr(launcher, "open_ui_url", lambda url: opened.append(url))
    monkeypatch.setattr(launcher.signal, "signal", lambda *args, **kwargs: None)

    assert (
        launcher.run(
            installation=object(),
            source_environment={},
            open_browser=False,
        )
        == 0
    )
    assert opened == []
    assert (
        launcher.run(
            installation=object(),
            source_environment={},
            open_browser=True,
        )
        == 0
    )
    assert opened == [f"http://{launcher.LOOPBACK}:48132"]
