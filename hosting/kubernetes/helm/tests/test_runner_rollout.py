# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for how runner pods replace each other and how long they drain.

  * With only remote sandbox providers, a rollout starts the new pod and waits until it is
    ready before it stops an old one (`RollingUpdate`, maxSurge 1, maxUnavailable 0).
  * With the local provider, a local sandbox lives inside the pod that started it, so the old
    pod stops before the new one starts (`Recreate`). More than one runner pod, and an explicit
    rolling update, are refused at render time. Those checks read `agentRunner.providers`, so
    `agentRunner.env` or `agentRunner.extraEnv` setting a sandbox provider variable fails the
    render.
  * `AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS` defaults to the grace period minus 100 seconds,
    never below 0, when the runner rolls out with `RollingUpdate`. With `Recreate` the new pod
    starts only after the old one exits, so the default is 0. `agentRunner.shutdownWaitSeconds`
    replaces the default in both cases, and a value past the limit is refused. The chart owns the variable: `agentRunner.env` or `agentRunner.extraEnv`
    setting it fails the render.
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
        ("local provider (chart default): Recreate waits 0", [], "0"),
        ("local and daytona: Recreate waits 0", LOCAL_AND_REMOTE, "0"),
        ("daytona only, default grace 300", REMOTE_ONLY, "200"),
        (
            "daytona only, an explicit Recreate waits 0",
            REMOTE_ONLY + ["--set", "agentRunner.strategy.type=Recreate"],
            "0",
        ),
        (
            "local, an explicit Recreate waits 0",
            ["--set", "agentRunner.strategy.type=Recreate"],
            "0",
        ),
        (
            "daytona only, a strategy without a type is RollingUpdate",
            REMOTE_ONLY + ["--set", "agentRunner.strategy.rollingUpdate.maxSurge=2"],
            "200",
        ),
        (
            "daytona only, grace 150",
            REMOTE_ONLY + ["--set", "agentRunner.terminationGracePeriodSeconds=150"],
            "50",
        ),
        (
            "daytona only, grace 60 never goes below 0",
            REMOTE_ONLY + ["--set", "agentRunner.terminationGracePeriodSeconds=60"],
            "0",
        ),
        (
            "explicit wait, Recreate",
            ["--set", "agentRunner.shutdownWaitSeconds=150"],
            "150",
        ),
        (
            "explicit wait, RollingUpdate",
            REMOTE_ONLY + ["--set", "agentRunner.shutdownWaitSeconds=150"],
            "150",
        ),
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
        (
            "explicit zero wait, RollingUpdate",
            REMOTE_ONLY + ["--set", "agentRunner.shutdownWaitSeconds=0"],
            "0",
        ),
    ]
    for label, args, expected in cases:
        values = shutdown_wait(render(args))
        if values != [expected]:
            failures.append(f"{label}: AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS {values!r}")

    # A wait past grace - 100 leaves no time to cancel and delete before the KILL signal.
    for label, args, expected in (
        (
            "a wait of 230 with grace 300",
            ["--set", "agentRunner.shutdownWaitSeconds=230"],
            "agentRunner.shutdownWaitSeconds=230",
        ),
        (
            "a wait of 51 with grace 150",
            [
                "--set",
                "agentRunner.shutdownWaitSeconds=51",
                "--set",
                "agentRunner.terminationGracePeriodSeconds=150",
            ],
            "agentRunner.shutdownWaitSeconds=51",
        ),
    ):
        result = helm_template(args)
        if result.returncode == 0:
            failures.append(f"{label}: rendered instead of failing")
        elif (
            "CONFIGURATION ERROR" not in result.stderr or expected not in result.stderr
        ):
            failures.append(
                f"{label}: the failure does not name the key:\n{result.stderr}"
            )

    # The chart owns the variable, so a value in agentRunner.env or agentRunner.extraEnv, which
    # would replace the checked one, fails the render and points at shutdownWaitSeconds.
    for label, args, source in (
        (
            "agentRunner.env",
            ["--set", "agentRunner.env.AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS=45"],
            "agentRunner.env",
        ),
        (
            "agentRunner.extraEnv",
            [
                "--set",
                "agentRunner.extraEnv[0].name=AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS",
                "--set-string",
                "agentRunner.extraEnv[0].value=45",
            ],
            "agentRunner.extraEnv",
        ),
    ):
        result = helm_template(args)
        if result.returncode == 0:
            failures.append(f"{label}: a wait override rendered instead of failing")
        elif (
            f"{source} sets AGENTA_RUNNER_SHUTDOWN_WAIT_SECONDS" not in result.stderr
            or "agentRunner.shutdownWaitSeconds" not in result.stderr
        ):
            failures.append(
                f"{label}: the failure does not name the key and the fix:\n{result.stderr}"
            )
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


PROVIDER_VARIABLES = (
    "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS",
    "AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER",
)


def provider_override_failures() -> list[str]:
    """The replica and strategy checks read `agentRunner.providers`. A provider variable in
    `agentRunner.env` or `agentRunner.extraEnv` would pass those checks with remote providers and
    then run the local provider, so the render fails and points at `agentRunner.providers`."""
    failures: list[str] = []
    for name in PROVIDER_VARIABLES:
        for source, args in (
            ("agentRunner.env", ["--set", f"agentRunner.env.{name}=local"]),
            (
                "agentRunner.extraEnv",
                [
                    "--set",
                    f"agentRunner.extraEnv[0].name={name}",
                    "--set-string",
                    "agentRunner.extraEnv[0].value=local",
                ],
            ),
        ):
            label = f"{source} sets {name}"
            result = helm_template(args)
            if result.returncode == 0:
                failures.append(f"{label}: rendered instead of failing")
            elif (
                f"{source} sets {name}" not in result.stderr
                or "agentRunner.providers.enabled" not in result.stderr
            ):
                failures.append(
                    f"{label}: the failure does not name the key and the fix:\n{result.stderr}"
                )

    # Two rolling runner pods on remote providers, with both variables switched to local
    # through agentRunner.env: the local provider on more than one pod.
    result = helm_template(
        REMOTE_ONLY
        + TWO_REPLICAS
        + [
            "--set",
            "agentRunner.env.AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS=local",
            "--set",
            "agentRunner.env.AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER=local",
        ]
    )
    if result.returncode == 0:
        failures.append(
            "two daytona pods with env overrides to local rendered instead of failing"
        )
    elif "agentRunner.env sets AGENTA_RUNNER_" not in result.stderr:
        failures.append(
            f"two daytona pods with env overrides to local: unexpected failure:\n{result.stderr}"
        )

    # The runner lowercases and trims each provider id, and the chart's local check matches the
    # exact id `local`, so a variant must fail the render, not reach two rolling pods as local.
    for label, providers in (
        ("enabled [Local]", ["--set", "agentRunner.providers.enabled={Local}"]),
        (
            "enabled [' local']",
            ["--set-json", 'agentRunner.providers.enabled=[" local"]'],
        ),
        ("default Local", ["--set", "agentRunner.providers.default=Local"]),
    ):
        result = helm_template(TWO_REPLICAS + providers)
        if result.returncode == 0:
            failures.append(
                f"two runner pods with {label}: rendered instead of failing"
            )
        elif "agentRunner.providers" not in result.stderr:
            failures.append(
                f"two runner pods with {label}: the failure does not name the key:\n{result.stderr}"
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
        + provider_override_failures()
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
