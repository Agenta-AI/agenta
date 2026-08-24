"""Relocation proof: run a staged runner from a path with spaces and pass a turn.

Usage:
    uv run --no-sync python packaging/runner/verify_runner.py <staged-root> \
        [--provider openai] [--model gpt-4o-mini] [--prompt ...] \
        [--strace] [--skip-turn] [--keep]

This is the operator gate. A missing provider key is a hard failure unless
--skip-turn is given; nothing is silently skipped.
"""

import argparse
import asyncio
import ipaddress
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import httpx
from agenta_local.core.agents.dtos import AgentModel, AgentRevision
from agenta_local.core.execution.dtos import (
    ExecutionCredential,
    ExecutionMessage,
)
from agenta_local.core.execution.errors import ExecutionError
from agenta_local.execution.sdk.adapter import SDKAgentExecutor

READY_TIMEOUT_SECONDS = 30.0
TERMINATE_GRACE_SECONDS = 10.0
SUBSTATUS_ATTEMPTS = 3
SUBSTATUS_SPACING_SECONDS = 1.0
PROVIDER_API_HOSTS = {
    "openai": "api.openai.com",
    "anthropic": "api.anthropic.com",
}

results: list[tuple[bool, str]] = []


def report(ok: bool, label: str) -> None:
    results.append((ok, label))
    print(f"{'PASS' if ok else 'FAIL'}: {label}")


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _spaces_temp_root() -> Path:
    """A unique not-yet-created temp path containing spaces (relocation proof)."""
    while True:
        candidate = (
            Path(tempfile.gettempdir())
            / "opencode"
            / f"ag local verify {secrets.token_hex(3)}"
        )
        if not candidate.exists():
            return candidate


def build_launch_env(
    copied: Path, port: int, token: str
) -> tuple[dict[str, str], list[Path]]:
    """Explicit allowlist env plus the fresh dirs it points at."""
    home = copied / "home fresh"
    xdg_data = copied / "xdg data fresh"
    home.mkdir()
    xdg_data.mkdir()
    env = {
        "PATH": f"{copied}/runtime/node/bin:/usr/bin:/bin",
        "HOME": str(home),
        "XDG_DATA_HOME": str(xdg_data),
        "npm_config_offline": "true",
        "NODE_ENV": "production",
        "AGENTA_RUNNER_HOST": "127.0.0.1",
        "AGENTA_RUNNER_PORT": str(port),
        "AGENTA_RUNNER_TOKEN": token,
        "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS": "local",
        "AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER": "local",
        "AGENTA_SESSIONS_RECONSTRUCT": "false",
        "AGENTA_RUNNER_SESSION_KEEPALIVE": "off",
        "SANDBOX_AGENT_BIN": str(copied / "bin" / "sandbox-agent-wrapper"),
    }
    for passthrough in ("LANG", "TMPDIR"):
        if value := os.environ.get(passthrough):
            env[passthrough] = value
    return env, [home, xdg_data]


def wait_ready(base_url: str) -> bool:
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        try:
            response = httpx.get(f"{base_url}/health", timeout=2.0)
            if response.status_code == 200:
                return True
        except httpx.HTTPError:
            pass
        time.sleep(0.5)
    return False


def wait_subscription_ready(runner_url: str, token: str) -> bool:
    """Up to 3 attempts ~1s apart; the route can lag /health on cold start."""
    for attempt in range(SUBSTATUS_ATTEMPTS):
        try:
            response = httpx.get(
                f"{runner_url}/subscription-status",
                headers={"Authorization": f"Bearer {token}"},
                timeout=5.0,
            )
        except httpx.HTTPError:
            response = None
        if response is not None and response.status_code == 200:
            return True
        if attempt < SUBSTATUS_ATTEMPTS - 1:
            time.sleep(SUBSTATUS_SPACING_SECONDS)
    return False


async def run_turn(args: argparse.Namespace, runner_url: str, api_key: str) -> str:
    revision = AgentRevision(
        id="verify",
        version=1,
        instructions=args.instructions,
        model=AgentModel(provider=args.provider, name=args.model),
    )
    executor = SDKAgentExecutor(runner_url=runner_url)
    stream = executor.stream(
        revision=revision,
        messages=[ExecutionMessage(role="user", content=args.prompt)],
        credential=ExecutionCredential(
            provider=args.provider, api_key=api_key, base_url=args.base_url
        ),
    )
    event_count = 0
    try:
        async for _event in stream.events:
            event_count += 1
        result = await stream.result()
    except ExecutionError as exc:
        raise RuntimeError(f"turn failed: {exc}") from exc
    print(f"drained {event_count} events")
    return result.assistant_text


def resolve_provider_ips(host: str) -> set[str]:
    ips: set[str] = set()
    try:
        for info in socket.getaddrinfo(host, 443):
            ips.add(str(info[4][0]))
    except OSError:
        pass
    return ips


STRACE_CONNECT_RE = (
    r"sa_family=AF_INET\S*\s+sin_port=htons\(\d+\),\s+"
    r"sin6?_addr=(?:inet_addr|inet_pton)\(\"([^\"]+)\"\)"
)


