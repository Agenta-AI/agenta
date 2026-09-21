# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart guard for the Agenta gateway values.

`docs/docs/self-host/reference/01-configuration.mdx` documents a `values.yaml path` for each
gateway setting. The chart's schema keeps `additionalProperties: true` at the root, so before
these keys were real an operator who wrote `mcpGateway: {enabled: false}` got a clean install
and no effect. This test renders the chart and asserts the opposite of that: each documented
key reaches the containers that read it, carrying the value the operator set.

It also asserts the negatives, which is the half a rendered manifest will not tell you by
looking at it. `AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED` is read by the agenta SDK
(`sdks/python/agenta/sdk/agents/connections/models.py`) and the runner
(`services/runner/src/engines/sandbox_agent/run-plan.ts`) and by nothing in the API image, so
it must not appear on the API. The four switches `api/oss/src/utils/env.py` resolves must not
appear on the runner, whose environment is narrow on purpose because a local harness process
shares its container (see test_runner_secret_absence.py).

Run: uv run hosting/kubernetes/helm/tests/test_gateway_values.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]

# Minimum values needed for the chart to render (URLs and secrets are required by the
# chart's own guards; agenta.validateRequiredSecrets rejects the "replace-me" default).
BASE_ARGS = [
    "--set",
    "agenta.webUrl=https://agenta.example.com",
    "--set",
    "agenta.apiUrl=https://agenta.example.com/api",
    "--set",
    "agenta.servicesUrl=https://agenta.example.com/services",
    "--set",
    "agentRunner.enabled=true",
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

# The four the API image resolves through env.py. They ride commonEnv, which is this chart's
# equivalent of the single env file compose hands to api, workers and cron.
API_SIDE = (
    "AGENTA_LLM_GATEWAY_ENABLED",
    "AGENTA_MCP_GATEWAY_ENABLED",
    "AGENTA_MCP_GATEWAY_HOST_ALLOWLIST",
    "AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED",
    "AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS",
)

COMMON_ENV_COMPONENTS = ("api", "services", "worker-streams", "worker-queues", "cron")

INSECURE_HTTP = "AGENTA_GATEWAYS_INSECURE_HTTP_ALLOWED"


def render(extra_args: list[str]) -> list[dict]:
    result = subprocess.run(
        [
            "helm",
            "template",
            "gateway-values-test",
            str(CHART_DIR),
            *BASE_ARGS,
            *extra_args,
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def container_env(docs: list[dict], component: str) -> dict[str, str | None]:
    """Name -> value for the primary container of a component's Deployment."""
    for doc in docs:
        if doc.get("kind") != "Deployment":
            continue
        labels = doc.get("metadata", {}).get("labels", {})
        if labels.get("app.kubernetes.io/component") != component:
            continue
        container = doc["spec"]["template"]["spec"]["containers"][0]
        return {entry["name"]: entry.get("value") for entry in container.get("env", [])}
    raise AssertionError(f"no {component} Deployment found in the rendered chart")


def expect(
    failures: list[str],
    env: dict[str, str | None],
    component: str,
    name: str,
    value: str,
) -> None:
    if name not in env:
        failures.append(f"{component} env must contain {name}")
    elif env[name] != value:
        failures.append(f"{component} {name} is {env[name]!r}, expected {value!r}")


def expect_absent(
    failures: list[str], env: dict[str, str | None], component: str, name: str
) -> None:
    if name in env:
        failures.append(f"{component} env must not contain {name}")


def collect_failures() -> list[str]:
    failures: list[str] = []

    # --- 1. Chart defaults. ---
    # The two `gatewayEgress` guards must render NOTHING here, so the application's own
    # defaults stand and a `helm upgrade` with an unchanged values file cannot turn a guard
    # off. An earlier revision of this test asserted `"true"` for the egress flag, which
    # pinned a permissive chart default in place instead of catching it; asserting the
    # absence is the whole point of this block.
    docs = render([])
    envs = {c: container_env(docs, c) for c in COMMON_ENV_COMPONENTS}
    envs["web"] = container_env(docs, "web")
    envs["web-mobile"] = container_env(docs, "web-mobile")
    envs["runner"] = container_env(docs, "runner")

    for component in COMMON_ENV_COMPONENTS:
        expect(
            failures, envs[component], component, "AGENTA_MCP_GATEWAY_ENABLED", "true"
        )
        expect(
            failures, envs[component], component, "AGENTA_LLM_GATEWAY_ENABLED", "false"
        )
        # Unset in values.yaml, so env.py's own default (False) decides. Rendering "true"
        # here would disable the guard on every upgrade that touches no values file.
        expect_absent(
            failures,
            envs[component],
            component,
            "AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED",
        )
        # Empty allowlist and unset TTL render nothing at all, so the application's own
        # parsing of "absent" applies. An empty-string entry would be a different value.
        expect_absent(
            failures, envs[component], component, "AGENTA_MCP_GATEWAY_HOST_ALLOWLIST"
        )
        expect_absent(
            failures,
            envs[component],
            component,
            "AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS",
        )

    # The web containers read the MCP switch themselves (web/entrypoint.sh normalizes it into
    # NEXT_PUBLIC_AGENTA_MCP_GATEWAY_ENABLED), and read none of the others.
    for component in ("web", "web-mobile"):
        expect(
            failures, envs[component], component, "AGENTA_MCP_GATEWAY_ENABLED", "true"
        )
        for name in API_SIDE:
            if name == "AGENTA_MCP_GATEWAY_ENABLED":
                continue
            expect_absent(failures, envs[component], component, name)
        expect_absent(failures, envs[component], component, INSECURE_HTTP)

    # The plain-http opt-in is unset by default too, so it reaches nobody at all until an
    # operator asks for it. Which legs it reaches once asked for is case 1b below.
    for component in (*COMMON_ENV_COMPONENTS, "runner", "web", "web-mobile"):
        expect_absent(failures, envs[component], component, INSECURE_HTTP)

    # The runner's environment stays narrow: none of the API-side switches reach it.
    for name in API_SIDE:
        expect_absent(failures, envs["runner"], "runner", name)

    # --- 1b. Both guards opened explicitly. ---
    # Case 1 proves the chart asks for nothing. This proves an operator who does ask still
    # gets it, and on exactly the legs that read it, which is the coverage case 1 used to
    # carry while the permissive value lived in values.yaml. The helpers key off `hasKey`
    # rather than truthiness, so this and the explicit `false` in case 2 are separate paths
    # and both need pinning.
    opened = render(
        [
            "--set",
            "gatewayEgress.insecureAllowed=true",
            "--set",
            "gatewayEgress.insecureHttpAllowed=true",
        ]
    )
    for component in COMMON_ENV_COMPONENTS:
        expect(
            failures,
            container_env(opened, component),
            component,
            "AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED",
            "true",
        )
    # The plain-http opt-in goes to the two legs that apply the transport rule, and nowhere
    # else. The API in particular reads no such variable.
    for component in ("services", "runner"):
        expect(
            failures, container_env(opened, component), component, INSECURE_HTTP, "true"
        )
    for component in ("api", "worker-streams", "worker-queues", "cron"):
        expect_absent(
            failures, container_env(opened, component), component, INSECURE_HTTP
        )

    # --- 2. Every value set to a non-default. ---
    overrides = render(
        [
            "--set",
            "mcpGateway.enabled=false",
            "--set",
            "llmGateway.enabled=true",
            "--set",
            "mcpGateway.hostAllowlist={mcp.internal,10.0.0.5}",
            "--set",
            "gatewayEgress.insecureAllowed=false",
            "--set",
            "gatewayEgress.insecureHttpAllowed=false",
            "--set",
            "gatewayCredentials.ttlSeconds=900",
        ]
    )
    for component in COMMON_ENV_COMPONENTS:
        env = container_env(overrides, component)
        expect(failures, env, component, "AGENTA_MCP_GATEWAY_ENABLED", "false")
        expect(failures, env, component, "AGENTA_LLM_GATEWAY_ENABLED", "true")
        expect(
            failures, env, component, "AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED", "false"
        )
        # A YAML list, joined into the one comma-separated string the application parses.
        expect(
            failures,
            env,
            component,
            "AGENTA_MCP_GATEWAY_HOST_ALLOWLIST",
            "mcp.internal,10.0.0.5",
        )
        expect(
            failures, env, component, "AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS", "900"
        )
    for component in ("web", "web-mobile"):
        expect(
            failures,
            container_env(overrides, component),
            component,
            "AGENTA_MCP_GATEWAY_ENABLED",
            "false",
        )
    for component in ("services", "runner"):
        expect(
            failures,
            container_env(overrides, component),
            component,
            INSECURE_HTTP,
            "false",
        )
    expect_absent(failures, container_env(overrides, "api"), "api", INSECURE_HTTP)
    for name in API_SIDE:
        expect_absent(failures, container_env(overrides, "runner"), "runner", name)

    # A comma-separated string is accepted where a list is, for a value pasted straight out
    # of the compose env file.
    string_allowlist = render(
        ["--set", "mcpGateway.hostAllowlist=mcp.internal\\,10.0.0.5"]
    )
    expect(
        failures,
        container_env(string_allowlist, "api"),
        "api",
        "AGENTA_MCP_GATEWAY_HOST_ALLOWLIST",
        "mcp.internal,10.0.0.5",
    )

    # --- 3. An unset ttlSeconds renders nothing at all. ---
    # The defaults pass above covers the key being absent. This covers the other spelling of
    # "I did not set it": an empty string, which a templated values file produces. Neither may
    # render an env entry, because the application reads an empty AGENTA_GATEWAYS_CREDENTIALS_
    # TTL_SECONDS as a value it has to reject rather than as "use your default".
    empty_ttl = render(["--set", "gatewayCredentials.ttlSeconds="])
    for component in COMMON_ENV_COMPONENTS:
        env = container_env(empty_ttl, component)
        if "AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS" in env:
            failures.append(
                f"{component} renders AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS="
                f"{env['AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS']!r} for an empty ttlSeconds"
            )

    # A bare `ttlSeconds:` with nothing after it is a YAML null, and the schema rejects it by
    # name at install time rather than letting the chart guess. That is the chart's existing
    # behavior for every typed leaf, so assert it instead of quietly widening the type.
    null_ttl = subprocess.run(
        [
            "helm",
            "template",
            "gateway-values-test",
            str(CHART_DIR),
            *BASE_ARGS,
            "--set",
            "gatewayCredentials.ttlSeconds=null",
        ],
        capture_output=True,
        text=True,
    )
    if null_ttl.returncode == 0:
        failures.append("a null gatewayCredentials.ttlSeconds should fail the schema")
    elif "gatewayCredentials.ttlSeconds" not in null_ttl.stderr:
        failures.append(
            "a null gatewayCredentials.ttlSeconds fails without naming the key: "
            f"{null_ttl.stderr.strip()!r}"
        )

    # --- 4. Every rendered value is a STRING, whatever type the operator supplied. ---
    # `--set mcpGateway.enabled=true` gives the template a YAML boolean, and an env entry
    # whose `value` is an unquoted `true` is rejected by the Kubernetes API, which types that
    # field as a string. Helm renders the manifest either way, so the install is what breaks,
    # not the render. Every check above happens to depend on the quoting, because a bare
    # `true` parses back as a Python bool and compares unequal to "true". This case says so
    # out loud, so the reason survives an edit to the ones above.
    booleans_via_set = render(
        [
            "--set",
            "mcpGateway.enabled=true",
            "--set",
            "llmGateway.enabled=false",
            "--set",
            "gatewayEgress.insecureAllowed=true",
            "--set",
            "gatewayEgress.insecureHttpAllowed=true",
            "--set",
            "gatewayCredentials.ttlSeconds=900",
        ]
    )
    typed = {
        "api": (
            "AGENTA_MCP_GATEWAY_ENABLED",
            "AGENTA_LLM_GATEWAY_ENABLED",
            "AGENTA_GATEWAYS_INSECURE_EGRESS_ALLOWED",
            "AGENTA_GATEWAYS_CREDENTIALS_TTL_SECONDS",
        ),
        "web": ("AGENTA_MCP_GATEWAY_ENABLED",),
        "runner": (INSECURE_HTTP,),
    }
    for component, names in typed.items():
        env = container_env(booleans_via_set, component)
        for name in names:
            value = env.get(name)
            if not isinstance(value, str):
                failures.append(
                    f"{component} {name} rendered as {type(value).__name__} {value!r}; "
                    "an env value must be a quoted string or Kubernetes refuses the pod"
                )

    # --- 5. A misspelled gateway key fails the install instead of being ignored. ---
    # The whole point of the schema block: the root is additionalProperties:true, so before
    # these keys were modelled `mcpGateway: {enabled: false}` installed cleanly and did
    # nothing. A typo inside a modelled block must now be refused.
    typo = subprocess.run(
        [
            "helm",
            "template",
            "gateway-values-test",
            str(CHART_DIR),
            *BASE_ARGS,
            "--set",
            "mcpGateway.enable=false",
        ],
        capture_output=True,
        text=True,
    )
    if typo.returncode == 0:
        failures.append("a misspelled mcpGateway key should fail the schema")

    return failures


def failure_report(failures: list[str]) -> str:
    return "gateway values do not reach the right containers:\n" + "\n".join(
        f"  - {failure}" for failure in failures
    )


def test_gateway_values_reach_their_readers() -> None:
    """pytest entry point. The module also runs standalone; both call collect_failures()."""
    failures = collect_failures()
    assert not failures, failure_report(failures)


if __name__ == "__main__":
    _failures = collect_failures()
    if _failures:
        raise SystemExit(failure_report(_failures))
    print(
        "OK: gateway values render into their readers only "
        "(API-side switches off the runner, plain-http opt-in off the API)."
    )
