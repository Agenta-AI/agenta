# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for what `agenta.license` still picks.

Every default image is a public one for both values of `agenta.license`, and the
migration job always runs the one runner module. The license picks only the default
database names, and the server path of an ee web build set through
`web.image.repository`.

Run: uv run hosting/kubernetes/helm/tests/test_images_by_license.py
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

API_COMPONENTS = ("api", "cron", "worker-queues", "worker-streams", "alembic")


PUBLIC_IMAGES = {
    f"ghcr.io/agenta-ai/{name}"
    for name in (
        "agenta-api",
        "agenta-services",
        "agenta-runner",
        "agenta-web",
        "agenta-web-mobile",
    )
}


def render(license_value: str, *extra: str) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "images-chart-test",
            str(CHART_DIR),
            *BASE_ARGS,
            "--set",
            f"agenta.license={license_value}",
            *extra,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def workload(docs: list[dict], name: str) -> dict:
    for doc in docs:
        labels = doc.get("metadata", {}).get("labels", {})
        if (
            doc.get("kind") in ("Deployment", "StatefulSet", "Job")
            and labels.get("app.kubernetes.io/component") == name
        ):
            return doc
    raise AssertionError(f"no workload with component {name!r}")


def container(doc: dict) -> dict:
    return doc["spec"]["template"]["spec"]["containers"][0]


def image_repository(docs: list[dict], name: str) -> str:
    return container(workload(docs, name))["image"].rsplit(":", 1)[0]


def env_value(doc: dict, name: str) -> str | None:
    entry = next(
        (item for item in container(doc).get("env", []) if item["name"] == name),
        None,
    )
    return entry.get("value") if entry else None


def web_command(docs: list[dict]) -> str:
    web = container(workload(docs, "web"))
    return " ".join(web.get("command", []) + web.get("args", []))


def all_images(docs: list[dict]) -> set[str]:
    images = set()
    for doc in docs:
        if doc.get("kind") not in ("Deployment", "StatefulSet", "Job"):
            continue
        pod = doc["spec"]["template"]["spec"]
        for item in pod.get("containers", []) + pod.get("initContainers", []):
            images.add(item["image"].rsplit(":", 1)[0])
    return images


def check(license_value: str, web_repository: str, web_server: str) -> None:
    docs = render(license_value)

    agenta_images = {
        image for image in all_images(docs) if "agenta-ai/" in image.lower()
    }
    assert agenta_images <= PUBLIC_IMAGES, agenta_images - PUBLIC_IMAGES

    for name in API_COMPONENTS:
        assert image_repository(docs, name) == "ghcr.io/agenta-ai/agenta-api", name
    assert image_repository(docs, "services") == "ghcr.io/agenta-ai/agenta-services"
    assert image_repository(docs, "runner") == "ghcr.io/agenta-ai/agenta-runner"
    assert image_repository(docs, "web") == web_repository

    assert web_server in web_command(docs), web_command(docs)

    alembic = workload(docs, "alembic")
    assert container(alembic)["command"][-1] == (
        "python -m ee.databases.postgres.migrations.runner"
    )
    for name in ("ALEMBIC_CFG_PATH_CORE", "ALEMBIC_CFG_PATH_TRACING"):
        assert env_value(alembic, name) is None, name

    api = workload(docs, "api")
    assert env_value(api, "AGENTA_LICENSE") == license_value
    assert env_value(api, "POSTGRES_URI_CORE").endswith(f"/agenta_{license_value}_core")


def check_web_override() -> None:
    private = "ghcr.io/agenta-ai/internal-ee-agenta-web"
    docs = render("ee", "--set", f"web.image.repository={private}")
    assert image_repository(docs, "web") == private
    assert "./ee/server.js" in web_command(docs), web_command(docs)

    docs = render("oss", "--set", f"web.image.repository={private}")
    assert "./oss/server.js" in web_command(docs), web_command(docs)


def main() -> int:
    check("oss", "ghcr.io/agenta-ai/agenta-web", "./oss/server.js")
    check("ee", "ghcr.io/agenta-ai/agenta-web", "./oss/server.js")
    check_web_override()
    print("OK: every default image is public for both licenses.")
    return 0


def test_images_by_license() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0


if __name__ == "__main__":
    raise SystemExit(main())
