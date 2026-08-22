# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart regression coverage for the default-on mobile web workload.

Run: uv run hosting/kubernetes/helm/tests/test_web_mobile.py
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
    "agenta.runnerToken=test-runner-token",
    "--set",
    "postgres.password=test-postgres-password",
]


def render(extra_args: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "mobile-chart-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def component(docs: list[dict], kind: str, name: str) -> dict:
    for doc in docs:
        labels = doc.get("metadata", {}).get("labels", {})
        if (
            doc.get("kind") == kind
            and labels.get("app.kubernetes.io/component") == name
        ):
            return doc
    raise AssertionError(f"no {kind} with component {name!r}")


def components(docs: list[dict], name: str) -> list[dict]:
    return [
        doc
        for doc in docs
        if (
            doc.get("metadata", {}).get("labels", {}).get("app.kubernetes.io/component")
            == name
        )
    ]


def container(deployment: dict) -> dict:
    return deployment["spec"]["template"]["spec"]["containers"][0]


def env_value(deployment: dict, name: str) -> str:
    entry = next(item for item in container(deployment)["env"] if item["name"] == name)
    return entry["value"]


def ingress_paths(docs: list[dict]) -> list[dict]:
    ingress = next(doc for doc in docs if doc.get("kind") == "Ingress")
    return ingress["spec"]["rules"][0]["http"]["paths"]


def main() -> int:
    docs = render()
    mobile_deployment = component(docs, "Deployment", "web-mobile")
    mobile_container = container(mobile_deployment)
    mobile_service = component(docs, "Service", "web-mobile")
    desktop_deployment = component(docs, "Deployment", "web")

    assert mobile_deployment["spec"]["replicas"] == 1
    assert mobile_container["image"].startswith("ghcr.io/agenta-ai/agenta-web-mobile:")
    assert mobile_container["command"] == ["/app/entrypoint.sh"]
    assert mobile_container["args"] == ["node", "mobile/server.js"]
    assert mobile_service["spec"]["ports"][0]["port"] == 3000
    assert env_value(desktop_deployment, "AGENTA_MOBILE_GATE") == "true"
    assert env_value(mobile_deployment, "AGENTA_MOBILE_GATE") == "true"
    assert env_value(mobile_deployment, "AGENTA_MOBILE_REVERSE_GATE") == "true"
    for probe in ("startupProbe", "livenessProbe", "readinessProbe"):
        assert mobile_container[probe]["httpGet"]["path"] == "/m/__env.js"

    mobile_path = next(path for path in ingress_paths(docs) if path["path"] == "/m")
    assert mobile_path["pathType"] == "Prefix"
    assert mobile_path["backend"]["service"]["name"].endswith("-web-mobile")

    custom_docs = render(
        [
            "--set",
            "webMobile.replicas=2",
            "--set",
            "webMobile.port=3456",
            "--set",
            "webMobile.image.repository=registry.example.com/mobile",
            "--set",
            "webMobile.image.tag=test",
        ]
    )
    custom_deployment = component(custom_docs, "Deployment", "web-mobile")
    assert custom_deployment["spec"]["replicas"] == 2
    assert container(custom_deployment)["image"] == "registry.example.com/mobile:test"
    assert (
        component(custom_docs, "Service", "web-mobile")["spec"]["ports"][0]["port"]
        == 3456
    )

    ee_docs = render(["--set", "agenta.license=ee"])
    assert container(component(ee_docs, "Deployment", "web-mobile"))[
        "image"
    ].startswith("ghcr.io/agenta-ai/agenta-web-mobile:")

    mobile_only_docs = render(
        [
            "--set",
            "web.enabled=false",
            "--set",
            "api.enabled=false",
            "--set",
            "services.enabled=false",
        ]
    )
    assert component(mobile_only_docs, "Deployment", "web-mobile")
    assert [path["path"] for path in ingress_paths(mobile_only_docs)] == ["/m"]

    disabled_docs = render(["--set", "webMobile.enabled=false"])
    assert not components(disabled_docs, "web-mobile")
    assert all(path["path"] != "/m" for path in ingress_paths(disabled_docs))
    assert (
        env_value(component(disabled_docs, "Deployment", "web"), "AGENTA_MOBILE_GATE")
        == "false"
    )

    print("OK: Helm deploys and routes web-mobile by default, with a safe opt-out.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
