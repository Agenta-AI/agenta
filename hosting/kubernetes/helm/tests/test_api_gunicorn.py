# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for the api's gunicorn worker lifecycle.

A recycled or stopped api worker finishes its open requests for
`api.gunicorn.gracefulTimeout` seconds, and the pod's grace period must outlast
that drain plus the preStop delay, or the kubelet cuts a long LLM gateway
stream. This test checks the defaults, that each `api.gunicorn` key reaches the
gunicorn command, that the grace period follows `gracefulTimeout` unless it is
set, and that the schema rejects a key the chart does not read.

Run: uv run hosting/kubernetes/helm/tests/test_api_gunicorn.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import subprocess
import tempfile
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
            "gunicorn-chart-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *extra_args,
        ],
        capture_output=True,
        text=True,
    )


def render_api(extra_args: list[str] | None = None) -> dict:
    result = helm_template(extra_args or [])
    assert result.returncode == 0, result.stderr
    return next(
        doc
        for doc in yaml.safe_load_all(result.stdout)
        if doc
        and doc.get("kind") == "Deployment"
        and doc["metadata"]["labels"].get("app.kubernetes.io/component") == "api"
    )


def gunicorn_flags(api: dict) -> dict[str, str]:
    command = api["spec"]["template"]["spec"]["containers"][0]["command"]
    flags = {}
    for index, token in enumerate(command):
        if token.startswith("--") and index + 1 < len(command):
            flags[token] = command[index + 1]
    return flags


def grace_period(api: dict) -> int:
    return api["spec"]["template"]["spec"]["terminationGracePeriodSeconds"]


def main() -> int:
    # --- Defaults: a 15-minute drain, rare recycles, a grace period that outlasts both. ---
    api = render_api()
    flags = gunicorn_flags(api)
    assert flags["--worker-class"] == "entrypoints.uvicorn_worker.DrainingUvicornWorker"
    assert flags["--graceful-timeout"] == "900", flags
    assert flags["--max-requests"] == "100000", flags
    assert flags["--max-requests-jitter"] == "10000", flags
    assert flags["--timeout"] == "60", flags
    # 10 s preStop + 900 s drain + margin.
    assert grace_period(api) == 930, grace_period(api)

    # --- Each key reaches the command; the grace period follows gracefulTimeout. ---
    api = render_api(
        [
            "--set",
            "api.gunicorn.gracefulTimeout=600",
            "--set",
            "api.gunicorn.maxRequests=0",
            "--set",
            "api.gunicorn.maxRequestsJitter=0",
            "--set",
            "api.gunicorn.timeout=120",
        ]
    )
    flags = gunicorn_flags(api)
    assert flags["--graceful-timeout"] == "600", flags
    assert flags["--max-requests"] == "0", flags  # 0 is a value: recycling off
    assert flags["--max-requests-jitter"] == "0", flags
    assert flags["--timeout"] == "120", flags
    assert grace_period(api) == 630, grace_period(api)

    # --- A grace period set explicitly wins over the derived one. ---
    api = render_api(
        [
            "--set",
            "api.gunicorn.gracefulTimeout=600",
            "--set",
            "api.terminationGracePeriodSeconds=700",
        ]
    )
    assert grace_period(api) == 700, grace_period(api)

    # --- Large values from a values file render as integers, not as 1e+06. ---
    with tempfile.NamedTemporaryFile("w", suffix=".yaml") as values_file:
        yaml.safe_dump(
            {"api": {"gunicorn": {"maxRequests": 1000000, "gracefulTimeout": 1800}}},
            values_file,
        )
        values_file.flush()
        api = render_api(["-f", values_file.name])
    flags = gunicorn_flags(api)
    assert flags["--max-requests"] == "1000000", flags
    assert flags["--graceful-timeout"] == "1800", flags
    assert grace_period(api) == 1830, grace_period(api)

    # --- The schema rejects a key the chart does not read. ---
    result = helm_template(["--set", "api.gunicorn.graceful_timeout=600"])
    assert result.returncode != 0, "a misspelled api.gunicorn key must fail the render"
    assert "graceful_timeout" in result.stderr, result.stderr

    print("OK: api gunicorn lifecycle defaults, overrides and grace period render.")
    return 0


def test_api_gunicorn_lifecycle_renders() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0, "api gunicorn lifecycle renders"


if __name__ == "__main__":
    raise SystemExit(main())
