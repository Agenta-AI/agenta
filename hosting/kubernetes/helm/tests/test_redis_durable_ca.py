# /// script
# requires-python = ">=3.11"
# dependencies = ["PyYAML>=6"]
# ///
"""Rendered-chart guard for the external durable Redis certificate authority.

A managed Redis service presents a certificate signed by its own authority, not by a
public root, so `rediss://` fails with CERTIFICATE_VERIFY_FAILED until the client is given
that authority. `redisDurable.external.caCert` makes the chart mount it, so the connection
string can point at a file with `?ssl_ca_certs=` rather than turn verification off.

What this pins:

* the mount and the volume land on exactly the workloads that read `REDIS_URI_DURABLE`,
  and on nothing else. A missing mount is a pod that cannot reach the queue at all; a mount
  on the web pod is a certificate handed to a workload with no reason to hold it.
* the chart writes the PEM into its own Secret only when it creates that Secret.
* `redisVolatile.external.caCert` fails the render instead of being ignored. The values
  schema shares one definition between the two Redis blocks, so it is accepted there, and
  a silent no-op would look exactly like a working configuration.

Run: uv run hosting/kubernetes/helm/tests/test_redis_durable_ca.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import yaml

CHART_DIR = Path(__file__).resolve().parents[1]
RELEASE = "ca-test"
VOLUME = "redis-durable-ca"
MOUNT_DIR = "/etc/agenta/redis-durable"
CA_KEY = "REDIS_DURABLE_CA_CERT"
EXISTING_SECRET = "my-agenta-secret"

# The workloads that read REDIS_URI_DURABLE, so the ones that need the authority.
WANT = {
    f"Deployment/{RELEASE}-agenta-api",
    f"Deployment/{RELEASE}-agenta-services",
    f"Deployment/{RELEASE}-agenta-cron",
    f"Deployment/{RELEASE}-agenta-worker-streams",
    f"Deployment/{RELEASE}-agenta-worker-queues",
    f"Job/{RELEASE}-agenta-alembic",
}

URL_ARGS = [
    "--set", "agenta.webUrl=https://agenta.example.com",
    "--set", "agenta.apiUrl=https://agenta.example.com/api",
    "--set", "agenta.servicesUrl=https://agenta.example.com/services",
]

KEY_ARGS = [
    "--set", "agenta.authKey=0000000000000000000000000000000000000000000000000000000000000000",
    "--set", "agenta.cryptKey=1111111111111111111111111111111111111111111111111111111111111111",
    "--set", "agenta.servicesInternalKey=2222222222222222222222222222222222222222222222222222222222222222",
    "--set", "agenta.runnerToken=3333333333333333333333333333333333333333333333333333333333333333",
    "--set", "postgres.password=a-real-password",
]

PEM = "-----BEGIN CERTIFICATE-----\nTESTONLY\n-----END CERTIFICATE-----\n"

EXTERNAL_ARGS = [
    "--set", "redisDurable.enabled=false",
    "--set", "redisDurable.password=from-existing-secret",
    "--set",
    "redisDurable.external.uri=rediss://:$(REDIS_DURABLE_PASSWORD)@10.0.0.1:6378/0"
    f"?ssl_ca_certs={MOUNT_DIR}/ca.pem",
]


def render(extra: list[str]) -> tuple[int, str]:
    result = subprocess.run(
        ["helm", "template", RELEASE, str(CHART_DIR), *URL_ARGS, *extra],
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, (result.stdout if result.returncode == 0 else result.stderr)


def docs(text: str) -> list[dict]:
    return [d for d in yaml.safe_load_all(text) if d]


def carriers(parsed: list[dict]) -> tuple[set[str], set[str]]:
    """Workloads whose pod spec has the volume, and whose containers have the mount."""
    with_volume: set[str] = set()
    with_mount: set[str] = set()
    for d in parsed:
        kind = d.get("kind")
        if kind not in ("Deployment", "Job", "StatefulSet"):
            continue
        ref = f"{kind}/{d['metadata']['name']}"
        spec = d["spec"]["template"]["spec"]
        if any(v.get("name") == VOLUME for v in spec.get("volumes") or []):
            with_volume.add(ref)
        for c in spec.get("containers") or []:
            for m in c.get("volumeMounts") or []:
                if m.get("name") == VOLUME:
                    with_mount.add(ref)
                    if m.get("mountPath") != MOUNT_DIR:
                        raise AssertionError(f"{ref} mounts at {m.get('mountPath')}, want {MOUNT_DIR}")
                    if not m.get("readOnly"):
                        raise AssertionError(f"{ref} mounts the certificate writable")
    return with_volume, with_mount


def chart_secret_keys(parsed: list[dict]) -> set[str]:
    for d in parsed:
        if d.get("kind") == "Secret" and d["metadata"]["name"] == f"{RELEASE}-agenta":
            return set((d.get("stringData") or {}).keys())
    return set()


def main() -> int:
    failures: list[str] = []
    total = 0

    def check(cond: bool, msg: str) -> None:
        nonlocal total
        total += 1
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            failures.append(msg)

    # --- the bundled durable Redis mounts nothing -----------------------------
    code, out = render(KEY_ARGS)
    assert code == 0, out
    parsed = docs(out)
    vols, mounts = carriers(parsed)
    check(not vols and not mounts, "bundled durable Redis mounts no certificate")
    check(CA_KEY not in chart_secret_keys(parsed), "bundled durable Redis writes no certificate key")

    # --- external with the PEM inline ----------------------------------------
    code, out = render(KEY_ARGS + EXTERNAL_ARGS + ["--set-string", f"redisDurable.external.caCert={PEM}"])
    assert code == 0, out
    parsed = docs(out)
    vols, mounts = carriers(parsed)
    check(vols == WANT, f"the volume lands on exactly the durable-Redis workloads (got {sorted(vols - WANT) or 'no extras'}, missing {sorted(WANT - vols) or 'none'})")
    check(mounts == WANT, f"the mount lands on exactly the same workloads (got {sorted(mounts - WANT) or 'no extras'}, missing {sorted(WANT - mounts) or 'none'})")
    check(CA_KEY in chart_secret_keys(parsed), "the chart Secret carries the certificate when the chart owns it")

    # --- external, certificate supplied through an existing Secret -----------
    code, out = render(
        EXTERNAL_ARGS
        + [
            "--set", f"secrets.existingSecret={EXISTING_SECRET}",
            "--set", f"global.postgresql.auth.existingSecret={EXISTING_SECRET}",
            "--set", "redisDurable.external.caCert=from-existing-secret",
        ]
    )
    assert code == 0, out
    parsed = docs(out)
    vols, mounts = carriers(parsed)
    check(vols == WANT and mounts == WANT, "an existing Secret still mounts on every durable-Redis workload")
    check(not chart_secret_keys(parsed), "the chart writes no Secret of its own when one is supplied")

    # --- the unimplemented case fails loudly ---------------------------------
    code, out = render(KEY_ARGS + ["--set-string", f"redisVolatile.external.caCert={PEM}"])
    check(code != 0 and "not implemented" in out, "a certificate on the cache Redis fails the render")

    # --- the two combinations that could never mount -------------------------
    # The volume names REDIS_DURABLE_CA_CERT explicitly, and Kubernetes refuses to mount a
    # Secret volume whose named key is absent. Both of these would render happily and then
    # leave every durable-Redis workload unable to start, so they must fail at render time.
    code, out = render(KEY_ARGS + EXTERNAL_ARGS + ["--set", "redisDurable.external.caCert=from-existing-secret"])
    check(
        code != 0 and "from-existing-secret" in out and "secrets.existingSecret is not set" in out,
        "the placeholder without an existing Secret fails the render",
    )

    code, out = render(
        EXTERNAL_ARGS
        + [
            "--set", f"secrets.existingSecret={EXISTING_SECRET}",
            "--set", f"global.postgresql.auth.existingSecret={EXISTING_SECRET}",
            "--set-string", f"redisDurable.external.caCert={PEM}",
        ]
    )
    check(
        code != 0 and "is set" in out and "never written anywhere" in out,
        "an inline certificate alongside an existing Secret fails the render",
    )

    print(f"\n{total - len(failures)}/{total} checks passed")
    if failures:
        return 1
    print("OK: the durable-Redis certificate mounts where it is needed and nowhere else.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
