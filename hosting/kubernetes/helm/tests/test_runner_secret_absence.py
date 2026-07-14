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

# Minimum values needed for the chart to render (URLs are required by the chart's own guard).
BASE_ARGS = [
    "--set",
    "agenta.webUrl=https://agenta.example.com",
    "--set",
    "agenta.apiUrl=https://agenta.example.com/api",
    "--set",
    "agenta.servicesUrl=https://agenta.example.com/services",
    "--set",
    "agentRunner.enabled=true",
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
    names = runner_container_env_names(render([]))
    failures += check(names)

    # Operator supplies their own secret ref: same narrow env, token sourced from their Secret.
    names_with_token = runner_container_env_names(render(TOKEN_ARGS))
    failures += check(names_with_token)

    if failures:
        print("FAIL: runner environment is not narrow:", file=sys.stderr)
        for line in failures:
            print(f"  - {line}", file=sys.stderr)
        return 1

    print(
        "OK: runner Deployment env is narrow (no platform secrets, provider keys, or API key)."
    )
    print(f"  default env: {sorted(names)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
