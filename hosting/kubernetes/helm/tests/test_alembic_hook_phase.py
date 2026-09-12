# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart coverage for the migration Job in the pre phase.

With `alembic.hookPhase: pre` the migration Job runs as a pre-install hook,
before any regular release resource is applied. Anything the Job's pod names
must therefore exist already, or be a pre-install hook of its own with a lower
weight. The chart's ServiceAccount is a regular resource, so a Job that named it
was refused by Kubernetes ("serviceaccount agenta not found"), never started a
pod, and left `helm install` in pending-install.

That applies to the first install only. On an upgrade the ServiceAccount is
already there, and the Job names it, so the identity the operator configured on
it survives. These tests cover both renders.

Run: uv run hosting/kubernetes/helm/tests/test_alembic_hook_phase.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]
RELEASE = "alembic-chart-test"
# The release name does not contain the chart name, so agenta.fullname appends it.
FULLNAME = f"{RELEASE}-agenta"
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

# The pre phase is for an external database. The bundled PostgreSQL does not
# exist at pre-install time either, which is why the chart defaults to post.
EXTERNAL_DB = [
    "--set",
    "postgresql.enabled=false",
    "--set",
    "postgresql.external.host=postgres.example.com",
]
PRE = ["--set", "alembic.hookPhase=pre"]

PRE_EVENTS = {"pre-install", "pre-upgrade"}


