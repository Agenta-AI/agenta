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


def redis_probes_fail_on_an_error_reply() -> None:
    """`redis-cli ping` must exit non-zero when the server answers with an error.

    Without -e, redis-cli exits 0 on an error REPLY and only fails on a connection
    problem. A Redis answering LOADING during an AOF replay therefore passed its probe
    and took traffic before it had its data. Measured in a running pod: `redis-cli get`
    with no argument exits 0 without -e and 1 with it.
    """
    docs = render()
    for component in ("redis-durable", "redis-volatile"):
        wl = workload(docs, component)
        container = wl["spec"]["template"]["spec"]["containers"][0]
        for probe in ("startupProbe", "livenessProbe", "readinessProbe"):
            command = container[probe]["exec"]["command"]
            assert "-e" in command, (
                f"{component}.{probe} runs {command!r}, which exits 0 on an error reply"
            )


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



def an_empty_spread_list_removes_the_constraints() -> None:
    """`topologySpreadConstraints: []` must mean none, which is what values.yaml promises.

    An empty list is falsy in Go templates, so the guard used to fall through to the
    generated block and quietly regenerate the two constraints the operator had just
    asked to remove. The documented escape hatch did nothing.
    """
    docs = render(["--set", "web.replicas=2", "--set-json", "web.topologySpreadConstraints=[]"])
    assert spread_of(docs, "web") is None, (
        "an empty list must remove the constraints, not regenerate them"
    )
    # The same render must leave another workload's generated constraints alone.
    docs = render(["--set", "web.replicas=2", "--set", "services.replicas=2",
                   "--set-json", "web.topologySpreadConstraints=[]"])
    assert spread_of(docs, "web") is None
    assert len(spread_of(docs, "services") or []) == 2


def the_mobile_app_keeps_its_budget_when_the_desktop_app_is_off() -> None:
    """web-mobile renders unconditionally, so its budget must not depend on web.enabled.

    agenta.workloads tied the mobile entry's `enabled` to the desktop app. Turning the
    desktop app off therefore removed the mobile budget while the mobile Deployment kept
    rendering, so the workload that was still serving lost its protection.
    """
    docs = render(["--set", "web.enabled=false", "--set", "webMobile.replicas=2"])
    names = [d["metadata"]["name"] for d in docs if d.get("kind") == "Deployment"]
    assert any("web-mobile" in n for n in names), "the mobile Deployment should still render"
    assert "web-mobile" in budgets(docs), "the mobile app should still have a budget"


def a_typo_in_either_switch_is_refused() -> None:
    """Both switches are declared in the schema, so a misspelling fails the render.

    The chart root is additionalProperties: true, so an undeclared key is accepted and
    silently ignored. `podDisruptionBudgets.enabledd: false` would have looked like it
    turned the budgets off and changed nothing.
    """
    for bad in ("podDisruptionBudgets.enabledd=false", "topologySpread.enabledd=false"):
        result = subprocess.run(
            ["helm", "template", "availability-test", str(CHART_DIR), *BASE_ARGS, "--set", bad],
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode != 0, f"{bad} should fail the render"
        assert "is not allowed" in result.stderr, f"{bad} should be refused by the schema"


def main() -> int:
    single_replicas_get_nothing()
    two_replicas_get_a_budget_and_a_spread()
    overrides_replace_the_defaults()
    protect_singleton_is_opt_in()
    the_switches_turn_everything_off()
    redis_has_a_startup_probe()
    redis_probes_fail_on_an_error_reply()
    an_empty_spread_list_removes_the_constraints()
    the_mobile_app_keeps_its_budget_when_the_desktop_app_is_off()
    a_typo_in_either_switch_is_refused()
    print(
        "OK: disruption budgets, topology spread and redis startup probes render as designed."
    )
    return 0


def test_availability_under_disruption() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0


if __name__ == "__main__":
    raise SystemExit(main())
