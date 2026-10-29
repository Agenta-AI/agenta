# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart guard for the worker and cron liveness probes.

cron and the two workers each run their process as PID 1, so the container lifecycle
already restarts a process that exits. What nothing caught was a process that is alive
and no longer making progress. The probes that used to be here ran `pgrep` against that
same PID 1, and `pgrep` is not in the image (agenta#7334).

The replacement is a file the application keeps fresh and a probe that fails when it goes
stale. Two things can break that quietly, and both are pinned here:

* the writer and the reader disagreeing about the path. The application writes where
  `AGENTA_HEARTBEAT_FILE` says; the probe reads a path baked into its command. If those
  ever differ, every one of those pods restarts every few minutes, and the only clue is a
  restart count.
* the freshness arithmetic being wrong. A command that treats a missing or empty file as
  recent protects nothing, and one that mis-reads a fresh file restarts healthy pods. The
  command is run here against real files rather than pattern-matched.

Run: uv run hosting/kubernetes/helm/tests/test_heartbeat_liveness.py
Requires the `helm` binary and a POSIX shell on PATH.
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]
RELEASE = "heartbeat-test"
ENV_NAME = "AGENTA_HEARTBEAT_FILE"

# The workloads whose loops report, so the ones that get a probe.
WANT_PROBE = {
    f"Deployment/{RELEASE}-agenta-cron",
    f"Deployment/{RELEASE}-agenta-worker-streams",
    f"Deployment/{RELEASE}-agenta-worker-queues",
}

URL_ARGS = [
    "--set",
    "agenta.webUrl=https://agenta.example.com",
    "--set",
    "agenta.apiUrl=https://agenta.example.com/api",
    "--set",
    "agenta.servicesUrl=https://agenta.example.com/services",
]
KEY_ARGS = [
    "--set",
    "agenta.authKey=0000000000000000000000000000000000000000000000000000000000000000",
    "--set",
    "agenta.cryptKey=1111111111111111111111111111111111111111111111111111111111111111",
    "--set",
    "agenta.servicesInternalKey=2222222222222222222222222222222222222222222222222222222222222222",
    "--set",
    "agenta.runnerToken=3333333333333333333333333333333333333333333333333333333333333333",
    "--set",
    "postgres.password=a-real-password",
]


