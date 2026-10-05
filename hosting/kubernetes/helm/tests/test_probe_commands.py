# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart guard for exec probe commands, and for the probes we deliberately do not set.

An exec probe that names a program the image does not carry cannot run at all. The kubelet
reports "Liveness probe errored and resulted in unknown state" every period, and because
Kubernetes treats an unstartable probe as unknown rather than failed, nothing restarts and
nothing complains. The workload simply has no liveness check, and the day that treatment
changes, every such pod enters a restart loop at once. That is what agenta#7334 was.

What this pins:

* no exec probe anywhere in the chart calls a program the api image does not carry. The
  deny list holds what we measured missing, not a guess.
* cron, workerStreams and workerQueues render no liveness probe by default. Each runs its
  process as PID 1, so the container lifecycle already covers a process that exits.
* an operator who has a real signal can still supply a probe through values, and it reaches
  the container as written.

Run: uv run hosting/kubernetes/helm/tests/test_probe_commands.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]
RELEASE = "probe-test"

# Measured inside a running worker container on 2026-10-05: `pgrep` and `ps` are absent,
# while `pidof`, `sh`, `grep`, `tr`, `awk` and `cat` are present. Add to this list only
# what you have checked in the image, so a failure here always means something real.
ABSENT_FROM_IMAGE = ("pgrep", "ps")

# The workloads whose process is PID 1 in their own container, so a process-presence probe
# tells the kubelet nothing it does not already know.
NO_DEFAULT_LIVENESS = {
    f"Deployment/{RELEASE}-agenta-cron",
    f"Deployment/{RELEASE}-agenta-worker-streams",
    f"Deployment/{RELEASE}-agenta-worker-queues",
}

URL_ARGS = [
    "--set", "agenta.webUrl=https://agenta.example.com",
    "--set", "agenta.apiUrl=https://agenta.example.com/api",
    "--set", "agenta.servicesUrl=https://agenta.example.com/services",
]

KEY_ARGS = [
    "--set", "agenta.authKey=0000000000000000000000000000000000000000000000000000000000000000",
    "--set", "agenta.cryptKey=1111111111111111111111111111111111111111111111111111111111111111",
    "--set", "agenta.servicesInternalKey=2222222222222222222222222222222222222222222222222222222222222222",
    "--set", "agenta.runnerToken=3333333333333333333333333333333333333333333333333333333333333333",
    "--set", "postgres.password=a-real-password",
]


def render(extra: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        ["helm", "template", RELEASE, str(CHART_DIR), *URL_ARGS, *KEY_ARGS, *(extra or [])],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(f"helm template failed:\n{result.stderr}")
    return [d for d in yaml.safe_load_all(result.stdout) if d]


def workloads(parsed: list[dict]):
    for d in parsed:
        kind = d.get("kind")
        if kind not in ("Deployment", "Job", "StatefulSet"):
            continue
        ref = f"{kind}/{d['metadata']['name']}"
        spec = d["spec"]["template"]["spec"]
        for c in (spec.get("containers") or []) + (spec.get("initContainers") or []):
            yield ref, c


def main() -> int:
    failures: list[str] = []
    total = 0

    def check(cond: bool, msg: str) -> None:
        nonlocal total
        total += 1
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            failures.append(msg)

    parsed = render()

    # --- no probe calls a program the image does not carry --------------------
    offenders: list[str] = []
    for ref, c in workloads(parsed):
        for probe_name in ("livenessProbe", "readinessProbe", "startupProbe"):
            probe = c.get(probe_name) or {}
            command = ((probe.get("exec") or {}).get("command")) or []
            if not command:
                continue
            program = str(command[0]).rsplit("/", 1)[-1]
            if program in ABSENT_FROM_IMAGE:
                offenders.append(f"{ref} {c['name']}.{probe_name} runs {program!r}")
            # A shell probe can hide the same mistake one argument later.
            joined = " ".join(str(x) for x in command)
            for bad in ABSENT_FROM_IMAGE:
                if program in ("sh", "bash") and f"{bad} " in joined:
                    offenders.append(f"{ref} {c['name']}.{probe_name} shells out to {bad!r}")
    check(
        not offenders,
        "no exec probe calls a program the image does not carry"
        + ("" if not offenders else f" (found: {offenders})"),
    )

    # --- the three PID-1 workloads carry no liveness probe by default --------
    with_liveness = {
        ref for ref, c in workloads(parsed) if c.get("livenessProbe") and ref in NO_DEFAULT_LIVENESS
    }
    check(
        not with_liveness,
        "cron and the two workers render no liveness probe by default"
        + ("" if not with_liveness else f" (found on {sorted(with_liveness)})"),
    )

    # --- an operator-supplied probe reaches the container as written ---------
    probe = {
        "exec": {"command": ["sh", "-c", "test -f /tmp/heartbeat"]},
        "periodSeconds": 17,
        "failureThreshold": 4,
    }
    parsed = render(["--set-json", f"workerQueues.livenessProbe={json.dumps(probe)}"])
    got = None
    for ref, c in workloads(parsed):
        if ref == f"Deployment/{RELEASE}-agenta-worker-queues" and c["name"] != "wait-for-redis":
            if c.get("livenessProbe"):
                got = c["livenessProbe"]
    check(got is not None, "a probe set in values reaches the worker container")
    if got:
        check(got.get("periodSeconds") == 17, "the supplied period survives (got %s)" % got.get("periodSeconds"))
        check(
            (got.get("exec") or {}).get("command") == ["sh", "-c", "test -f /tmp/heartbeat"],
            "the supplied command survives unchanged",
        )

    print(f"\n{total - len(failures)}/{total} checks passed")
    if failures:
        return 1
    print("OK: no probe calls a missing program, and the PID-1 workloads set none by default.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
