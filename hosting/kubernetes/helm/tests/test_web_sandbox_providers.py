# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart regression coverage: the web workloads carry the sandbox provider registry.

The web image's entrypoint turns AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS into the browser's
NEXT_PUBLIC_AGENTA_ENABLED_SANDBOX_PROVIDERS. When the chart rendered the registry only on the
runner, api and services, the browser fell back to "local", new agents were minted with
sandbox.kind "local", and on a daytona-only install every send failed with
"sandbox 'local' is not enabled on this deployment" (seen on GKE staging, 2026-09-27).

Run: uv run hosting/kubernetes/helm/tests/test_web_sandbox_providers.py
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
    "--set",
    "webMobile.enabled=true",
]


def render(extra_args: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "web-sandbox-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def container_env(docs: list[dict], component: str) -> dict[str, str]:
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        labels = doc.get("metadata", {}).get("labels", {})
        if labels.get("app.kubernetes.io/component") != component:
            continue
        container = doc["spec"]["template"]["spec"]["containers"][0]
        return {e["name"]: e.get("value") for e in container.get("env", [])}
    raise AssertionError(f"no {component} Deployment found in the rendered chart")


def test_web_workloads_carry_the_registry_with_defaults() -> None:
    docs = render()
    for component in ("web", "web-mobile", "runner"):
        env = container_env(docs, component)
        assert env["AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS"] == "local", component
        assert env["AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER"] == "local", component


def test_web_workloads_follow_the_operator_registry() -> None:
    docs = render(
        [
            "--set",
            "agentRunner.providers.enabled={daytona}",
            "--set",
            "agentRunner.providers.default=daytona",
        ]
    )
    for component in ("web", "web-mobile", "api", "services", "runner"):
        env = container_env(docs, component)
        assert env["AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS"] == "daytona", component
        assert env["AGENTA_RUNNER_DEFAULT_SANDBOX_PROVIDER"] == "daytona", component


def test_web_registry_is_rendered_once() -> None:
    docs = render()
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        labels = doc.get("metadata", {}).get("labels", {})
        if labels.get("app.kubernetes.io/component") not in ("web", "web-mobile"):
            continue
        names = [
            e["name"] for e in doc["spec"]["template"]["spec"]["containers"][0]["env"]
        ]
        assert names.count("AGENTA_RUNNER_ENABLED_SANDBOX_PROVIDERS") == 1


if __name__ == "__main__":
    test_web_workloads_carry_the_registry_with_defaults()
    test_web_workloads_follow_the_operator_registry()
    test_web_registry_is_rendered_once()
    print("ok")
