# /// script
# requires-python = ">=3.11"
# ///
"""Regression checks for Ingress values that Kubernetes cannot safely accept."""

from __future__ import annotations

import subprocess
from pathlib import Path

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


def render(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["helm", "template", "ingress-test", str(CHART_DIR), *BASE_ARGS, *args],
        capture_output=True,
        text=True,
    )


def test_ingress_values_are_safe() -> None:
    disabled = render("--set", "store.seaweedfs.ingress.enabled=false")
    assert disabled.returncode == 0, disabled.stderr

    missing_host = render("--set", "store.seaweedfs.ingress.enabled=true")
    assert missing_host.returncode != 0
    assert "host is required" in missing_host.stderr

    empty_paths = render(
        "--set-json",
        'ingress.extraHosts=[{"host":"extra.example.com","paths":[]}]',
    )
    assert empty_paths.returncode != 0
    assert "must have at least 1 items" in empty_paths.stderr.lower()

    insecure = render(
        "--set",
        "store.enabled=true",
        "--set",
        "store.seaweedfs.ingress.enabled=true",
        "--set",
        "store.seaweedfs.ingress.host=store.example.com",
        "--set",
        "store.endpointUrl=http://store.example.com",
    )
    assert insecure.returncode != 0
    assert "requires an HTTPS store.endpointUrl" in insecure.stderr

    secure = render(
        "--set",
        "store.enabled=true",
        "--set",
        "store.seaweedfs.ingress.enabled=true",
        "--set",
        "store.seaweedfs.ingress.host=store.example.com",
        "--set",
        "store.endpointUrl=https://store.example.com",
        "--set-json",
        'store.seaweedfs.ingress.tls=[{"hosts":["store.example.com"],"secretName":"store-tls"}]',
    )
    assert secure.returncode == 0, secure.stderr


if __name__ == "__main__":
    test_ingress_values_are_safe()
    print("OK: invalid ingress values fail before Kubernetes sees them.")