def render(extra: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            RELEASE,
            str(CHART_DIR),
            *URL_ARGS,
            *KEY_ARGS,
            *(extra or []),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(f"helm template failed:\n{result.stderr}")
    return [d for d in yaml.safe_load_all(result.stdout) if d]


def workloads(parsed: list[dict]):
    for d in parsed:
        if d.get("kind") not in ("Deployment", "Job", "StatefulSet"):
            continue
        ref = f"{d['kind']}/{d['metadata']['name']}"
        for c in d["spec"]["template"]["spec"].get("containers") or []:
            yield ref, c


def env_of(container: dict) -> dict:
    return {e["name"]: e.get("value") for e in container.get("env") or []}


def run_probe(command: list[str]) -> int:
    """Run a rendered exec command and return its exit status, as the kubelet would."""
    return subprocess.run(command, capture_output=True).returncode


def main() -> int:
    failures: list[str] = []
    total = 0

    def check(cond: bool, msg: str) -> None:
        nonlocal total
        total += 1
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            failures.append(msg)

    # --- the default shape ----------------------------------------------------
    parsed = render()
    probed = {
        ref
        for ref, c in workloads(parsed)
        if (c.get("livenessProbe") or {}).get("exec")
        and "heartbeat" in " ".join(c["livenessProbe"]["exec"]["command"])
    }
    check(
        probed == WANT_PROBE,
        "exactly cron and the two workers get a heartbeat probe"
        + (
            ""
            if probed == WANT_PROBE
            else f" (extra {sorted(probed - WANT_PROBE)}, missing {sorted(WANT_PROBE - probed)})"
        ),
    )

    # --- the writer and the reader must agree, which is the whole point -------
    mismatched = []
    for ref, c in workloads(parsed):
        if ref not in WANT_PROBE:
            continue
        configured = env_of(c).get(ENV_NAME)
        command = " ".join(c["livenessProbe"]["exec"]["command"])
        if not configured or configured not in command:
            mismatched.append(
                f"{ref}: env={configured!r} not found in the probe command"
            )
    check(
        not mismatched,
        "every probed workload reads the same path the application is told to write"
        + ("" if not mismatched else f" ({mismatched})"),
    )

    # --- the arithmetic, run for real ----------------------------------------
    sample = next(
        c["livenessProbe"]["exec"]["command"]
        for ref, c in workloads(parsed)
        if ref in WANT_PROBE
    )
    with tempfile.TemporaryDirectory() as directory:
        beats = Path(directory)
        # Point the rendered command at a directory this test controls, changing
        # nothing else about the command.
        rendered_path = env_of(
            next(c for ref, c in workloads(parsed) if ref in WANT_PROBE)
        )[ENV_NAME]
        command = [part.replace(rendered_path, str(beats)) for part in sample]

        def fresh(name: str) -> None:
            (beats / name).write_text(f"{int(time.time())}\n")

        def stale(name: str) -> None:
            (beats / name).write_text(f"{int(time.time()) - 10_000}\n")

        def clear() -> None:
            for f in beats.iterdir():
                f.unlink()

        check(run_probe(command) != 0, "an empty directory fails the probe")

        fresh("spans")
        check(run_probe(command) == 0, "one fresh loop passes")

        # THE CASE THE REVIEW FOUND. Several consumer loops share one process, so a
        # healthy loop must not cover for a stalled one.
        stale("records")
        check(
            run_probe(command) != 0,
            "one stalled loop fails the probe even while another is fresh",
        )

        clear()
        fresh("spans")
        fresh("records")
        fresh("events")
        check(run_probe(command) == 0, "three fresh loops pass")

        (beats / "events").write_text("")
        check(
            run_probe(command) != 0, "an empty file fails rather than reading as fresh"
        )

        (beats / "events").write_text("not-a-number\n")
        check(run_probe(command) != 0, "a file that is not a timestamp fails")

        # A path with a space: the application would write it, so the probe has to
        # read it. Unquoted, `test` and `cat` would split the argument and restart a
        # healthy pod.
        clear()
        spaced = Path(directory) / "beats with space"
        spaced.mkdir()
        spaced_command = [part.replace(rendered_path, str(spaced)) for part in sample]
        (spaced / "spans").write_text(f"{int(time.time())}\n")
        check(
            run_probe(spaced_command) == 0,
            "a directory whose name contains a space still passes",
        )
        (spaced / "records").write_text(f"{int(time.time()) - 10_000}\n")
        check(run_probe(spaced_command) != 0, "and a stalled loop there still fails")

    # --- the switch and the settings -----------------------------------------
    parsed = render(["--set", "heartbeat.enabled=false"])
    any_env = any(ENV_NAME in env_of(c) for _, c in workloads(parsed))
    any_probe = any(
        "heartbeat"
        in " ".join(
            ((c.get("livenessProbe") or {}).get("exec") or {}).get("command") or []
        )
        for _, c in workloads(parsed)
    )
    check(
        not any_env and not any_probe,
        "turning it off removes the variable and the probes together",
    )

    parsed = render(
        [
            "--set",
            "heartbeat.path=/var/run/agenta/beat",
            "--set",
            "heartbeat.staleSeconds=45",
        ]
    )
    bad = []
    for ref, c in workloads(parsed):
        if ref not in WANT_PROBE:
            continue
        command = " ".join(c["livenessProbe"]["exec"]["command"])
        if "/var/run/agenta/beat" not in command:
            bad.append(f"{ref}: custom path missing from the probe")
        if "-lt 45 " not in command + " ":
            bad.append(f"{ref}: custom staleSeconds missing from the probe")
        if env_of(c).get(ENV_NAME) != "/var/run/agenta/beat":
            bad.append(f"{ref}: custom path missing from the environment")
        if c["livenessProbe"].get("initialDelaySeconds") != 45:
            bad.append(f"{ref}: initial delay should follow staleSeconds")
    check(
        not bad,
        "a custom path and threshold reach both the writer and the reader"
        + ("" if not bad else f" ({bad})"),
    )

    # --- an operator override still wins -------------------------------------
    override = {"httpGet": {"path": "/healthz", "port": 8080}, "periodSeconds": 11}
    parsed = render(
        ["--set-json", f"workerQueues.livenessProbe={json.dumps(override)}"]
    )
    got = next(
        (
            c.get("livenessProbe")
            for ref, c in workloads(parsed)
            if ref == f"Deployment/{RELEASE}-agenta-worker-queues"
            and c.get("livenessProbe")
        ),
        None,
    )
    check(
        got is not None
        and got.get("httpGet", {}).get("path") == "/healthz"
        and got.get("periodSeconds") == 11,
        "an operator's own probe replaces the generated one",
    )

    print(f"\n{total - len(failures)}/{total} checks passed")
    if failures:
        return 1
    print(
        "OK: the heartbeat probe reads what the application writes, and the arithmetic holds."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