def render(extra_args: list[str] | None = None, is_upgrade: bool = False) -> list[dict]:
    """Render the chart. `is_upgrade` renders it the way `helm upgrade` would.

    `helm template` renders an install unless told otherwise, so a template that
    reads .Release.IsInstall or .Release.IsUpgrade needs both renders to be
    covered.
    """
    result = subprocess.run(
        [
            "helm",
            "template",
            RELEASE,
            str(CHART_DIR),
            *BASE_ARGS,
            *(["--is-upgrade"] if is_upgrade else []),
            *(extra_args or []),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return [doc for doc in yaml.safe_load_all(result.stdout) if doc]


def annotations(doc: dict) -> dict:
    return doc.get("metadata", {}).get("annotations") or {}


def hook_events(doc: dict) -> set[str]:
    raw = annotations(doc).get("helm.sh/hook", "")
    return {event.strip() for event in raw.split(",") if event.strip()}


def hook_weight(doc: dict) -> int:
    return int(annotations(doc).get("helm.sh/hook-weight", "0"))


def migration_job(docs: list[dict]) -> dict:
    jobs = [
        doc
        for doc in docs
        if doc.get("kind") == "Job"
        and doc["metadata"]["labels"].get("app.kubernetes.io/component") == "alembic"
    ]
    assert len(jobs) == 1, jobs
    return jobs[0]


def pod_spec(workload: dict) -> dict:
    return workload["spec"]["template"]["spec"]


def named_resources(docs: list[dict], kind: str) -> dict[str, dict]:
    """Every object of `kind` the chart renders, keyed by name."""
    return {doc["metadata"]["name"]: doc for doc in docs if doc.get("kind") == kind}


def pod_references(spec: dict) -> set[tuple[str, str]]:
    """(kind, name) pairs the pod needs to exist before it can start."""
    refs: set[tuple[str, str]] = set()
    if spec.get("serviceAccountName"):
        refs.add(("ServiceAccount", spec["serviceAccountName"]))
    for container in spec.get("initContainers", []) + spec.get("containers", []):
        for entry in container.get("env", []):
            source = entry.get("valueFrom") or {}
            if "secretKeyRef" in source:
                refs.add(("Secret", source["secretKeyRef"]["name"]))
            if "configMapKeyRef" in source:
                refs.add(("ConfigMap", source["configMapKeyRef"]["name"]))
        for entry in container.get("envFrom", []):
            if "secretRef" in entry:
                refs.add(("Secret", entry["secretRef"]["name"]))
            if "configMapRef" in entry:
                refs.add(("ConfigMap", entry["configMapRef"]["name"]))
    for volume in spec.get("volumes", []):
        if "secret" in volume:
            refs.add(("Secret", volume["secret"]["secretName"]))
        if "configMap" in volume:
            refs.add(("ConfigMap", volume["configMap"]["name"]))
    return refs


def main() -> int:
    # --- The default phase keeps the release's own ServiceAccount. ---
    post_docs = render()
    post_job = migration_job(post_docs)
    assert hook_events(post_job) == {"post-install", "post-upgrade"}
    assert pod_spec(post_job)["serviceAccountName"] == FULLNAME
    service_account = named_resources(post_docs, "ServiceAccount")[FULLNAME]
    assert hook_events(service_account) == set(), (
        "the ServiceAccount is a regular resource, not a hook"
    )

    # --- In the pre phase the Job names no ServiceAccount and mounts no token. ---
    pre_docs = render(EXTERNAL_DB + PRE)
    pre_job = migration_job(pre_docs)
    assert hook_events(pre_job) == {"pre-install", "pre-upgrade"}
    pre_spec = pod_spec(pre_job)
    assert "serviceAccountName" not in pre_spec, pre_spec.get("serviceAccountName")
    assert pre_spec["automountServiceAccountToken"] is False

    # --- Everything the pre-install Job names can exist before it runs. ---
    # A regular resource is applied after the pre-install hooks, so naming one
    # would keep the pod from ever starting. A hook resource works only if it
    # runs on a pre event at a lower weight.
    job_weight = hook_weight(pre_job)
    for kind, name in pod_references(pre_spec):
        rendered = named_resources(pre_docs, kind).get(name)
        if rendered is None:
            # Not part of the release: the operator created it beforehand.
            continue
        events = hook_events(rendered)
        # Both events, not either one. The Job runs on pre-install AND on
        # pre-upgrade, so a dependency that covers only one of them is missing
        # on the other.
        assert PRE_EVENTS <= events, (
            f"{kind}/{name} runs on {sorted(events) or 'no hook event'}, "
            f"so it is applied after the Job on {sorted(PRE_EVENTS - events)}"
        )
        assert hook_weight(rendered) < job_weight, (
            f"{kind}/{name} has hook weight {hook_weight(rendered)}, "
            f"which does not run before the Job's {job_weight}"
        )

    # The Secret holding POSTGRES_PASSWORD is the reference that matters, so
    # check the loop above actually saw it.
    assert ("Secret", FULLNAME) in pod_references(pre_spec)

    # --- An upgrade names the ServiceAccount again: the install created it. ---
    # Dropping the name here would drop the identity the operator put on that
    # ServiceAccount, such as the GKE workload identity annotation that reaches
    # Cloud SQL, on every upgrade of a release that was installed fine.
    upgrade_job = migration_job(render(EXTERNAL_DB + PRE, is_upgrade=True))
    upgrade_spec = pod_spec(upgrade_job)
    assert hook_events(upgrade_job) == {"pre-install", "pre-upgrade"}
    assert upgrade_spec["serviceAccountName"] == FULLNAME, upgrade_spec
    assert "automountServiceAccountToken" not in upgrade_spec

    # --- An operator-supplied ServiceAccount exists already, so keep naming it. ---
    EXTERNAL_SA = [
        "--set",
        "serviceAccount.create=false",
        "--set",
        "serviceAccount.name=migration-runner",
    ]
    for is_upgrade in (False, True):
        external_sa_docs = render(EXTERNAL_DB + PRE + EXTERNAL_SA, is_upgrade=is_upgrade)
        external_sa_job = migration_job(external_sa_docs)
        # create=false means the chart renders NO ServiceAccount, under any
        # name. Checking only for FULLNAME would pass a chart that created
        # `migration-runner` itself, which is the object the operator owns.
        rendered_sas = named_resources(external_sa_docs, "ServiceAccount")
        assert rendered_sas == {}, (
            f"serviceAccount.create=false still rendered {sorted(rendered_sas)} "
            f"(is_upgrade={is_upgrade})"
        )
        assert pod_spec(external_sa_job)["serviceAccountName"] == "migration-runner"
        assert "automountServiceAccountToken" not in pod_spec(external_sa_job)

    # --- The other workloads keep the ServiceAccount in both phases. ---
    for docs in (post_docs, pre_docs):
        api = next(
            doc
            for doc in docs
            if doc.get("kind") == "Deployment"
            and doc["metadata"]["labels"].get("app.kubernetes.io/component") == "api"
        )
        assert pod_spec(api)["serviceAccountName"] == FULLNAME

    print("OK: the pre-phase migration Job can start on a fresh install.")
    return 0


def test_pre_phase_migration_job_can_start() -> None:
    """pytest entry point. The module also runs standalone; both call main()."""
    assert main() == 0, "the pre-phase migration Job can start on a fresh install"


if __name__ == "__main__":
    raise SystemExit(main())
