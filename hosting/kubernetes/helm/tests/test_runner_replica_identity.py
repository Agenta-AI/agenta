# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for how each runner pod identifies itself to the API.

The API binds every turn to the first runner pod that beats it and refuses any other pod for
that turn, then sends that turn's Stop straight to the pod. So at every replica count each pod
must carry:

  * its own `AGENTA_RUNNER_REPLICA_ID`, from the downward API `metadata.name`. A shared value
    would let two pods pass as one;
  * `AGENTA_RUNNER_REPLICA_ADDRESS`, built from `status.podIP` and the configured runner port.
    Kubernetes expands `$(POD_IP)` only when `POD_IP` is defined EARLIER in the env list.

An operator value in `agentRunner.env` replaces any of these entries, without a duplicate.

Run: uv run hosting/kubernetes/helm/tests/test_runner_replica_identity.py
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

# Two pods run only with remote sandbox providers; the local provider stays at one runner.
TWO_REMOTE_REPLICAS = [
    "--set",
    "agentRunner.replicas=2",
    "--set",
    "agentRunner.providers.enabled={daytona}",
    "--set",
    "agentRunner.providers.default=daytona",
]


def render(extra_args: list[str]) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "runner-identity-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *extra_args,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def runner_env(docs: list[dict]) -> list[dict]:
    """The env entries of the runner Deployment's `runner` container, in order."""
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        labels = doc.get("metadata", {}).get("labels", {})
        if labels.get("app.kubernetes.io/component") != "runner":
            continue
        containers = doc["spec"]["template"]["spec"]["containers"]
        runner = next(c for c in containers if c["name"] == "runner")
        return runner.get("env", [])
    raise AssertionError("no runner Deployment found in the rendered chart")


def entries(env: list[dict], name: str) -> list[dict]:
    return [entry for entry in env if entry["name"] == name]


def field_ref(entry: dict) -> str | None:
    return entry.get("valueFrom", {}).get("fieldRef", {}).get("fieldPath")


def identity_failures(env: list[dict], *, port: int, label: str) -> list[str]:
    failures: list[str] = []
    names = [entry["name"] for entry in env]

    replica_ids = entries(env, "AGENTA_RUNNER_REPLICA_ID")
    if len(replica_ids) != 1:
        failures.append(
            f"{label}: AGENTA_RUNNER_REPLICA_ID set {len(replica_ids)} times"
        )
    elif field_ref(replica_ids[0]) != "metadata.name":
        failures.append(f"{label}: AGENTA_RUNNER_REPLICA_ID is not the pod name")

    pod_ips = entries(env, "POD_IP")
    if len(pod_ips) != 1 or field_ref(pod_ips[0]) != "status.podIP":
        failures.append(f"{label}: POD_IP is not read from status.podIP")

    addresses = entries(env, "AGENTA_RUNNER_REPLICA_ADDRESS")
    expected = f"http://$(POD_IP):{port}"
    if len(addresses) != 1:
        failures.append(
            f"{label}: AGENTA_RUNNER_REPLICA_ADDRESS set {len(addresses)} times"
        )
    elif addresses[0].get("value") != expected:
        failures.append(
            f"{label}: AGENTA_RUNNER_REPLICA_ADDRESS is {addresses[0].get('value')!r}, "
            f"expected {expected!r}"
        )
    elif "POD_IP" in names and names.index("POD_IP") > names.index(
        "AGENTA_RUNNER_REPLICA_ADDRESS"
    ):
        failures.append(
            f"{label}: POD_IP is defined after the address, so $(POD_IP) is not expanded"
        )

    return failures


def collect_failures() -> list[str]:
    failures: list[str] = []

    failures += identity_failures(runner_env(render([])), port=8765, label="replicas=1")
    failures += identity_failures(
        runner_env(render(TWO_REMOTE_REPLICAS)), port=8765, label="replicas=2"
    )
    failures += identity_failures(
        runner_env(render(TWO_REMOTE_REPLICAS + ["--set", "agentRunner.port=9000"])),
        port=9000,
        label="replicas=2, port 9000",
    )

    # An operator value replaces the chart's entry rather than adding a second one.
    env = runner_env(
        render(
            [
                "--set",
                "agentRunner.env.AGENTA_RUNNER_REPLICA_ID=pinned-runner",
                "--set",
                "agentRunner.env.AGENTA_RUNNER_REPLICA_ADDRESS=http://runner.internal:8765",
                "--set",
                "agentRunner.env.POD_IP=10.0.0.9",
            ]
        )
    )
    for name, value in (
        ("AGENTA_RUNNER_REPLICA_ID", "pinned-runner"),
        ("AGENTA_RUNNER_REPLICA_ADDRESS", "http://runner.internal:8765"),
        ("POD_IP", "10.0.0.9"),
    ):
        found = entries(env, name)
        if [entry.get("value") for entry in found] != [value]:
            failures.append(f"override: {name} rendered as {found!r}")

    return failures


def failure_report(failures: list[str]) -> str:
    return "runner replica identity is wrong:\n" + "\n".join(
        f"  - {failure}" for failure in failures
    )


def test_each_runner_pod_has_its_own_id_and_address() -> None:
    failures = collect_failures()
    assert not failures, failure_report(failures)


if __name__ == "__main__":
    _failures = collect_failures()
    if _failures:
        raise SystemExit(failure_report(_failures))
    print("OK: each runner pod renders its own replica id and its pod address.")