def classify_strace(trace_path: Path, provider: str) -> None:
    """Loopback and resolved provider IPs are OK; anything else warns (no hard fail)."""
    text = trace_path.read_text(errors="ignore")
    # Only connect() syscalls; getsockname/netlink echo the host's own addresses.
    destinations = {
        ip
        for line in text.splitlines()
        if "connect(" in line
        for ip in re.findall(STRACE_CONNECT_RE, line)
    }
    if not destinations:
        report(False, "strace captured no IPv4/IPv6 connect() calls (parse problem)")
        return
    allowed: dict[str, str] = {}
    for ip in destinations:
        addr = ipaddress.ip_address(ip)
        if addr.is_loopback:
            allowed[ip] = "loopback (runner/DNS)"
            continue
        if ip in resolve_provider_ips(
            PROVIDER_API_HOSTS.get(provider, f"{provider}.api")
        ):
            allowed[ip] = f"provider host ({provider})"
    unexpected = sorted(set(destinations) - set(allowed))
    print("strace connect() classification:")
    for ip in sorted(allowed):
        print(f"  OK      {ip}  {allowed[ip]}")
    for ip in unexpected:
        print(f"  WARNING {ip}  unclassified destination (hard gate is the clean VM)")
    report(
        True,
        f"classified {len(destinations)} connect() targets ({len(unexpected)} warned)",
    )


def teardown(process: subprocess.Popen[str], copied: Path) -> bool:
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=TERMINATE_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass  # survivor sweep below reports it
    survivors = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit() or int(entry.name) == os.getpid():
            continue
        try:
            cmdline = (entry / "cmdline").read_bytes()
        except OSError:
            continue
        if str(copied).encode() in cmdline:
            survivors.append(entry.name)
    return not survivors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("staged_root", type=Path)
    parser.add_argument("--provider", default="openai")
    parser.add_argument("--model", default="gpt-4o-mini")
    parser.add_argument("--prompt", default="Reply with the single word: pong.")
    parser.add_argument("--instructions", default="You are a helpful assistant.")
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--strace", action="store_true")
    parser.add_argument("--skip-turn", action="store_true")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args(argv)

    staged = args.staged_root.resolve()
    node_bin = staged / "runtime" / "node" / "bin" / "node"
    tsx_cli = staged / "runner" / "node_modules" / "tsx" / "dist" / "cli.mjs"
    wrapper = staged / "bin" / "sandbox-agent-wrapper"
    for required in (node_bin, tsx_cli, wrapper):
        if not required.exists():
            print(f"error: staged tree missing {required}", file=sys.stderr)
            return 2

    api_key: str | None = None
    if not args.skip_turn:
        env_name = f"{args.provider.upper()}_API_KEY"
        api_key = os.environ.get(env_name)
        if not api_key:
            print(
                f"FAIL: {env_name} is not set; this script is the operator gate and "
                "does not skip turns silently. Export the key or pass --skip-turn."
            )
            return 1

    copied = _spaces_temp_root()
    # symlinks=True preserves pnpm's link farm; flattening breaks resolution.
    shutil.copytree(staged, copied, symlinks=True)
    print(f"relocated stage to: {copied}")

    port = _free_port()
    token = secrets.token_hex(32)
    runner_url = f"http://127.0.0.1:{port}"
    env, fresh_dirs = build_launch_env(copied, port, token)

    argv_base = [str(node_bin), str(tsx_cli), "src/server.ts"]
    argv_full = (
        [
            "strace",
            "-f",
            "-qq",
            "-e",
            "trace=network",
            "-o",
            str(copied / "network.strace"),
        ]
        + argv_base
        if args.strace
        else argv_base
    )
    stdout_log = (copied / "runner stdout.log").open("wb")
    stderr_log = (copied / "runner stderr.log").open("wb")
    process = subprocess.Popen(
        argv_full,
        cwd=str(copied / "runner"),
        env=env,
        stdout=stdout_log,
        stderr=stderr_log,
        start_new_session=True,
    )

    exit_code = 0
    turn_text: str | None = None
    try:
        ready = wait_ready(runner_url)
        report(ready, "GET /health reached 200 within 30s from spaces path")
        authed = False
        if ready:
            authed = wait_subscription_ready(runner_url, token)
        report(authed, "authenticated GET /subscription-status returned 200")

        if args.skip_turn:
            report(True, "turn skipped by --skip-turn flag")
        elif ready and authed:
            # The SDK handler authenticates to the runner from the process env.
            previous_token = os.environ.get("AGENTA_RUNNER_TOKEN")
            os.environ["AGENTA_RUNNER_TOKEN"] = token
            try:
                turn_text = asyncio.run(run_turn(args, runner_url, api_key or ""))
            except RuntimeError as exc:
                report(False, f"cold turn streamed to completion ({exc})")
            finally:
                if previous_token is None:
                    os.environ.pop("AGENTA_RUNNER_TOKEN", None)
                else:
                    os.environ["AGENTA_RUNNER_TOKEN"] = previous_token
            if turn_text is not None:
                report(
                    bool(turn_text.strip()),
                    f"cold turn produced non-empty assistant text "
                    f"({len(turn_text)} chars)",
                )
        else:
            report(False, "cold turn skipped because runner never became ready")

        if args.strace and (copied / "network.strace").exists():
            classify_strace(copied / "network.strace", args.provider)
        elif args.strace:
            report(False, "--strace requested but no trace file was written")
    finally:
        cleaned = teardown(process, copied)
        report(cleaned, "no surviving processes reference the relocated temp path")
        stdout_log.close()
        stderr_log.close()

    failures = [label for ok, label in results if not ok]
    print("\n=== verify summary ===")
    for ok, label in results:
        print(f"{'PASS' if ok else 'FAIL'}: {label}")
    if not args.keep and process.poll() is not None:
        shutil.rmtree(copied, ignore_errors=True)
        shutil.rmtree(fresh_dirs[0], ignore_errors=True)
        shutil.rmtree(fresh_dirs[1], ignore_errors=True)
        for log in stdout_log, stderr_log:
            Path(log.name).unlink(missing_ok=True)
    else:
        print(f"temp kept: {copied}")
    if failures:
        exit_code = 1
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
