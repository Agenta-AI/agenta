# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage: the single-replica stateful workloads resist autoscaler scale-down.

`redisVolatile`, `redisDurable` and `supertokens` each run one replica and hold state. A cluster
autoscaler consolidating their node takes the component down. On Autopilot the annotation also
delays automatic node upgrades and can be overridden by GKE after about seven days; it lowers the
odds of an eviction, it does not remove them. On GKE Autopilot that happened in
production traffic on 2026-09-27: the autoscaler evicted redis-volatile and supertokens, and every
agent turn was refused for about 15 s while the replacement pod started
(Agenta-AI/agenta_cloud#1684).

Run: uv run hosting/kubernetes/helm/tests/test_stateful_singleton_eviction.py
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
COMPONENTS = ("redis-volatile", "redis-durable", "supertokens")


def render(extra_args: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "eviction-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def pod_annotations(docs: list[dict], component: str) -> dict:
    for doc in docs:
        if doc.get("kind") not in ("Deployment", "StatefulSet"):
            continue
        labels = doc.get("metadata", {}).get("labels", {})
        if labels.get("app.kubernetes.io/component") != component:
            continue
        return doc["spec"]["template"]["metadata"].get("annotations", {})
    raise AssertionError(f"no workload rendered for component {component}")


def test_singletons_are_not_safe_to_evict_by_default() -> None:
    docs = render()
    for component in COMPONENTS:
        assert pod_annotations(docs, component).get(ANNOTATION) == "false", component


def test_each_component_can_opt_out() -> None:
    docs = render(
        [
            "--set",
            "redisVolatile.safeToEvict=true",
            "--set",
            "redisDurable.safeToEvict=true",
            "--set",
            "supertokens.safeToEvict=true",
        ]
    )
    for component in COMPONENTS:
        assert pod_annotations(docs, component).get(ANNOTATION) == "true", component


def test_pod_annotations_win_over_the_default() -> None:
    # `--set-string`, not `--set`: a Kubernetes annotation value must be a string, and a bare
    # `--set key=true` renders an unquoted boolean that the api server rejects.
    docs = render(
        [
            "--set-string",
            "redisVolatile.podAnnotations.cluster-autoscaler\\.kubernetes\\.io/safe-to-evict=true",
            "--set-string",
            "redisVolatile.podAnnotations.example\\.com/owner=platform",
        ]
    )
    annotations = pod_annotations(docs, "redis-volatile")
    assert annotations.get(ANNOTATION) == "true"
    assert annotations.get("example.com/owner") == "platform"


def test_other_workloads_are_untouched() -> None:
    # The api is stateless and horizontally scalable; blocking scale-down there would only
    # keep nodes alive for no reason.
    docs = render()
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        labels = doc.get("metadata", {}).get("labels", {})
        if labels.get("app.kubernetes.io/component") != "api":
            continue
        assert ANNOTATION not in doc["spec"]["template"]["metadata"].get(
            "annotations", {}
        )
        return
    raise AssertionError("no api Deployment rendered")


if __name__ == "__main__":
    test_singletons_are_not_safe_to_evict_by_default()
    test_each_component_can_opt_out()
    test_pod_annotations_win_over_the_default()
    test_other_workloads_are_untouched()
    print("ok")
