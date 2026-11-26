# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for the telemetry values.

`telemetry.enabled` reaches the api as `AGENTA_TELEMETRY_ENABLED`, and
`telemetry.instanceKind` reaches it as `AGENTA_TELEMETRY_INSTANCE_KIND` only when it
is set, so an empty value lets the api detect the kind. The schema rejects a kind the
api does not know.

Run: uv run hosting/kubernetes/helm/tests/test_telemetry_values.py
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


def helm_template(extra_args: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        [
            "helm",
            "template",
            "telemetry-chart-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *extra_args,
        ],
        capture_output=True,
        text=True,
    )


def api_env(extra_args: list[str] | None = None) -> dict[str, str]:
    result = helm_template(extra_args or [])
    assert result.returncode == 0, result.stderr
    api = next(
        doc
        for doc in yaml.safe_load_all(result.stdout)
        if doc
        and doc.get("kind") == "Deployment"
        and doc["metadata"]["labels"].get("app.kubernetes.io/component") == "api"
    )
    [container] = [
        c for c in api["spec"]["template"]["spec"]["containers"] if c["name"] == "api"
    ]
    return {item["name"]: item.get("value") for item in container.get("env", [])}


def main() -> int:
    # --- Defaults: telemetry on, kind left to the api. ---
    env = api_env()
    assert env["AGENTA_TELEMETRY_ENABLED"] == "true", env
    assert env["AGENTA_DEPLOYMENT_METHOD"] == "helm", env
    assert "AGENTA_TELEMETRY_INSTANCE_KIND" not in env, env

    # --- Overrides reach the api. ---
    env = api_env(
        ["--set", "telemetry.enabled=false", "--set", "telemetry.instanceKind=test"]
    )
    assert env["AGENTA_TELEMETRY_ENABLED"] == "false", env
    assert env["AGENTA_TELEMETRY_INSTANCE_KIND"] == "test", env

    # --- Every backend pod that holds the PostHog key also gets the switch. ---
    # The web pods hold the key too, but the browser sends nothing until the api's
    # /instance/telemetry answer says telemetry is on, so they do not need the switch.
    result = helm_template(["--set", "telemetry.enabled=false"])
    assert result.returncode == 0, result.stderr
    seen = set()
    for doc in yaml.safe_load_all(result.stdout):
        if not doc or doc.get("kind") not in ("Deployment", "Job"):
            continue
        component = doc["metadata"]["labels"].get("app.kubernetes.io/component")
        for container in doc["spec"]["template"]["spec"]["containers"]:
            values = {e["name"]: e.get("value") for e in container.get("env", [])}
            if "POSTHOG_API_KEY" not in values or component in ("web", "web-mobile"):
                continue
            assert values.get("AGENTA_TELEMETRY_ENABLED") == "false", (
                component,
                container["name"],
            )
            seen.add(component)
    assert {"api", "cron", "worker-streams", "worker-queues", "services"} <= seen, seen

    # --- The schema rejects a kind the api does not know. ---
    result = helm_template(["--set", "telemetry.instanceKind=staging"])
    assert result.returncode != 0, "an unknown telemetry.instanceKind must fail"
    assert "instanceKind" in result.stderr, result.stderr

    print("OK: telemetry values render.")
    return 0


def test_telemetry_values_render() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0, "telemetry values render"


if __name__ == "__main__":
    raise SystemExit(main())
