# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for the bundled data stores' NetworkPolicy.

`networkPolicy.enabled` is off by default. When it is on, the chart renders one
policy per bundled store it deploys, each one selecting that store's pods and
letting in only pods of the same release on that store's port.

Run: uv run hosting/kubernetes/helm/tests/test_network_policy.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]
RELEASE = "netpol-chart-test"
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

# The bundled stores, and the port each one listens on by default.
STORE_PORTS = {"redis-volatile": 6379, "redis-durable": 6381, "seaweedfs": 8333}


def render(extra_args: list[str] | None = None) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            RELEASE,
            str(CHART_DIR),
            *BASE_ARGS,
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def policies(docs: list[dict]) -> dict[str, dict]:
    """Chart-owned NetworkPolicies, keyed by component.

    The PostgreSQL subchart renders its own policy; it carries
    app.kubernetes.io/name: postgresql, so this filter leaves it out.
    """
    found = {}
    for doc in docs:
        labels = doc.get("metadata", {}).get("labels", {})
        if (
            doc.get("kind") == "NetworkPolicy"
            and labels.get("app.kubernetes.io/name") == "agenta"
        ):
            component = labels["app.kubernetes.io/component"]
            assert component not in found, f"two policies for {component}"
            found[component] = doc
    return found


def pod_labels(docs: list[dict], component: str) -> dict:
    for doc in docs:
        labels = doc.get("metadata", {}).get("labels", {})
        if (
            doc.get("kind") in ("Deployment", "StatefulSet")
            and labels.get("app.kubernetes.io/name") == "agenta"
            and labels.get("app.kubernetes.io/component") == component
        ):
            return doc["spec"]["template"]["metadata"]["labels"]
    raise AssertionError(f"no workload for component {component!r}")


STORE_ON = ["--set", "store.enabled=true"]
NETPOL_ON = ["--set", "networkPolicy.enabled=true"]


def main() -> int:
    # --- Off by default, and off even with the stores deployed. ---
    assert policies(render()) == {}
    assert policies(render(STORE_ON)) == {}

    # --- One policy per bundled store that is deployed. ---
    docs = render(STORE_ON + NETPOL_ON)
    rendered = policies(docs)
    assert sorted(rendered) == sorted(STORE_PORTS), sorted(rendered)

    for component, port in STORE_PORTS.items():
        policy = rendered[component]
        spec = policy["spec"]

        # The policy selects that store's pods, and only those.
        assert spec["podSelector"]["matchLabels"] == {
            "app.kubernetes.io/name": "agenta",
            "app.kubernetes.io/instance": RELEASE,
            "app.kubernetes.io/component": component,
        }, component
        selector = spec["podSelector"]["matchLabels"]
        assert selector.items() <= pod_labels(docs, component).items(), component

        # Ingress only, so egress stays unrestricted.
        assert spec["policyTypes"] == ["Ingress"], component

        # One rule: this release's pods, on the store's port. Anything else is
        # denied, because a selected pod accepts only what a policy allows.
        assert len(spec["ingress"]) == 1, component
        rule = spec["ingress"][0]
        assert rule["ports"] == [{"port": port, "protocol": "TCP"}], component
        assert rule["from"] == [
            {"podSelector": {"matchLabels": {"app.kubernetes.io/instance": RELEASE}}}
        ], component

    # --- A store that is not deployed gets no policy. ---
    no_store = policies(render(NETPOL_ON))
    assert sorted(no_store) == ["redis-durable", "redis-volatile"], sorted(no_store)

    # An external volatile Redis needs its URI; the chart refuses to render
    # without one.
    external_redis = policies(
        render(
            NETPOL_ON
            + [
                "--set",
                "redisVolatile.enabled=false",
                "--set",
                "redisVolatile.external.uri=redis://redis.example.com:6379/0",
            ]
        )
    )
    assert sorted(external_redis) == ["redis-durable"], sorted(external_redis)

    # --- A custom port lands in the policy. ---
    custom = policies(render(NETPOL_ON + ["--set", "redisVolatile.port=6390"]))
    assert custom["redis-volatile"]["spec"]["ingress"][0]["ports"] == [
        {"port": 6390, "protocol": "TCP"}
    ]

    # --- extraIngressFrom is appended to every policy, after the release rule. ---
    extra = policies(
        render(
            STORE_ON
            + NETPOL_ON
            + [
                "--set",
                "networkPolicy.extraIngressFrom[0].ipBlock.cidr=130.211.0.0/22",
                "--set",
                "networkPolicy.extraIngressFrom[1].ipBlock.cidr=35.191.0.0/16",
            ]
        )
    )
    assert sorted(extra) == sorted(STORE_PORTS)
    for component, policy in extra.items():
        assert policy["spec"]["ingress"][0]["from"] == [
            {"podSelector": {"matchLabels": {"app.kubernetes.io/instance": RELEASE}}},
            {"ipBlock": {"cidr": "130.211.0.0/22"}},
            {"ipBlock": {"cidr": "35.191.0.0/16"}},
        ], component

    print("OK: one NetworkPolicy per deployed bundled store, and none when disabled.")
    return 0


def test_network_policy_covers_every_deployed_store() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0, "one NetworkPolicy per deployed bundled store"


if __name__ == "__main__":
    raise SystemExit(main())
