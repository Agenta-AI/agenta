# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for the graceful-rollout keys.

`<component>.strategy`, `<component>.lifecycle` and
`<component>.terminationGracePeriodSeconds` are opt-in per workload. This test
checks that every workload reads its own three keys, that setting them on `api`
reaches the api workload and nothing else, and that a default render still
carries none of them.

Run: uv run hosting/kubernetes/helm/tests/test_lifecycle_rollout.py
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

# Every workload the chart renders a pod spec for.
WORKLOAD_KINDS = ("Deployment", "StatefulSet", "Job")


def render(extra_args: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "lifecycle-chart-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def workloads(docs: list[dict]) -> list[dict]:
    """Workloads this chart owns. Skips the PostgreSQL subchart's own objects."""
    return [
        doc
        for doc in docs
        if doc.get("kind") in WORKLOAD_KINDS
        and doc.get("metadata", {}).get("labels", {}).get("app.kubernetes.io/name")
        == "agenta"
    ]


def component_of(workload: dict) -> str:
    return workload["metadata"]["labels"]["app.kubernetes.io/component"]


def pod_spec(workload: dict) -> dict:
    return workload["spec"]["template"]["spec"]


def containers_with_lifecycle(workload: dict) -> list[dict]:
    return [c for c in pod_spec(workload)["containers"] if "lifecycle" in c]


API_ARGS = [
    "--set",
    "api.terminationGracePeriodSeconds=45",
    "--set",
    "api.lifecycle.preStop.sleep.seconds=10",
    "--set",
    "api.strategy.rollingUpdate.maxUnavailable=0",
    "--set",
    "api.strategy.type=RollingUpdate",
]

# Every workload, as (values key, component label, takes a spec.strategy).
# A Deployment takes one; the two StatefulSets and the migration Job do not.
# The README and values.yaml both list these 13, so this table is the check
# that the list is true.
WORKLOADS = (
    ("api", "api", True),
    ("services", "services", True),
    ("web", "web", True),
    ("webMobile", "web-mobile", True),
    ("cron", "cron", True),
    ("workerStreams", "worker-streams", True),
    ("workerQueues", "worker-queues", True),
    ("agentRunner", "runner", True),
    ("supertokens", "supertokens", True),
    ("redisVolatile", "redis-volatile", True),
    ("redisDurable", "redis-durable", False),
    ("store.seaweedfs", "seaweedfs", False),
    ("alembic", "alembic", False),
)

# The two workloads that are off by default, and what turns them on.
ALL_WORKLOADS_ON = [
    "--set",
    "store.enabled=true",
    "--set",
    "webMobile.enabled=true",
]


def every_workload_reads_its_own_keys() -> None:
    """Set the three keys on all 13 workloads at once, in one render.

    Each workload gets a grace period of its own, so a workload that reads
    another one's value fails here instead of looking correct. A workload that
    reads no value at all fails too. Without this, dropping `lifecycle` from,
    say, the web or the runner template would pass every other assertion in
    this file.
    """
    args = list(ALL_WORKLOADS_ON)
    grace_periods = {}
    for index, (key, component, _) in enumerate(WORKLOADS):
        grace = 20 + index  # distinct per workload
        grace_periods[component] = grace
        args += [
            "--set",
            f"{key}.terminationGracePeriodSeconds={grace}",
            "--set",
            f"{key}.lifecycle.preStop.exec.command[0]=drain-{component}",
        ]
        if component != "alembic":
            # The Job has no spec.strategy to take one, and `strategy` on a
            # StatefulSet must stay unrendered, which the loop below checks.
            args += ["--set", f"{key}.strategy.type=Recreate"]

    rendered = {component_of(w): w for w in workloads(render(args))}
    expected = sorted(component for _, component, _ in WORKLOADS)
    assert sorted(rendered) == expected, sorted(rendered)

    for key, component, takes_strategy in WORKLOADS:
        workload = rendered[component]
        spec = pod_spec(workload)
        assert spec.get("terminationGracePeriodSeconds") == grace_periods[component], (
            f"{key} -> {component}: grace period "
            f"{spec.get('terminationGracePeriodSeconds')}"
        )
        with_lifecycle = containers_with_lifecycle(workload)
        assert len(with_lifecycle) == 1, f"{key} -> {component}: {with_lifecycle}"
        assert with_lifecycle[0]["lifecycle"] == {
            "preStop": {"exec": {"command": [f"drain-{component}"]}}
        }, f"{key} -> {component}"
        if takes_strategy:
            assert workload["spec"].get("strategy") == {"type": "Recreate"}, (
                f"{key} -> {component}: {workload['spec'].get('strategy')}"
            )
        else:
            assert "strategy" not in workload["spec"], (
                f"{key} -> {component} is a {workload['kind']} and has no "
                f"spec.strategy, so the chart must not render one"
            )


def main() -> int:
    # --- A default render carries none of the three keys. ---
    # Twice: once as the chart comes, and once with every workload on, so the
    # two that are off by default are covered here too.
    for extra_args in ([], ALL_WORKLOADS_ON):
        default_workloads = workloads(render(extra_args))
        if extra_args:
            assert len(default_workloads) == len(WORKLOADS), default_workloads
        else:
            assert len(default_workloads) >= 11, default_workloads
        for workload in default_workloads:
            name = component_of(workload)
            assert "strategy" not in workload["spec"], name
            assert "terminationGracePeriodSeconds" not in pod_spec(workload), name
            assert containers_with_lifecycle(workload) == [], name

    # --- Every workload reads its own three keys. ---
    every_workload_reads_its_own_keys()

    # --- Set all three on api only. ---
    docs = render(API_ARGS)
    api = next(w for w in workloads(docs) if component_of(w) == "api")

    assert api["spec"]["strategy"] == {
        "type": "RollingUpdate",
        "rollingUpdate": {"maxUnavailable": 0},
    }
    assert pod_spec(api)["terminationGracePeriodSeconds"] == 45
    api_containers = containers_with_lifecycle(api)
    assert len(api_containers) == 1, api_containers
    assert api_containers[0]["lifecycle"] == {"preStop": {"sleep": {"seconds": 10}}}

    # --- Once, and nowhere else. ---
    with_strategy = [w for w in workloads(docs) if "strategy" in w["spec"]]
    with_grace = [
        w for w in workloads(docs) if "terminationGracePeriodSeconds" in pod_spec(w)
    ]
    with_lifecycle = [w for w in workloads(docs) if containers_with_lifecycle(w)]
    assert [component_of(w) for w in with_strategy] == ["api"]
    assert [component_of(w) for w in with_grace] == ["api"]
    assert [component_of(w) for w in with_lifecycle] == ["api"]

    # --- A grace period of 0 is a real value, not an unset one. ---
    zero_docs = render(["--set", "cron.terminationGracePeriodSeconds=0"])
    cron = next(w for w in workloads(zero_docs) if component_of(w) == "cron")
    assert pod_spec(cron)["terminationGracePeriodSeconds"] == 0

    # --- A StatefulSet takes the pod-level keys and never a spec.strategy. ---
    sts_docs = render(
        [
            "--set",
            "redisDurable.terminationGracePeriodSeconds=60",
            "--set",
            "redisDurable.lifecycle.preStop.exec.command[0]=redis-cli",
            "--set",
            "redisDurable.lifecycle.preStop.exec.command[1]=shutdown",
            "--set",
            "redisDurable.strategy.type=Recreate",
        ]
    )
    redis_durable = next(
        w for w in workloads(sts_docs) if component_of(w) == "redis-durable"
    )
    assert redis_durable["kind"] == "StatefulSet"
    assert pod_spec(redis_durable)["terminationGracePeriodSeconds"] == 60
    assert containers_with_lifecycle(redis_durable)[0]["lifecycle"] == {
        "preStop": {"exec": {"command": ["redis-cli", "shutdown"]}}
    }
    assert "strategy" not in redis_durable["spec"]

    print(
        "OK: strategy, lifecycle and grace period render per workload, and only there."
    )
    return 0


def test_graceful_rollout_keys_are_per_workload() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0, "graceful-rollout keys render per workload"


if __name__ == "__main__":
    raise SystemExit(main())
