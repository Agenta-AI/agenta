# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart regression coverage: the web workloads carry the Crisp website id.

The web image's entrypoint turns CRISP_WEBSITE_ID into the browser's
NEXT_PUBLIC_CRISP_WEBSITE_ID. The chart rendered it only in agenta.commonEnv, which the web
and web-mobile pods do not include, so the live chat never loaded on any GKE stage even with
crisp.websiteId set (seen on GKE staging, 2026-10-04).

Run: uv run hosting/kubernetes/helm/tests/test_web_crisp.py
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
            "web-crisp-test",
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


def test_web_workloads_carry_the_crisp_website_id() -> None:
    docs = render(["--set", "crisp.websiteId=test-website-id"])
    for component in ("web", "web-mobile"):
        env = container_env(docs, component)
        assert env.get("CRISP_WEBSITE_ID") == "test-website-id", component


def test_web_workloads_omit_crisp_when_unset() -> None:
    docs = render()
    for component in ("web", "web-mobile"):
        assert "CRISP_WEBSITE_ID" not in container_env(docs, component), component


if __name__ == "__main__":
    test_web_workloads_carry_the_crisp_website_id()
    test_web_workloads_omit_crisp_when_unset()
    print("ok")
