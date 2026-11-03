# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage: `api.safeToEvict` and `api.podAnnotations`.

On GKE Autopilot the api can fall into a loop: the chart spreads api pods over
distinct nodes, a new api pod lands on a near-empty spare node, and the cluster
autoscaler removes that node minutes later and evicts the pod again. `api.safeToEvict: false` puts the annotation
`cluster-autoscaler.kubernetes.io/safe-to-evict: "false"` on api pods, which stops
the loop. The default leaves api pods evictable, which is right where no
autoscaler runs. `api.podAnnotations` adds keys and overrides that one.

Run: uv run hosting/kubernetes/helm/tests/test_api_safe_to_evict.py
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
ANNOTATION = "cluster-autoscaler.kubernetes.io/safe-to-evict"
# The same key as a `--set` path: helm reads an unescaped dot as nesting.
ANNOTATION_SET_PATH = ANNOTATION.replace(".", "\\.")


def api_pod_annotations(extra_args: list[str] | None = None) -> dict:
    result = subprocess.run(
        [
            "helm",
            "template",
            "evict-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    api = next(
        doc
        for doc in yaml.safe_load_all(result.stdout)
        if doc
        and doc.get("kind") == "Deployment"
        and doc["metadata"]["labels"].get("app.kubernetes.io/component") == "api"
    )
    return api["spec"]["template"]["metadata"].get("annotations") or {}


def main() -> int:
    # --- Default: no annotation at all, so the pod template is unchanged for everyone else. ---
    assert api_pod_annotations() == {}, api_pod_annotations()

    # --- true is the same as unset: evictable, no annotation. ---
    assert api_pod_annotations(["--set", "api.safeToEvict=true"]) == {}

    # --- false adds the annotation, as a string, which is what the autoscaler reads. ---
    annotations = api_pod_annotations(["--set", "api.safeToEvict=false"])
    assert annotations == {ANNOTATION: "false"}, annotations

    # --- podAnnotations adds keys and overrides the one safeToEvict sets. ---
    annotations = api_pod_annotations(
        [
            "--set",
            "api.safeToEvict=false",
            "--set",
            "api.podAnnotations.example\\.com/owner=platform",
        ]
    )
    assert annotations == {ANNOTATION: "false", "example.com/owner": "platform"}, (
        annotations
    )
    annotations = api_pod_annotations(
        [
            "--set",
            "api.safeToEvict=false",
            "--set-string",
            f"api.podAnnotations.{ANNOTATION_SET_PATH}=true",
        ]
    )
    assert annotations == {ANNOTATION: "true"}, annotations

    print("OK: api.safeToEvict and api.podAnnotations render.")
    return 0


def test_api_safe_to_evict_renders() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0


if __name__ == "__main__":
    raise SystemExit(main())
