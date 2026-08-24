import signal
import subprocess
from pathlib import Path

from agenta_local.launcher.processes import (
    ManagedProcess,
    runner_environment,
    service_environment,
    start_process,
    terminate_process_group,
)

SECRETS = {
    "OPENAI_API_KEY": "provider",
    "ANTHROPIC_API_KEY": "provider",
    "AGENTA_API_URL": "cloud",
    "AGENTA_API_KEY": "cloud",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "trace",
    "DAYTONA_API_KEY": "cloud",
    "AWS_SECRET_ACCESS_KEY": "cloud",
    "GOOGLE_APPLICATION_CREDENTIALS": "cloud",
    "AGENTA_RUNNER_UNRELATED": "runner",
}


def test_runner_and_service_environments_drop_shell_secrets(tmp_path):
    source = {
        **SECRETS,
        "PATH": "/usr/bin",
        "HOME": "/home/person",
        "LANG": "en_US.UTF-8",
        "LC_TIME": "C",
        "XDG_DATA_HOME": "/xdg/data",
        "UNRELATED": "drop",
    }
    runner = runner_environment(
        source,
        port=1234,
        token="runner-token",
        node_bin_dir=tmp_path / "node/bin",
        sandbox_agent=tmp_path / "sandbox-agent",
    )
    service = service_environment(
        source,
        host="127.0.0.1",
        port=5678,
        data_dir=tmp_path / "data",
        static_dir=tmp_path / "web",
        migrations_dir=tmp_path / "migrations",
        runner_url="http://127.0.0.1:1234",
        runner_token="runner-token",
        browser_session="browser-value",
        lock_fd=9,
        site_packages=tmp_path / "site packages",
    )

    for name in (*SECRETS, "UNRELATED"):
        assert name not in runner
        assert name not in service
    assert runner["AGENTA_RUNNER_TOKEN"] == "runner-token"
    assert service["AGENTA_RUNNER_TOKEN"] == "runner-token"
    assert service["AGENTA_LOCAL_BROWSER_SESSION"] == "browser-value"
    assert service["AGENTA_LOCAL_LOCK_FD"] == "9"
    assert service["LC_TIME"] == "C"


def test_start_process_uses_array_no_shell_new_session_and_pass_fds(
    tmp_path, monkeypatch
):
    captured = {}

    class Process:
        pid = 321

    def fake_popen(argv, **kwargs):
        captured["argv"] = argv
        captured.update(kwargs)
        return Process()

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    log_path = tmp_path / "service.log"
    with log_path.open("wb") as log:
        managed = start_process(
            "service",
            ["python path", "-m", "module"],
            cwd=tmp_path,
            env={"SAFE": "yes"},
            log=log,
            log_path=log_path,
            pass_fds=(7,),
        )

    assert captured["argv"] == ["python path", "-m", "module"]
    assert captured["shell"] is False
    assert captured["start_new_session"] is True
    assert captured["pass_fds"] == (7,)
    assert managed.pid == 321


def test_process_group_termination_escalates_only_owned_group(monkeypatch):
    calls = []

    class Process:
        pid = 4321

        def poll(self):
            return None

        def wait(self, timeout):
            calls.append(("wait", timeout))
            if timeout == 1.0:
                raise subprocess.TimeoutExpired("fake", timeout)
            return -signal.SIGKILL

    monkeypatch.setattr(
        "agenta_local.launcher.processes.os.killpg",
        lambda pid, signum: calls.append(("killpg", pid, signum)),
    )
    managed = ManagedProcess("runner", Process(), Path("runner.log"))

    terminate_process_group(managed, terminate_timeout=1.0, kill_timeout=0.5)

    assert calls == [
        ("killpg", 4321, signal.SIGTERM),
        ("wait", 1.0),
        ("killpg", 4321, signal.SIGKILL),
        ("wait", 0.5),
    ]
