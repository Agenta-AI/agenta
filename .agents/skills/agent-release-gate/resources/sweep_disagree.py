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

TRIAGED EXCEPTIONS. Three line shapes are known SHADOW-COMPARATOR modeling gaps, not evictions:
the coordinator's behavior is correct and pinned by the runner's own tests, and only the shadow's
model of it disagrees (triage 2026-08-31, `f7-disagree-triage.md`; the comparator fixes are a
post-release follow-up). Without these exceptions the sweep fails on the runner's own expected
behavior on every window with real config traffic, and a check that cries wolf on healthy runs
stops being read.

The exceptions are never silent. Every excluded line is printed with the shape that explains it
and the triage marker, the excluded count is reported separately from the verdict, and a DISAGREE
line matching NO triaged shape still fails. Each shape is anchored on both halves of the line
(decision and plan), so it cannot swallow a real disagreement that merely shares a reason. Delete
a shape when its comparator fix lands; `--no-exceptions` fails on every DISAGREE line and is how
you prove a shape can go.

EXIT CODES
  0  PASS  -- no unexplained DISAGREE line in the window.
  1  FAIL  -- at least one line matched no triaged shape; the offending lines are printed.
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

#: Printed beside every excluded line. An exception a reader cannot trace is indistinguishable
#: from a bug being hidden, so the provenance travels with the line, every time.
TRIAGE_MARKER = "known comparator gap, triaged 2026-08-31, see f7-disagree-triage.md"

#: Shapes the 2026-08-31 triage proved are SHADOW-COMPARATOR modeling gaps, not evictions.
#:
#: In each one the coordinator's behavior is correct and pinned by the runner's own tests; only
#: the shadow's model of it disagrees. The comparator fixes are a post-release follow-up, so
#: without these exceptions the sweep fails on the runner's own expected behavior on every window
#: carrying real config traffic — and a check that cries wolf on healthy runs stops being read.
#:
#: Each entry is deliberately anchored on BOTH halves of the line, decision and plan. A shape that
#: matched on the decision alone would swallow real disagreements that happen to share a reason.
#: Delete an entry the moment its comparator fix lands; `--no-exceptions` is how you prove it has.
KNOWN_COMPARATOR_GAPS: tuple[tuple[str, str, "re.Pattern[str]"], ...] = (
    (
        "reopen-session-vs-config-rebuild",
        "the plan names a reopen, but a reopen reinstalls the OLD config, so the coordinator's "
        "rebuild is the only sound route (the 7x cluster)",
        re.compile(
            r"decision=rebuild\(mismatch:config\).*plan=reuse\(reopen-session\)"
        ),
    ),
    (
        "approval-mismatch-under-environment-scope",
        "the request carried no answer for the parked gate. That is a protocol fact, not an "
        "environment fact, and the shadow call site labels it `environment`",
        re.compile(
            r"decision=rebuild\(approval-mismatch:unknown\).*plan=reuse\(no-op\)"
        ),
    ),
    (
        "approval-resume-deferral",
        "the approval branch never compares the fingerprint, by design; the re-park keeps the "
        "old applied fingerprint, so the next idle turn rebuilds",
        re.compile(r"decision=reuse\(approval-resume\).*plan=rebuild\("),
    ),
)


def classify_disagree(line: str) -> tuple[str, str] | None:
    """The triaged shape this DISAGREE line matches, as `(name, why)`, or None when it is new."""
    for name, why, pattern in KNOWN_COMPARATOR_GAPS:
        if pattern.search(line):
            return name, why
    return None


def partition_known_gaps(
    lines: list[str], use_exceptions: bool = True
) -> tuple[list[tuple[str, str, str]], list[str]]:
    """Split DISAGREE lines into `(excluded, unexplained)`.

    `excluded` carries `(shape name, why, line)` so the caller can print each one with its
    provenance. `unexplained` is what fails the sweep: a DISAGREE line matching no triaged shape
    is exactly the drift this check exists to catch.
    """
    excluded: list[tuple[str, str, str]] = []
    unexplained: list[str] = []
    for line in lines:
        shape = classify_disagree(line) if use_exceptions else None
        if shape is None:
            unexplained.append(line)
        else:
            excluded.append((shape[0], shape[1], line))
    return excluded, unexplained


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
    p.add_argument(
        "--no-exceptions",
        action="store_true",
        help="fail on EVERY DISAGREE line, including the triaged comparator gaps. Run this once "
        "the comparator fixes land: a clean result is the proof that an exception can be deleted.",
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
    excluded, unexplained = partition_known_gaps(hits, not args.no_exceptions)

    # Print every exclusion, always, with the shape that explains it. The count alone would let a
    # growing cluster hide behind a number nobody reads.
    if excluded:
        print(
            f"{len(excluded)} DISAGREE line(s) excluded as {TRIAGE_MARKER}:",
        )
        for name, why, line in excluded:
            print(f"  [{name}] {line.strip()}")
            print(f"      why: {why}")

    if unexplained:
        print(
            f"FAIL: {len(unexplained)} unexplained reconciliation DISAGREE line(s) in "
            f"{container} since {args.since}. The coordinator and the router disagree on session "
            "identity in a shape no triage covers, which is the over-eviction signature."
        )
        for line in unexplained:
            print(f"  {line.strip()}")
        print(
            f"({len(excluded)} further line(s) excluded as known comparator gaps.)"
            if excluded
            else "(no line matched a known comparator gap.)"
        )
        return EXIT_FAIL

    print(
        f"PASS: no unexplained reconciliation DISAGREE line in {container} since {args.since} "
        f"({len(lines)} log lines scanned, {len(excluded)} known comparator gap(s) excluded)."
    )
    return EXIT_PASS


if __name__ == "__main__":
    sys.exit(main())
