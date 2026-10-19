# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart regression coverage: the web workloads get both Turnstile keys.

The web image's entrypoint writes NEXT_PUBLIC_CLOUDFLARE_TURNSTILE_SITE_KEY into the browser
env only when it sees CLOUDFLARE_TURNSTILE_SITE_KEY and CLOUDFLARE_TURNSTILE_SECRET_KEY. The
web and web-mobile pods get both from agenta.webOptionalEnv, not agenta.commonEnv. This
test keeps the secret on those pods, including with secrets.existingSecret, so the chart
alone turns the sign-in widget on.

Run: uv run hosting/kubernetes/helm/tests/test_web_turnstile.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]
RELEASE = "web-turnstile-test"

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

TURNSTILE_ARGS = [
    "--set",
    "cloudflare.turnstile.siteKey=test-site-key",
    "--set",
    "cloudflare.turnstile.secretKey=test-secret-key",
]

EXISTING_SECRET_ARGS = [
    "--set",
    "secrets.existingSecret=my-agenta-secret",
    "--set",
    "global.postgresql.auth.existingSecret=my-agenta-secret",
]


def render(extra_args: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            RELEASE,
            str(CHART_DIR),
            *BASE_ARGS,
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def container_env(docs: list[dict], component: str) -> dict[str, dict]:
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        labels = doc.get("metadata", {}).get("labels", {})
        if labels.get("app.kubernetes.io/component") != component:
            continue
        container = doc["spec"]["template"]["spec"]["containers"][0]
        return {e["name"]: e for e in container.get("env", [])}
    raise AssertionError(f"no {component} Deployment found in the rendered chart")


def assert_web_has_both_keys(docs: list[dict], secret_name: str) -> None:
    for component in ("web", "web-mobile"):
        env = container_env(docs, component)
        assert env["CLOUDFLARE_TURNSTILE_SITE_KEY"]["value"] == "test-site-key", (
            component
        )
        ref = env["CLOUDFLARE_TURNSTILE_SECRET_KEY"]["valueFrom"]["secretKeyRef"]
        assert ref["name"] == secret_name, component
        assert ref["key"] == "CLOUDFLARE_TURNSTILE_SECRET_KEY", component


def test_web_workloads_get_both_turnstile_keys() -> None:
    assert_web_has_both_keys(render(TURNSTILE_ARGS), f"{RELEASE}-agenta")


def test_web_workloads_get_both_turnstile_keys_from_existing_secret() -> None:
    docs = render(TURNSTILE_ARGS + EXISTING_SECRET_ARGS)
    assert_web_has_both_keys(docs, "my-agenta-secret")


def test_web_workloads_omit_the_secret_when_turnstile_is_off() -> None:
    docs = render()
    for component in ("web", "web-mobile"):
        env = container_env(docs, component)
        assert "CLOUDFLARE_TURNSTILE_SECRET_KEY" not in env, component


if __name__ == "__main__":
    test_web_workloads_get_both_turnstile_keys()
    test_web_workloads_get_both_turnstile_keys_from_existing_secret()
    test_web_workloads_omit_the_secret_when_turnstile_is_off()
    print("ok")
