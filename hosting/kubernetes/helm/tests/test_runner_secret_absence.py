# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart regression guard for the runner's narrow environment.

The agent runner must run with a deliberately narrow environment (interface.md sections 2, 9,
and the runner-selfhosting-cleanup design): a local harness process shares the runner container,
so anything on the runner's process environment is readable from /proc by user code. This test
renders the Helm chart and asserts the runner Deployment's container env contains ONLY runner and
provider-registry variables — never the platform's database, auth, crypt, license, Redis, object
store, or unrelated provider secrets, and never a static AGENTA_API_KEY. It is the guard that keeps
a future `agenta.commonEnv` include (or any broad env block) from silently re-widening the runner.

Run: uv run hosting/kubernetes/helm/tests/test_runner_secret_absence.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]

# Minimum values needed for the chart to render (URLs and secrets are required by the
# chart's own guards; agenta.validateRequiredSecrets rejects the "replace-me" default).
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
    "postgres.password=test-postgres-password",
]

# agenta.runnerToken is required unless agentRunner.auth.tokenSecretRef is set (below).
DEFAULT_TOKEN_ARGS = [
    "--set",
    "agenta.runnerToken=test-runner-token",
]

TOKEN_ARGS = [
    "--set",
    "agentRunner.auth.tokenSecretRef.name=agenta-runner",
    "--set",
    "agentRunner.auth.tokenSecretRef.key=token",
]

# Exact names the runner container env must NEVER contain.
FORBIDDEN_EXACT = {
    "AGENTA_AUTH_KEY",
    "AGENTA_CRYPT_KEY",
    "AGENTA_SERVICES_INTERNAL_KEY",
    "AGENTA_LICENSE",
    "AGENTA_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "GEMINI_API_KEY",
    "COHERE_API_KEY",
    "MISTRAL_API_KEY",
}

# Prefixes the runner container env must NEVER contain (databases, cache, object store).
FORBIDDEN_PREFIXES = (
    "POSTGRES_",
    "REDIS_",
    "AGENTA_REDIS_",
    "AGENTA_STORE_",
)

# Names the runner container env MUST contain (its own configuration).
REQUIRED = {
    "AGENTA_RUNNER_PORT",
    "AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS",
    # The runner binds 127.0.0.1 unless told otherwise. In a pod that makes every health
    # probe fail with connection refused and the pod never becomes ready, which is what
    # happened on a live GKE cluster. See runner_bind_address() below for the value check.
    "AGENTA_RUNNER_HOST",
}


def render(extra_args: list[str]) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "runner-env-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *extra_args,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def runner_container_env_names(docs: list[dict]) -> list[str]:
    """The env var NAMES on the runner Deployment's `runner` container."""
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        labels = doc.get("metadata", {}).get("labels", {})
        if labels.get("app.kubernetes.io/component") != "runner":
            continue
        containers = doc["spec"]["template"]["spec"]["containers"]
        runner = next(c for c in containers if c["name"] == "runner")
        return [entry["name"] for entry in runner.get("env", [])]
    raise AssertionError("no runner Deployment found in the rendered chart")


def runner_bind_address(docs: list[dict]) -> str:
    """The AGENTA_RUNNER_HOST value on the runner container, and how many times it is set."""
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        if (
            doc.get("metadata", {}).get("labels", {}).get("app.kubernetes.io/component")
            != "runner"
        ):
            continue
        containers = doc["spec"]["template"]["spec"]["containers"]
        runner = next(c for c in containers if c["name"] == "runner")
        values = [
            entry.get("value")
            for entry in runner.get("env", [])
            if entry["name"] == "AGENTA_RUNNER_HOST"
        ]
        assert len(values) == 1, f"AGENTA_RUNNER_HOST set {len(values)} times"
        return values[0]
    raise AssertionError("no runner Deployment found in the rendered chart")


def runner_pod_spec(docs: list[dict]) -> dict:
    """The runner Deployment's pod spec."""
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        if (
            doc.get("metadata", {}).get("labels", {}).get("app.kubernetes.io/component")
            == "runner"
        ):
            return doc["spec"]["template"]["spec"]
    raise AssertionError("no runner Deployment found in the rendered chart")


def deployment_env_names(docs: list[dict], component: str) -> set[str]:
    """Environment variable names on a component's primary container."""
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        labels = doc.get("metadata", {}).get("labels", {})
        if labels.get("app.kubernetes.io/component") != component:
            continue
        container = doc["spec"]["template"]["spec"]["containers"][0]
        return {entry["name"] for entry in container.get("env", [])}
    raise AssertionError(f"no {component} Deployment found in the rendered chart")


