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

NOTES.txt is not part of `helm template` output. `helm install --dry-run=client` does
render it, but Helm 3.18 still contacts the cluster there and fails with "Kubernetes
cluster unreachable" on a runner that has none. So the test copies the chart, moves
NOTES.txt into a named template, and renders that template as a JSON object with
`helm template --show-only`. The notes logic is the chart's own, unchanged.

Run: uv run hosting/kubernetes/helm/tests/test_notes_default_secrets.py
Requires the `helm` binary on PATH.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
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


NOTES_MANIFEST = "notes-test.yaml"

# A copy of the chart whose NOTES.txt is a named template, printed by an ordinary
# manifest as a JSON object (valid YAML), so `helm template` renders it. Built once; the
# chart on disk is not touched.
_workdir = tempfile.TemporaryDirectory()
NOTES_CHART_DIR = Path(_workdir.name) / "chart"
shutil.copytree(CHART_DIR, NOTES_CHART_DIR, ignore=shutil.ignore_patterns("tests"))
_templates = NOTES_CHART_DIR / "templates"
_notes = (_templates / "NOTES.txt").read_text()
(_templates / "NOTES.txt").unlink()
(_templates / "_notes-test.tpl").write_text(
    '{{- define "notes-test.notes" -}}' + _notes + "{{- end -}}"
)
(_templates / NOTES_MANIFEST).write_text(
    '{{ dict "notes" (include "notes-test.notes" .) | toJson }}'
)


def render_notes(extra_args: list[str]) -> str:
    result = subprocess.run(
        [
            "helm",
            "template",
            RELEASE,
            str(NOTES_CHART_DIR),
            "--show-only",
            f"templates/{NOTES_MANIFEST}",
            *URL_ARGS,
            *extra_args,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise AssertionError(
            f"helm template failed for args {extra_args}:\n{result.stderr}"
        )
    # Helm prints `---`, a `# Source:` comment, then the JSON object.
    lines = [
        ln
        for ln in result.stdout.splitlines()
        if ln and not ln.startswith(("---", "#"))
    ]
    return json.loads("\n".join(lines))["notes"]


def check(
    name: str, extra_args: list[str], *, expect_banner: bool, expect: str = ""
) -> bool:
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
