# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage: per-workload priorityClassName and the spare capacity placeholders.

A system pod runs at a priority no user PriorityClass can reach, so on a full node it can
preempt one of our single-replica stateful pods. The chart offers two settings, both off by
default. `<workload>.priorityClassName` sets the class of one workload. `spareCapacity` runs
placeholder pods at a negative priority, so the scheduler evicts them first and the evicted
placeholder asks the autoscaler for a new node.

These tests check that both stay off by default, that every workload passes its class
through, and that the placeholder class keeps the two properties the design depends on:
`preemptionPolicy: Never`, and a value of -10 by default, the lowest value at which GKE
still adds a node for a pending pod.

Run: uv run hosting/kubernetes/helm/tests/test_priority_and_spare_capacity.py
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
    # The bundled SeaweedFS renders only with the store on.
    "--set",
    "store.enabled=true",
]

# values key -> app.kubernetes.io/component label of the rendered workload
WORKLOADS = {
    "api": "api",
    "web": "web",
    "webMobile": "web-mobile",
    "services": "services",
    "agentRunner": "runner",
    "supertokens": "supertokens",
    "cron": "cron",
    "workerStreams": "worker-streams",
    "workerQueues": "worker-queues",
    "redisVolatile": "redis-volatile",
    "redisDurable": "redis-durable",
    "store.seaweedfs": "seaweedfs",
    "alembic": "alembic",
}

SPARE = "spare-capacity"


def render(extra_args: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "priority-test",
            str(CHART_DIR),
            "--namespace",
            "team-a",
            *BASE_ARGS,
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def workloads(docs: list[dict]) -> dict[str, dict]:
    found = {}
    for doc in docs:
        if doc.get("kind") not in ("Deployment", "StatefulSet", "Job"):
            continue
        component = (
            doc.get("metadata", {}).get("labels", {}).get("app.kubernetes.io/component")
        )
        if component:
            found[component] = doc["spec"]["template"]["spec"]
    return found


def of_kind(docs: list[dict], kind: str) -> list[dict]:
    return [doc for doc in docs if doc.get("kind") == kind]


def test_off_by_default() -> None:
    docs = render()
    pods = workloads(docs)
    for component in WORKLOADS.values():
        assert component in pods, f"no workload rendered for {component}"
        assert "priorityClassName" not in pods[component], component
    assert SPARE not in pods
    assert of_kind(docs, "PriorityClass") == []


def test_every_workload_passes_its_class_through() -> None:
    args: list[str] = []
    for key in WORKLOADS:
        args += [
            "--set",
            f"{key}.priorityClassName=class-{key.replace('.', '-').lower()}",
        ]
    pods = workloads(render(args))
    for key, component in WORKLOADS.items():
        expected = f"class-{key.replace('.', '-').lower()}"
        assert pods[component].get("priorityClassName") == expected, component


def test_one_workload_does_not_leak_into_another() -> None:
    pods = workloads(
        render(["--set", "redisVolatile.priorityClassName=agenta-stateful"])
    )
    assert pods["redis-volatile"]["priorityClassName"] == "agenta-stateful"
    for component, spec in pods.items():
        if component != "redis-volatile":
            assert "priorityClassName" not in spec, component


def test_spare_capacity_defaults() -> None:
    docs = render(["--set", "spareCapacity.enabled=true"])
    classes = of_kind(docs, "PriorityClass")
    assert len(classes) == 1
    priority_class = classes[0]
    # Cluster-scoped, so the default name carries the namespace and the release.
    assert (
        priority_class["metadata"]["name"]
        == "team-a-priority-test-agenta-spare-capacity"
    )
    assert priority_class["value"] == -10
    assert priority_class["preemptionPolicy"] == "Never"
    assert priority_class["globalDefault"] is False

    pod = workloads(docs)[SPARE]
    assert pod["priorityClassName"] == priority_class["metadata"]["name"]
    assert pod["terminationGracePeriodSeconds"] == 0
    assert pod["automountServiceAccountToken"] is False
    (container,) = pod["containers"]
    assert container["resources"] == {"requests": {"cpu": "500m", "memory": "512Mi"}}
    assert pod["securityContext"]["runAsNonRoot"] is True

    deployment = next(
        doc
        for doc in of_kind(docs, "Deployment")
        if doc["metadata"]["labels"].get("app.kubernetes.io/component") == SPARE
    )
    assert deployment["spec"]["replicas"] == 1


def test_spare_capacity_overrides() -> None:
    docs = render(
        [
            "--set",
            "spareCapacity.enabled=true",
            "--set",
            "spareCapacity.replicas=3",
            "--set",
            "spareCapacity.priorityClass.name=placeholders",
            "--set",
            "spareCapacity.priorityClass.value=-5",
            "--set",
            "spareCapacity.resources.requests.cpu=1",
            "--set",
            "spareCapacity.resources.requests.memory=2Gi",
        ]
    )
    (priority_class,) = of_kind(docs, "PriorityClass")
    assert priority_class["metadata"]["name"] == "placeholders"
    assert priority_class["value"] == -5
    deployment = next(
        doc
        for doc in of_kind(docs, "Deployment")
        if doc["metadata"]["labels"].get("app.kubernetes.io/component") == SPARE
    )
    assert deployment["spec"]["replicas"] == 3
    pod = deployment["spec"]["template"]["spec"]
    assert pod["priorityClassName"] == "placeholders"
    assert pod["containers"][0]["resources"]["requests"] == {"cpu": 1, "memory": "2Gi"}


def test_schema_refuses_a_positive_placeholder_priority() -> None:
    result = subprocess.run(
        [
            "helm",
            "template",
            "priority-test",
            str(CHART_DIR),
            *BASE_ARGS,
            "--set",
            "spareCapacity.enabled=true",
            "--set",
            "spareCapacity.priorityClass.value=10",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert "spareCapacity" in result.stderr


if __name__ == "__main__":
    test_off_by_default()
    test_every_workload_passes_its_class_through()
    test_one_workload_does_not_leak_into_another()
    test_spare_capacity_defaults()
    test_spare_capacity_overrides()
    test_schema_refuses_a_positive_placeholder_priority()
    print("ok")
