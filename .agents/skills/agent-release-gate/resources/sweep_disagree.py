# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///
"""Sweep the runner log for reconciliation DISAGREE lines. Run AFTER a gate session.

WHAT IT PINS. The runner holds two views of a session's identity: the coordinator's
`configFingerprint` decision, and the reconciliation router's per-facet digests. When those two
views drift apart, a request that should reuse a warm sandbox instead cold-evicts it. That is the
over-eviction family fixed in v0.114.4, and it is invisible from the wire: the turn still
succeeds, it just paid for a rebuild it did not need. The only product of the drift is a log line,
so the only way to catch a regression is to grep for it.

THE LINE. `logReconcileShadow` in `services/runner/src/lifecycle/reconciliation-router.ts` writes
one line per decision through `defaultLog`, which prefixes `[reconcile] `:

  [reconcile] shadow key=<key> harness=<kind> decision=<d>(<reason>) plan=<outcome>(<action>) \
DISAGREE facets=[<facet list>]

The marker field is `agree` when the two views match, `n/a(continuity)` for a conversation-scope
decision (deliberately excluded -- it answers a different question than the environment plan), and
the bare token `DISAGREE` when they do not. This sweep counts the DISAGREE token only.

A DISAGREE line never fails a turn by design: the shadow must never break a run. That is exactly
why it needs a sweep. One hit is a real finding.

EXIT CODES
  0  PASS  -- no DISAGREE line in the window.
  1  FAIL  -- at least one hit; the offending lines are printed.
  2  SKIP  -- the runner log is not reachable (a remote deployment, or no docker). A SKIP prints
              its reason and counts as a failure to explain, never as a green result.

  uv run sweep_disagree.py --since 2026-08-31T09:00:00
  uv run sweep_disagree.py --since 30m --container agenta-ee-dev-preview-runner-1
"""

import argparse
import os
import re
import subprocess
import sys

EXIT_PASS = 0
EXIT_FAIL = 1
EXIT_SKIP = 2

#: The marker written by `logReconcileShadow`. Both halves are required: `shadow ` keeps the sweep
#: off unrelated `[reconcile]` lines, and the padded ` DISAGREE ` token cannot match the word
#: DISAGREEMENTS that appears in the router's own source comments.
DISAGREE_LINE = re.compile(r"\[reconcile\] shadow .*\sDISAGREE\s")


def base_is_local() -> bool:
    base = os.environ.get("AGENTA_BASE", "")
    return any(h in base for h in ("localhost", "127.0.0.1", "0.0.0.0"))


def autodetect_runner() -> tuple[str | None, str]:
    """The runner container of the local stack, or `(None, why)` when docker cannot answer."""
    try:
        out = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as e:
        return None, f"`docker ps` failed: {e}"
    if out.returncode != 0:
        return None, f"`docker ps` exited {out.returncode}: {out.stderr.strip()[:200]}"
    names = [n.strip() for n in out.stdout.splitlines() if n.strip()]
    hits = [n for n in names if "runner" in n.lower()]
    if not hits:
        return None, "no container with `runner` in its name is running"
    if len(hits) > 1:
        return (
            None,
            f"several runner containers are running ({', '.join(hits)}); pass --container",
        )
    return hits[0], ""


def log_lines(container: str, since: str) -> tuple[list[str] | None, str]:
    try:
        out = subprocess.run(
            ["docker", "logs", container, "--since", since],
            capture_output=True,
            text=True,
            timeout=60,
        )
    except (OSError, subprocess.SubprocessError) as e:
        return None, f"`docker logs {container}` failed: {e}"
    if out.returncode != 0:
        return (
            None,
            f"`docker logs {container}` exited {out.returncode}: {out.stderr.strip()[:200]}",
        )
    return (out.stdout + out.stderr).splitlines(), ""


def main() -> int:
    p = argparse.ArgumentParser(
        description="Fail when the runner logged a reconciliation DISAGREE since a timestamp."
    )
    p.add_argument(
        "--since",
        required=True,
        help="start of the window: an ISO timestamp (2026-08-31T09:00:00) or a docker "
        "duration (30m). Use the timestamp the gate session started.",
    )
    p.add_argument(
        "--container",
        default=None,
        help="runner container name. Default: autodetect the local stack's runner via `docker ps`.",
    )
    args = p.parse_args()

    if not base_is_local():
        base = os.environ.get("AGENTA_BASE", "<unset>")
        print(
            f"SKIP: the runner log is not reachable. AGENTA_BASE={base} is not a local "
            "deployment, so this host has no docker socket for its runner. Read the log through "
            "the operator channel for that deployment and grep for `[reconcile] shadow` lines "
            "carrying the DISAGREE token.",
            file=sys.stderr,
        )
        return EXIT_SKIP

    container = args.container
    if container is None:
        container, why = autodetect_runner()
        if container is None:
            print(f"SKIP: cannot find the runner container: {why}", file=sys.stderr)
            return EXIT_SKIP

    lines, why = log_lines(container, args.since)
    if lines is None:
        print(f"SKIP: cannot read the runner log: {why}", file=sys.stderr)
        return EXIT_SKIP

    hits = [ln for ln in lines if DISAGREE_LINE.search(ln)]
    if hits:
        print(
            f"FAIL: {len(hits)} reconciliation DISAGREE line(s) in {container} since "
            f"{args.since}. The coordinator and the router disagree on session identity, which "
            "is the over-eviction signature."
        )
        for ln in hits:
            print(f"  {ln.strip()}")
        return EXIT_FAIL

    print(
        f"PASS: no reconciliation DISAGREE line in {container} since {args.since} "
        f"({len(lines)} log lines scanned)."
    )
    return EXIT_PASS


if __name__ == "__main__":
    sys.exit(main())
