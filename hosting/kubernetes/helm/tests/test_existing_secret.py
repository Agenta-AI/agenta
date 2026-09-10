# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart guard for `secrets.existingSecret`.

When the operator brings their own Secret the chart does not create one, so every
`secretKeyRef` in the rendered manifests must point at that Secret. A reference to the
chart-managed name (`agenta.fullname`) resolves to nothing and the pod crash-loops with
`CreateContainerConfigError`. The runner token used to be hardcoded to `agenta.fullname`
in the runner Deployment and in the `agenta.agentRunner.servicesEnv` helper; this test is
the guard that keeps it, or any new reference, from regressing.

Run: uv run hosting/kubernetes/helm/tests/test_existing_secret.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]

RELEASE = "existing-secret-test"
EXISTING_SECRET = "my-agenta-secret"

# The chart-managed Secret name is `agenta.fullname`, which is "<release>-<chart>" unless the
# release name already contains the chart name. Keep this in sync with agenta.fullname.
CHART_MANAGED_SECRET = f"{RELEASE}-agenta"

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
    f"secrets.existingSecret={EXISTING_SECRET}",
    # The bundled PostgreSQL subchart must be pointed at the same Secret; the chart's own
    # agenta.validatePgauthSecret fails the render otherwise.
    "--set",
    f"global.postgresql.auth.existingSecret={EXISTING_SECRET}",
]


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


def pod_specs(docs: list[dict]) -> list[tuple[str, dict]]:
    """(workload name, pod spec) for every workload the chart renders."""
    specs: list[tuple[str, dict]] = []
    for doc in docs:
        if doc.get("kind") not in ("Deployment", "StatefulSet", "Job", "Pod"):
            continue
        name = doc.get("metadata", {}).get("name", "<unnamed>")
        if doc["kind"] == "Pod":
            specs.append((name, doc["spec"]))
        else:
            specs.append((name, doc["spec"]["template"]["spec"]))
    return specs


def secret_references(docs: list[dict]) -> list[tuple[str, str, str]]:
    """(workload, where, secret name) for every Secret reference in every pod spec."""
    refs: list[tuple[str, str, str]] = []
    for workload, spec in pod_specs(docs):
        containers = list(spec.get("initContainers", [])) + list(
            spec.get("containers", [])
        )
        for container in containers:
            where = f"container {container.get('name')}"
            for entry in container.get("env", []):
                ref = entry.get("valueFrom", {}).get("secretKeyRef")
                if ref and ref.get("name"):
                    refs.append((workload, f"{where} env {entry['name']}", ref["name"]))
            for entry in container.get("envFrom", []):
                ref = entry.get("secretRef")
                if ref and ref.get("name"):
                    refs.append((workload, f"{where} envFrom", ref["name"]))
        for volume in spec.get("volumes", []):
            secret = volume.get("secret")
            if secret and secret.get("secretName"):
                refs.append(
                    (workload, f"volume {volume.get('name')}", secret["secretName"])
                )
    return refs


def redact_failure_line(line: str) -> str:
    """Redact potentially sensitive values from failure output."""
    # Replace quoted values (for example secret names shown with !r) with a marker.
    return re.sub(r"'[^']*'", "'<redacted>'", line)


def main() -> int:
    failures: list[str] = []
    docs = render()

    # 1. The chart must not create its own Secret when the operator supplies one.
    for doc in docs:
        if (
            doc.get("kind") == "Secret"
            and doc["metadata"]["name"] == CHART_MANAGED_SECRET
        ):
            failures.append(
                f"chart rendered its own Secret {CHART_MANAGED_SECRET} despite secrets.existingSecret"
            )

    # 2. No workload may reference the chart-managed Secret name.
    refs = secret_references(docs)
    for workload, where, name in refs:
        if name == CHART_MANAGED_SECRET:
            failures.append(
                f"{workload}: {where} references the chart-managed Secret {name!r}, "
                f"expected {EXISTING_SECRET!r}"
            )

    # 3. The runner token specifically must come from the operator's Secret, on the runner
    #    Deployment and on every workload the servicesEnv helper feeds (api, services).
    token_refs = {
        workload: name
        for workload, where, name in refs
        if where.endswith("env AGENTA_RUNNER_TOKEN")
    }
    if not token_refs:
        failures.append("no workload references AGENTA_RUNNER_TOKEN")
    for workload, name in sorted(token_refs.items()):
        if name != EXISTING_SECRET:
            failures.append(
                f"{workload}: AGENTA_RUNNER_TOKEN reads Secret {name!r}, expected {EXISTING_SECRET!r}"
            )
    for suffix in ("-runner", "-api", "-services"):
        if not any(workload.endswith(suffix) for workload in token_refs):
            failures.append(
                f"no {suffix.lstrip('-')} workload reads AGENTA_RUNNER_TOKEN"
            )

    # 4. agentRunner.auth.tokenSecretRef still wins over both Secret names.
    own_ref_docs = render(
        [
            "--set",
            "agentRunner.auth.tokenSecretRef.name=runner-only-secret",
            "--set",
            "agentRunner.auth.tokenSecretRef.key=token",
        ]
    )
    for workload, where, name in secret_references(own_ref_docs):
        if where.endswith("env AGENTA_RUNNER_TOKEN") and name != "runner-only-secret":
            failures.append(
                f"{workload}: agentRunner.auth.tokenSecretRef ignored, reads {name!r}"
            )

    if failures:
        print("FAIL: secrets.existingSecret is not honored:", file=sys.stderr)
        for line in failures:
            print(f"  - {redact_failure_line(line)}", file=sys.stderr)
        return 1

    print("OK: every Secret reference honors secrets.existingSecret.")
    print(f"  runner token sources: {len(token_refs)} workload(s)")
    return 0


def test_existing_secret_is_honored() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0, "secrets.existingSecret is honored"


if __name__ == "__main__":
    raise SystemExit(main())
