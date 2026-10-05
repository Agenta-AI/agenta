# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for how runner pods replace each other and how long they drain.

  * With only remote sandbox providers, a rollout starts the new pod and waits until it is
    ready before it stops an old one (`RollingUpdate`, maxSurge 1, maxUnavailable 0).
  * With the local provider, a local sandbox lives inside the pod that started it, so the old
    pod stops before the new one starts (`Recreate`). More than one runner pod, and an explicit
    rolling update, are refused at render time.
  * `AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS` defaults to the grace period minus 100 seconds,
    never below 0. An operator value replaces it, and a value past that limit is refused.
  * The runner keeps its PodDisruptionBudget at two pods.

Run: uv run hosting/kubernetes/helm/tests/test_runner_rollout.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]

BASE_ARGS = [
    "--set",
    "agenta.webUrl=https://agenta.example.com",
    "--set",
    "agenta.apiUrl=https://agenta.example.com/api",
    "--set",
    "agenta.servicesUrl=https://agenta.example.com/services",
    "--set",
    "agentRunner.enabled=true",
    "--set",
    "agenta.authKey=test-auth-key",
    "--set",
    "agenta.cryptKey=test-crypt-key",
    "--set",
    "agenta.servicesInternalKey=test-services-internal-key",
    "--set",
    "agenta.runnerToken=test-runner-token",
    "--set",
    "postgres.password=test-postgres-password",
]

REMOTE_ONLY = [
    "--set",
    "agentRunner.providers.enabled={daytona}",
    "--set",
    "agentRunner.providers.default=daytona",
]
LOCAL_AND_REMOTE = [
    "--set",
    "agentRunner.providers.enabled={local,daytona}",
    "--set",
    "agentRunner.providers.default=daytona",
]
TWO_REPLICAS = ["--set", "agentRunner.replicas=2"]

ROLLING = {
    "type": "RollingUpdate",
    "rollingUpdate": {"maxSurge": 1, "maxUnavailable": 0},
}
RECREATE = {"type": "Recreate"}


def helm_template(extra_args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "helm",
            "template",
            "runner-rollout-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *extra_args,
        ],
        capture_output=True,
        text=True,
    )


def render(extra_args: list[str]) -> list[dict]:
    result = helm_template(extra_args)
    if result.returncode != 0:
        raise AssertionError(f"render failed for {extra_args}:\n{result.stderr}")
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def is_runner(doc: dict, kind: str) -> bool:
    labels = doc.get("metadata", {}).get("labels", {})
    return (
        doc.get("kind") == kind
        and labels.get("app.kubernetes.io/component") == "runner"
    )


def runner_deployment(docs: list[dict]) -> dict:
    for doc in docs:
        if is_runner(doc, "Deployment"):
            return doc
    raise AssertionError("no runner Deployment found in the rendered chart")


def runner_env(docs: list[dict]) -> list[dict]:
    containers = runner_deployment(docs)["spec"]["template"]["spec"]["containers"]
    return next(c for c in containers if c["name"] == "runner").get("env", [])


def shutdown_wait(docs: list[dict]) -> list[str | None]:
    return [
        entry.get("value")
        for entry in runner_env(docs)
        if entry["name"] == "AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS"
    ]


def strategy_failures() -> list[str]:
    failures: list[str] = []
    cases = [
        ("local provider (chart default)", [], RECREATE),
        ("local and daytona", LOCAL_AND_REMOTE, RECREATE),
        ("daytona only, one pod", REMOTE_ONLY, ROLLING),
        ("daytona only, two pods", REMOTE_ONLY + TWO_REPLICAS, ROLLING),
        (
            "an explicit strategy wins",
            REMOTE_ONLY + ["--set", "agentRunner.strategy.type=Recreate"],
            RECREATE,
        ),
    ]
    for label, args, expected in cases:
        deployment = runner_deployment(render(args))
        strategy = deployment["spec"].get("strategy")
        if strategy != expected:
            failures.append(f"{label}: strategy {strategy!r}, expected {expected!r}")
    return failures


