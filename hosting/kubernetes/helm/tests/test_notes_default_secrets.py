# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Rendered-NOTES guard for the "default secrets in use" banner.

The banner reads the chart's own `agenta.authKey`, `agenta.cryptKey` and
`postgres.password` values. With `secrets.existingSecret` the operator brings their own
Secret, the chart creates none, and those three values are never read by any workload.
The banner used to fire anyway, so every correctly configured production install was
told in capital letters that it ships `authKey = "replace-me"`. That is the case this
test pins.

NOTES.txt is not part of `helm template` output, and this chart cannot render it offline:
`agenta.validateRedisDurablePersistenceToggle` calls `lookup`, which makes helm build a real
client even for `--dry-run=client`. So this test has two modes and always runs one of them:

* with a reachable cluster (a developer machine), it renders the real notes through
  `helm install --dry-run=client` and asserts on the banner itself. That is the strong check.
* with no cluster (CI), it asserts on the template source instead: the banner's condition must
  still carry the `secrets.existingSecret` guard, and the banner must still name the three
  values. Weaker, but it pins the thing that regressed.

The mode is printed, so a run is never silently weaker than it looks.

Run: uv run hosting/kubernetes/helm/tests/test_notes_default_secrets.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

CHART_DIR = Path(__file__).resolve().parents[1]
RELEASE = "notes-test"
BANNER = "SECURITY WARNING"
EXISTING_SECRET = "my-agenta-secret"

# Public URLs are required by the chart's own validation, so every case sets them.
URL_ARGS = [
    "--set",
    "agenta.webUrl=https://agenta.example.com",
    "--set",
    "agenta.apiUrl=https://agenta.example.com/api",
    "--set",
    "agenta.servicesUrl=https://agenta.example.com/services",
]

# `agenta.validateSecrets` refuses to render while these four are still "replace-me", so
# a case that wants to reach the banner has to satisfy them first.
REAL_KEY_ARGS = [
    "--set",
    "agenta.authKey=0000000000000000000000000000000000000000000000000000000000000000",
    "--set",
    "agenta.cryptKey=1111111111111111111111111111111111111111111111111111111111111111",
    "--set",
    "agenta.servicesInternalKey=2222222222222222222222222222222222222222222222222222222222222222",
    "--set",
    "agenta.runnerToken=3333333333333333333333333333333333333333333333333333333333333333",
]

# The chart's agenta.validatePgauthSecret fails the render when only one of the two
# existing-Secret settings is given, so they always travel together.
EXISTING_SECRET_ARGS = [
    "--set",
    f"secrets.existingSecret={EXISTING_SECRET}",
    "--set",
    f"global.postgresql.auth.existingSecret={EXISTING_SECRET}",
]


NOTES_PATH = CHART_DIR / "templates" / "NOTES.txt"


def cluster_reachable() -> bool:
    """Whether helm can talk to a cluster, which `helm install --dry-run` needs here."""
    r = subprocess.run(
        ["helm", "list", "--max", "1"], capture_output=True, text=True, check=False
    )
    return r.returncode == 0


def check_source() -> int:
    """Offline mode: pin the guard in the template source. Returns the failure count."""
    text = NOTES_PATH.read_text()
    failures = 0

    def want(cond: bool, msg: str) -> None:
        nonlocal failures
        print(("  ok   " if cond else "  FAIL ") + msg)
        if not cond:
            failures += 1

    banner_line = next(
        (ln for ln in text.splitlines() if 'eq ($agenta.authKey | toString) "replace-me"' in ln),
        "",
    )
    want(bool(banner_line), "the banner condition is still in NOTES.txt")
    want(
        "not $secrets.existingSecret" in banner_line,
        "the banner condition still skips when the operator brings their own Secret",
    )
    for value in ("agenta.authKey", "agenta.cryptKey", "postgres.password"):
        want(value in text, f"the banner still names {value}")
    return failures


def render_notes(extra_args: list[str]) -> str:
    result = subprocess.run(
        [
            "helm",
            "install",
            RELEASE,
            str(CHART_DIR),
            "--dry-run=client",
            *URL_ARGS,
            *extra_args,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"helm install --dry-run failed for args {extra_args}:\n{result.stderr}"
        )
    return result.stdout


def check(name: str, extra_args: list[str], *, expect_banner: bool, expect: str = "") -> bool:
    notes = render_notes(extra_args)
    shown = BANNER in notes
    if shown != expect_banner:
        word = "expected the banner" if expect_banner else "expected NO banner"
        print(f"  FAIL {name}: {word}, got {'one' if shown else 'none'}")
        return False
    if expect and expect not in notes:
        print(f"  FAIL {name}: the banner does not name {expect!r}")
        return False
    print(f"  ok   {name}")
    return True


def main() -> int:
    if not cluster_reachable():
        print("  mode: no cluster reachable, asserting on the template source")
        failures = check_source()
        print(f"\n{5 - failures}/5 source checks passed")
        if failures:
            return 1
        print("OK: the banner still carries its existingSecret guard.")
        return 0

    print("  mode: cluster reachable, asserting on the rendered notes")
    results = [
        # The reachable real warning: the four required keys are set, but the bundled
        # PostgreSQL still runs on the default password.
        check(
            "default postgres password warns",
            REAL_KEY_ARGS,
            expect_banner=True,
            expect="postgres.password",
        ),
        # The regression this test exists for.
        check(
            "existingSecret silences the banner",
            EXISTING_SECRET_ARGS,
            expect_banner=False,
        ),
        # Setting real values alongside an existing Secret must not bring it back either.
        check(
            "existingSecret with real values stays silent",
            EXISTING_SECRET_ARGS + REAL_KEY_ARGS,
            expect_banner=False,
        ),
        # Nothing left at a default: no banner.
        check(
            "real values everywhere warn about nothing",
            REAL_KEY_ARGS + ["--set", "postgres.password=a-real-password"],
            expect_banner=False,
        ),
    ]
    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
