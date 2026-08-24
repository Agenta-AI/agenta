"""Launch and supervise the bundled runner and local service."""

from __future__ import annotations

import argparse
import os
import secrets
import shutil
import signal
import subprocess
import sys
import threading
from collections.abc import Mapping
from pathlib import Path

from agenta_local.launcher.health import (
    request_service_shutdown,
    wait_for_endpoint,
    wait_for_runner,
)
from agenta_local.launcher.lock import WorkspaceLock, WorkspaceLocked
from agenta_local.launcher.logs import ComponentLog, LogManager
from agenta_local.launcher.paths import (
    ComponentError,
    InstallationPaths,
    create_mutable_directories,
    resolve_installation,
    resolve_mutable_paths,
    validate_installation,
)
from agenta_local.launcher.ports import LOOPBACK, retry_eaddrinuse
from agenta_local.launcher.processes import (
    ManagedProcess,
    runner_environment,
    service_environment,
    start_process,
    terminate_process_group,
    wait_for_exit,
)

STARTUP_DEADLINE = 30.0
SERVICE_SHUTDOWN_DEADLINE = 15.0
RUNNER_SHUTDOWN_DEADLINE = 10.0


def open_ui_url(url: str) -> None:
    """Open the UI with the platform opener; fail soft to printing the URL."""
    opener = (
        shutil.which("open") if sys.platform == "darwin" else shutil.which("xdg-open")
    )
    if opener is not None:
        try:
            completed = subprocess.run(
                [opener, url],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
            )
            if completed.returncode == 0:
                return
        except OSError:
            pass
    print(f"Agenta Local is running at {url}")


def _start_runner(
    installation: InstallationPaths,
    log: ComponentLog,
    source_environment: Mapping[str, str],
    token: str,
    stop_requested: threading.Event,
) -> tuple[ManagedProcess, int]:
    def attempt(port: int) -> tuple[ManagedProcess, bool]:
        environment = runner_environment(
            source_environment,
            port=port,
            token=token,
            node_bin_dir=installation.node.parent,
            sandbox_agent=installation.sandbox_agent,
        )
        try:
            process = start_process(
                "runner",
                [
                    str(installation.node),
                    str(installation.runner_entry),
                    "src/server.ts",
                ],
                cwd=installation.runner_dir,
                env=environment,
                log=log.stream,
                log_path=log.path,
            )
        except OSError as exc:
            raise RuntimeError(f"runner failed to start; log: {log.path}") from exc
        ready = wait_for_runner(
            f"http://{LOOPBACK}:{port}",
            token,
            deadline=STARTUP_DEADLINE,
            process=process,
            cancelled=stop_requested.is_set,
        )
        if not ready:
            terminate_process_group(process, terminate_timeout=2.0)
            if stop_requested.is_set():
                raise KeyboardInterrupt
        return process, ready

    try:
        return retry_eaddrinuse(attempt, log_path=log.path)
    except (OSError, RuntimeError) as exc:
        raise RuntimeError(f"runner failed to become ready; log: {log.path}") from exc


def _start_service(
    installation: InstallationPaths,
    log: ComponentLog,
    source_environment: Mapping[str, str],
    lock: WorkspaceLock,
    *,
    data_dir: Path,
    runner_url: str,
    runner_token: str,
    browser_session: str,
    stop_requested: threading.Event,
) -> tuple[ManagedProcess, int]:
    def attempt(port: int) -> tuple[ManagedProcess, bool]:
        environment = service_environment(
            source_environment,
            host=LOOPBACK,
            port=port,
            data_dir=data_dir,
            static_dir=installation.renderer_dir,
            migrations_dir=installation.migrations_dir,
            runner_url=runner_url,
            runner_token=runner_token,
            browser_session=browser_session,
            lock_fd=lock.fd,
            site_packages=installation.site_packages,
        )
        try:
            process = start_process(
                "service",
                [
                    str(installation.python),
                    "-m",
                    "agenta_local.entrypoints.server",
                ],
                cwd=installation.root,
                env=environment,
                log=log.stream,
                log_path=log.path,
                pass_fds=(lock.fd,),
            )
        except OSError as exc:
            raise RuntimeError(
                f"local service failed to start; log: {log.path}"
            ) from exc
        ready = wait_for_endpoint(
            f"http://{LOOPBACK}:{port}/health",
            deadline=STARTUP_DEADLINE,
            process=process,
            cancelled=stop_requested.is_set,
        )
        if not ready:
            terminate_process_group(process, terminate_timeout=2.0)
            if stop_requested.is_set():
                raise KeyboardInterrupt
        return process, ready

    try:
        return retry_eaddrinuse(attempt, log_path=log.path)
    except (OSError, RuntimeError) as exc:
        raise RuntimeError(
            f"local service failed to become ready; log: {log.path}"
        ) from exc