def replica_guard_failures() -> list[str]:
    failures: list[str] = []
    for label, args in (
        ("local provider (chart default)", TWO_REPLICAS),
        ("local and daytona", LOCAL_AND_REMOTE + TWO_REPLICAS),
    ):
        result = helm_template(args)
        if result.returncode == 0:
            failures.append(f"{label} at two pods rendered instead of failing")
        elif (
            "agentRunner.replicas=2" not in result.stderr
            or '"local"' not in result.stderr
        ):
            failures.append(
                f"{label}: the failure does not name the fix:\n{result.stderr}"
            )

    # The guard is about the runner pods: a release without the runner has nothing to refuse.
    result = helm_template(TWO_REPLICAS + ["--set", "agentRunner.enabled=false"])
    if result.returncode != 0:
        failures.append(f"runner disabled: render failed:\n{result.stderr}")

    if runner_deployment(render([]))["spec"]["replicas"] != 1:
        failures.append("the chart default is no longer one runner pod")
    return failures


def shutdown_wait_failures() -> list[str]:
    failures: list[str] = []
    cases = [
        ("default grace 300", [], "200"),
        (
            "grace 150",
            ["--set", "agentRunner.terminationGracePeriodSeconds=150"],
            "50",
        ),
        (
            "grace 60 never goes below 0",
            ["--set", "agentRunner.terminationGracePeriodSeconds=60"],
            "0",
        ),
        ("explicit wait", ["--set", "agentRunner.shutdownWaitSeconds=150"], "150"),
        (
            "explicit wait at the limit of a longer grace",
            [
                "--set",
                "agentRunner.shutdownWaitSeconds=230",
                "--set",
                "agentRunner.terminationGracePeriodSeconds=330",
            ],
            "230",
        ),
        ("explicit zero wait", ["--set", "agentRunner.shutdownWaitSeconds=0"], "0"),
        (
            "agentRunner.env replaces the chart entry",
            ["--set", "agentRunner.env.AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS=45"],
            "45",
        ),
    ]
    for label, args, expected in cases:
        values = shutdown_wait(render(args))
        if values != [expected]:
            failures.append(f"{label}: AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS {values!r}")

    # A wait past grace - 100 leaves no time to cancel and delete before the KILL signal.
    result = helm_template(["--set", "agentRunner.shutdownWaitSeconds=230"])
    if result.returncode == 0:
        failures.append("a wait of 230 with grace 300 rendered instead of failing")
    elif "agentRunner.shutdownWaitSeconds=230" not in result.stderr:
        failures.append(f"the wait failure does not name the key:\n{result.stderr}")
    return failures


def local_strategy_failures() -> list[str]:
    """With the local provider, an explicit rolling update is refused: the surge pod would run
    beside the old one."""
    failures: list[str] = []
    for label, args in (
        (
            "local, explicit RollingUpdate",
            ["--set", "agentRunner.strategy.type=RollingUpdate"],
        ),
        (
            "local and daytona, a strategy without a type",
            LOCAL_AND_REMOTE
            + ["--set", "agentRunner.strategy.rollingUpdate.maxSurge=1"],
        ),
    ):
        result = helm_template(args)
        if result.returncode == 0:
            failures.append(f"{label}: rendered instead of failing")
        elif (
            "agentRunner.strategy" not in result.stderr
            or '"local"' not in result.stderr
        ):
            failures.append(
                f"{label}: the failure does not name the fix:\n{result.stderr}"
            )
    return failures


def pdb_failures() -> list[str]:
    docs = render(REMOTE_ONLY + TWO_REPLICAS)
    budgets = [doc for doc in docs if is_runner(doc, "PodDisruptionBudget")]
    if len(budgets) != 1:
        return [
            f"two remote runner pods render {len(budgets)} runner budgets, expected 1"
        ]
    return []


def collect_failures() -> list[str]:
    return (
        strategy_failures()
        + replica_guard_failures()
        + shutdown_wait_failures()
        + local_strategy_failures()
        + pdb_failures()
    )


def failure_report(failures: list[str]) -> str:
    return "runner rollout rendering is wrong:\n" + "\n".join(
        f"  - {failure}" for failure in failures
    )


def test_runner_rollout_follows_the_sandbox_providers() -> None:
    failures = collect_failures()
    assert not failures, failure_report(failures)


if __name__ == "__main__":
    _failures = collect_failures()
    if _failures:
        raise SystemExit(failure_report(_failures))
    print(
        "OK: the runner rolls with remote providers, recreates with the local provider, "
        "refuses two local runners, and passes its shutdown wait."
    )
