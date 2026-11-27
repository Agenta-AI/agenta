# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for the migration Job's time limit.

Kubernetes stops the Job at `activeDeadlineSeconds` and the install or upgrade fails.
A data migration on a large instance takes minutes (adopting 41,006 organizations
took 569 s of a 601 s run), so the default is one hour. Operators can still set it.

Run: uv run hosting/kubernetes/helm/tests/test_alembic_deadline.py
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
        ["helm", "template", "alembic-deadline-test", str(CHART_DIR)]
        + BASE_ARGS
        + extra_args,
        capture_output=True,
        text=True,
    )


def deadline(extra_args: list[str] | None = None) -> int:
    result = helm_template(extra_args or [])
    assert result.returncode == 0, result.stderr
    [job] = [
        doc
        for doc in yaml.safe_load_all(result.stdout)
        if doc
        and doc.get("kind") == "Job"
        and doc["metadata"]["labels"].get("app.kubernetes.io/component") == "alembic"
    ]
    return job["spec"]["activeDeadlineSeconds"]


def main() -> int:
    assert deadline() == 3600, deadline()
    assert deadline(["--set", "alembic.activeDeadlineSeconds=7200"]) == 7200

    result = helm_template(["--set", "alembic.activeDeadlineSeconds=0"])
    assert result.returncode != 0, "a deadline of 0 must fail the schema"
    assert "activeDeadlineSeconds" in result.stderr, result.stderr

    print("OK: the migration Job deadline renders.")
    return 0


def test_alembic_deadline_renders() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0, "alembic deadline renders"


if __name__ == "__main__":
    raise SystemExit(main())