def check(names: list[str]) -> list[str]:
    failures: list[str] = []
    present = set(names)

    for forbidden in sorted(FORBIDDEN_EXACT):
        if forbidden in present:
            failures.append(f"runner env must not contain {forbidden}")

    for name in names:
        for prefix in FORBIDDEN_PREFIXES:
            if name.startswith(prefix):
                failures.append(f"runner env must not contain {name} (prefix {prefix})")

    for required in sorted(REQUIRED):
        if required not in present:
            failures.append(f"runner env must contain {required}")

    # The runner's own credential is REQUIRED, not opt-in: it refuses to boot without one, so it
    # must be present in BOTH shapes (platform Secret by default, or an operator's own secret ref).
    # It is a single key, which is exactly why the narrow-env rule above still holds.
    if "AGENTA_RUNNER_TOKEN" not in present:
        failures.append("runner env must contain AGENTA_RUNNER_TOKEN")

    return failures


def main() -> int:
    failures: list[str] = []

    # Default deployment: the token comes from the platform Secret, env still narrow.
    names = runner_container_env_names(render(DEFAULT_TOKEN_ARGS))
    failures += check(names)

    docs = render(DEFAULT_TOKEN_ARGS)
    for component in ("api", "services"):
        if "AGENTA_SERVICES_INTERNAL_KEY" not in deployment_env_names(docs, component):
            failures.append(
                f"{component} env must contain AGENTA_SERVICES_INTERNAL_KEY"
            )
    for component in ("worker-streams", "worker-queues", "cron"):
        if "AGENTA_SERVICES_INTERNAL_KEY" in deployment_env_names(docs, component):
            failures.append(
                f"{component} env must not contain AGENTA_SERVICES_INTERNAL_KEY"
            )

    # Operator supplies their own secret ref: same narrow env, token sourced from their Secret.
    names_with_token = runner_container_env_names(render(TOKEN_ARGS))
    failures += check(names_with_token)

    # The runner must bind every interface, or the kubelet cannot reach its health endpoint
    # over the pod IP and the pod never becomes ready.
    bind = runner_bind_address(docs)
    if bind != "0.0.0.0":
        failures.append(f"runner binds {bind!r}, expected '0.0.0.0'")

    # Both override paths still win, and neither produces a duplicate entry.
    for args, expected in (
        (DEFAULT_TOKEN_ARGS + ["--set", "agentRunner.host=127.0.0.1"], "127.0.0.1"),
        (
            DEFAULT_TOKEN_ARGS
            + ["--set", "agentRunner.env.AGENTA_RUNNER_HOST=10.0.0.5"],
            "10.0.0.5",
        ),
    ):
        got = runner_bind_address(render(args))
        if got != expected:
            failures.append(f"runner bind override gave {got!r}, expected {expected!r}")

    # A custom securityContext controls capabilities, but it must not suppress the /dev/fuse
    # device when FUSE is enabled. Operators use this path to supply their own SYS_ADMIN shape.
    fuse_docs = render(
        DEFAULT_TOKEN_ARGS
        + [
            "--set",
            "store.enabled=true",
            "--set",
            "agentRunner.securityContext.allowPrivilegeEscalation=true",
        ]
    )
    spec = runner_pod_spec(fuse_docs)
    runner = next(c for c in spec["containers"] if c["name"] == "runner")
    mounts = {m["name"]: m["mountPath"] for m in runner.get("volumeMounts", [])}
    volumes = {v["name"]: v for v in spec.get("volumes", [])}
    if mounts.get("fuse") != "/dev/fuse":
        failures.append("custom runner securityContext suppresses the /dev/fuse mount")
    if volumes.get("fuse", {}).get("hostPath", {}).get("path") != "/dev/fuse":
        failures.append(
            "custom runner securityContext suppresses the /dev/fuse hostPath"
        )

    if failures:
        print("FAIL: runner environment is not narrow:", file=sys.stderr)
        for line in failures:
            print(f"  - {line}", file=sys.stderr)
        return 1

    print(
        "OK: internal-services key is limited to API/Services; runner env remains narrow."
    )
    print(f"  default env: {sorted(names)}")
    return 0


def test_runner_env_stays_narrow() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0, "the runner environment stays narrow"


if __name__ == "__main__":
    raise SystemExit(main())
