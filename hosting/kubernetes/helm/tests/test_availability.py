# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for availability under disruption.

The chart renders a PodDisruptionBudget per workload with two or more replicas
(`maxUnavailable: 1`), and for a single replica only when
`<workload>.pdb.protectSingleton` asks for it. It renders
topologySpreadConstraints for every workload with two or more replicas.
`podDisruptionBudgets.enabled` and `topologySpread.enabled` turn each off.
Both bundled redis instances carry a startup probe, so a long append-only-file
replay is not killed by liveness.

Run: uv run hosting/kubernetes/helm/tests/test_availability.py
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
    "--set",
    "store.enabled=true",
]


def render(extra_args: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "availability-chart-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [
        doc
        for doc in yaml.safe_load_all(result.stdout)
        if doc
        and doc.get("metadata", {}).get("labels", {}).get("app.kubernetes.io/name")
        == "agenta"
    ]


def component_of(doc: dict) -> str:
    return doc["metadata"]["labels"]["app.kubernetes.io/component"]


def budgets(docs: list[dict]) -> dict[str, dict]:
    return {
        component_of(d): d["spec"] for d in docs if d["kind"] == "PodDisruptionBudget"
    }


def workload(docs: list[dict], component: str) -> dict:
    return next(
        d
        for d in docs
        if d["kind"] in ("Deployment", "StatefulSet") and component_of(d) == component
    )


def spread_of(docs: list[dict], component: str) -> list[dict] | None:
    return workload(docs, component)["spec"]["template"]["spec"].get(
        "topologySpreadConstraints"
    )


def selector(component: str) -> dict:
    return {
        "matchLabels": {
            "app.kubernetes.io/name": "agenta",
            "app.kubernetes.io/instance": "availability-chart-test",
            "app.kubernetes.io/component": component,
        }
    }


def single_replicas_get_nothing() -> None:
    """Every workload runs one replica by default: no budget, no spread."""
    docs = render()
    assert budgets(docs) == {}, budgets(docs)
    for d in docs:
        if d["kind"] in ("Deployment", "StatefulSet"):
            spec = d["spec"]["template"]["spec"]
            assert "topologySpreadConstraints" not in spec, component_of(d)


def two_replicas_get_a_budget_and_a_spread() -> None:
    docs = render(["--set", "api.replicas=2", "--set", "web.replicas=3"])
    assert budgets(docs) == {
        "api": {"maxUnavailable": 1, "selector": selector("api")},
        "web": {"maxUnavailable": 1, "selector": selector("web")},
    }
    revision = {
        "matchLabelKeys": ["pod-template-hash"],
        "labelSelector": selector("api"),
    }
    assert spread_of(docs, "api") == [
        {
            "maxSkew": 1,
            "topologyKey": "kubernetes.io/hostname",
            "whenUnsatisfiable": "DoNotSchedule",
            **revision,
        },
        {
            "maxSkew": 1,
            "topologyKey": "topology.kubernetes.io/zone",
            "whenUnsatisfiable": "ScheduleAnyway",
            **revision,
        },
    ]
    assert spread_of(docs, "services") is None


def overrides_replace_the_defaults() -> None:
    docs = render(
        [
            "--set",
            "api.replicas=3",
            "--set",
            "api.pdb.minAvailable=2",
            "--set",
            "web.replicas=2",
            "--set",
            "web.pdb.maxUnavailable=0",  # 0 is a real value, not an unset one
            "--set",
            "services.replicas=2",
            "--set",
            "services.topologySpreadConstraints[0].maxSkew=2",
            "--set",
            "services.topologySpreadConstraints[0].topologyKey=example.com/rack",
            "--set",
            "services.topologySpreadConstraints[0].whenUnsatisfiable=ScheduleAnyway",
        ]
    )
    found = budgets(docs)
    assert found["api"] == {"minAvailable": 2, "selector": selector("api")}
    assert found["web"] == {"maxUnavailable": 0, "selector": selector("web")}
    assert spread_of(docs, "services") == [
        {
            "maxSkew": 2,
            "topologyKey": "example.com/rack",
            "whenUnsatisfiable": "ScheduleAnyway",
        }
    ]


def protect_singleton_is_opt_in() -> None:
    docs = render(
        [
            "--set",
            "agentRunner.pdb.protectSingleton=true",
            "--set",
            "store.seaweedfs.pdb.protectSingleton=true",
        ]
    )
    assert budgets(docs) == {
        "runner": {"minAvailable": 1, "selector": selector("runner")},
        "seaweedfs": {"minAvailable": 1, "selector": selector("seaweedfs")},
    }


def the_switches_turn_everything_off() -> None:
    docs = render(
        [
            "--set",
            "api.replicas=2",
            "--set",
            "agentRunner.pdb.protectSingleton=true",
            "--set",
            "podDisruptionBudgets.enabled=false",
            "--set",
            "topologySpread.enabled=false",
        ]
    )
    assert budgets(docs) == {}
    assert spread_of(docs, "api") is None


def redis_has_a_startup_probe() -> None:
    docs = render()
    for component in ("redis-volatile", "redis-durable"):
        container = workload(docs, component)["spec"]["template"]["spec"]["containers"][
            0
        ]
        probe = container.get("startupProbe")
        assert probe is not None, component
        assert probe["exec"]["command"][0] == "redis-cli", component
        assert probe["exec"]["command"][-1] == "ping", component
        assert probe["periodSeconds"] * probe["failureThreshold"] >= 300, component


def main() -> int:
    single_replicas_get_nothing()
    two_replicas_get_a_budget_and_a_spread()
    overrides_replace_the_defaults()
    protect_singleton_is_opt_in()
    the_switches_turn_everything_off()
    redis_has_a_startup_probe()
    print(
        "OK: disruption budgets, topology spread and redis startup probes render as designed."
    )
    return 0


def test_availability_under_disruption() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0


if __name__ == "__main__":
    raise SystemExit(main())