def _graceful_shutdown(
    service: ManagedProcess | None,
    runner: ManagedProcess | None,
    *,
    service_url: str | None,
    browser_session: str,
) -> None:
    if service is not None and service.poll() is None:
        if service_url is not None:
            request_service_shutdown(service_url, browser_session)
        if not wait_for_exit(service, SERVICE_SHUTDOWN_DEADLINE):
            terminate_process_group(
                service,
                terminate_timeout=2.0,
                kill_timeout=2.0,
            )
    if runner is not None and runner.poll() is None:
        terminate_process_group(
            runner,
            terminate_timeout=RUNNER_SHUTDOWN_DEADLINE,
            kill_timeout=2.0,
        )


def _wait_for_stop(
    service: ManagedProcess,
    runner: ManagedProcess,
    stop_requested: threading.Event,
) -> tuple[int, str | None]:
    while not stop_requested.wait(0.1):
        runner_status = runner.poll()
        if runner_status is not None:
            return (
                1,
                f"runner exited with status {runner_status}; log: {runner.log_path}",
            )
        service_status = service.poll()
        if service_status is not None:
            if service_status == 0:
                return 0, None
            return (
                1,
                f"local service exited with status {service_status}; log: {service.log_path}",
            )
    return 0, None


def run(
    *,
    installation: InstallationPaths,
    source_environment: Mapping[str, str],
    open_browser: bool,
    stop_requested: threading.Event | None = None,
) -> int:
    mutable = resolve_mutable_paths(source_environment)
    stop_requested = stop_requested or threading.Event()

    try:
        create_mutable_directories(mutable)
        lock = WorkspaceLock.acquire(mutable.lock_file, mutable.data_dir)
    except WorkspaceLocked as exc:
        print(str(exc), file=sys.stderr)
        return 2
    except OSError as exc:
        print(
            f"Agenta Local cannot secure workspace {mutable.data_dir}: {exc}",
            file=sys.stderr,
        )
        return 1

    runner: ManagedProcess | None = None
    service: ManagedProcess | None = None
    service_url: str | None = None
    runner_log: ComponentLog | None = None
    service_log: ComponentLog | None = None
    browser_session = secrets.token_urlsafe(32)
    runner_token = secrets.token_hex(32)
    previous_handlers: dict[int, object] = {}

    def handle_signal(_signum: int, _frame: object) -> None:
        stop_requested.set()

    try:
        manager = LogManager(mutable.logs_dir)
        runner_log = manager.open("runner")
        service_log = manager.open("service")
        validate_installation(
            installation,
            runner_log=runner_log.path,
            service_log=service_log.path,
        )

        for signum in (signal.SIGINT, signal.SIGTERM):
            try:
                previous_handlers[signum] = signal.signal(signum, handle_signal)
            except ValueError:
                # Tests may call run from a worker thread.
                previous_handlers.clear()
                break

        runner, runner_port = _start_runner(
            installation,
            runner_log,
            source_environment,
            runner_token,
            stop_requested,
        )
        runner_url = f"http://{LOOPBACK}:{runner_port}"
        service, service_port = _start_service(
            installation,
            service_log,
            source_environment,
            lock,
            data_dir=mutable.data_dir,
            runner_url=runner_url,
            runner_token=runner_token,
            browser_session=browser_session,
            stop_requested=stop_requested,
        )
        service_url = f"http://{LOOPBACK}:{service_port}"
        if open_browser:
            open_ui_url(service_url)
        status, message = _wait_for_stop(service, runner, stop_requested)
        if message is not None:
            print(message, file=sys.stderr)
        return status
    except (ComponentError, RuntimeError, OSError) as exc:
        print(f"Agenta Local failed to start: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        _graceful_shutdown(
            service,
            runner,
            service_url=service_url,
            browser_session=browser_session,
        )
        for signum, previous in previous_handlers.items():
            signal.signal(signum, previous)
        if service_log is not None:
            service_log.close()
        if runner_log is not None:
            runner_log.close()
        lock.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--install-root",
        type=Path,
        help=argparse.SUPPRESS,
    )
    parser.add_argument("--no-browser", action="store_true")
    arguments = parser.parse_args(argv)
    try:
        installation = resolve_installation(arguments.install_root)
    except RuntimeError as exc:
        print(f"Agenta Local failed to start: {exc}", file=sys.stderr)
        return 1
    return run(
        installation=installation,
        source_environment=os.environ,
        open_browser=not arguments.no_browser,
    )


if __name__ == "__main__":
    raise SystemExit(main())
