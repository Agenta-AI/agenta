"""Unit test for the sweep's triaged comparator-gap exceptions (run: `pytest
test_sweep_disagree_exceptions.py`).

The tension this pins: `sweep_disagree.py` exists to fail on identity drift, and every exception
added to it is a place a real regression could hide. The 2026-08-31 triage found all 9 DISAGREE
lines were shadow-comparator modeling gaps — the coordinator is correct and pinned; only the
shadow's model of it disagrees — so without exceptions the sweep fails on the runner's own
expected behavior on every loaded window, and a check that cries wolf stops being read.

So the exceptions have to be narrow in BOTH directions, and that is what these tests hold:

  - each triaged shape is excluded, and the excluded line is still PRINTED with its shape name
    and the triage marker (an exception a reader cannot trace is indistinguishable from a bug
    being hidden);
  - a DISAGREE line matching no triaged shape still FAILS;
  - a mixed window reports both counts, so an exclusion can never mask a real hit;
  - each shape is anchored on BOTH halves of the line, so it cannot swallow a real disagreement
    that merely shares a decision reason.

The lines below are the real shapes from the triage, in the exact format `logReconcileShadow`
writes.
"""

import importlib
import sys
from pathlib import Path

import pytest


def _sweep():
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    sys.modules.pop("sweep_disagree", None)
    return importlib.import_module("sweep_disagree")


def line(decision: str, plan: str, facets: str = "harnessSession") -> str:
    return (
        f"[reconcile] shadow key=proj:sess harness=claude decision={decision} "
        f"plan={plan} DISAGREE facets=[{facets}]"
    )


# The three triaged shapes, as they really appear.
CLUSTER_7X = line("rebuild(mismatch:config)", "reuse(reopen-session)")
APPROVAL_MISMATCH = line("rebuild(approval-mismatch:unknown)", "reuse(no-op)", "none")
APPROVAL_RESUME = line(
    "reuse(approval-resume)", "rebuild(rebuild-sandbox)", "workspaceFiles"
)

# Something no triage covers: this must always fail.
NOVEL = line("rebuild(mismatch:credentials)", "reuse(no-op)", "modelCredential")


@pytest.mark.parametrize(
    "raw,expected_shape",
    [
        (CLUSTER_7X, "reopen-session-vs-config-rebuild"),
        (APPROVAL_MISMATCH, "approval-mismatch-under-environment-scope"),
        (APPROVAL_RESUME, "approval-resume-deferral"),
    ],
)
def test_each_triaged_shape_is_recognized(raw, expected_shape):
    m = _sweep()
    shape = m.classify_disagree(raw)
    assert shape is not None
    assert shape[0] == expected_shape
    assert shape[1], "every shape must carry a why, for the printed line"


@pytest.mark.parametrize("raw", [CLUSTER_7X, APPROVAL_MISMATCH, APPROVAL_RESUME])
def test_a_triaged_shape_is_excluded_but_still_carried(raw):
    """Excluded, never dropped: the line comes back so the caller can print it."""
    m = _sweep()
    excluded, unexplained = m.partition_known_gaps([raw])
    assert unexplained == []
    assert len(excluded) == 1
    name, why, carried = excluded[0]
    assert carried == raw
    assert name and why


def test_an_unlisted_shape_still_fails():
    m = _sweep()
    excluded, unexplained = m.partition_known_gaps([NOVEL])
    assert excluded == []
    assert unexplained == [NOVEL]


def test_a_mixed_window_reports_both_counts():
    m = _sweep()
    window = [CLUSTER_7X, NOVEL, APPROVAL_RESUME, CLUSTER_7X]
    excluded, unexplained = m.partition_known_gaps(window)
    assert len(excluded) == 3
    assert unexplained == [NOVEL]


def test_no_exceptions_fails_on_everything():
    """The flag that proves a shape can be deleted once its comparator fix lands."""
    m = _sweep()
    window = [CLUSTER_7X, APPROVAL_MISMATCH, APPROVAL_RESUME]
    excluded, unexplained = m.partition_known_gaps(window, use_exceptions=False)
    assert excluded == []
    assert unexplained == window


class TestShapesAreAnchoredOnBothHalves:
    """A shape keyed on the decision alone would swallow real disagreements sharing a reason."""

    def test_config_rebuild_against_a_different_plan_is_not_excluded(self):
        m = _sweep()
        # Same decision as the 7x cluster, but the plan wanted a full rebuild-sandbox. That is a
        # genuine disagreement about the ROUTE and must not be waved through.
        assert (
            m.classify_disagree(
                line("rebuild(mismatch:config)", "rebuild(rebuild-sandbox)")
            )
            is None
        )

    def test_reopen_plan_against_a_different_decision_is_not_excluded(self):
        m = _sweep()
        assert (
            m.classify_disagree(line("reuse(hit-continue)", "reuse(reopen-session)"))
            is None
        )

    def test_a_different_approval_mismatch_reason_is_not_excluded(self):
        m = _sweep()
        assert (
            m.classify_disagree(
                line("rebuild(approval-mismatch:stale)", "reuse(no-op)")
            )
            is None
        )

    def test_approval_resume_against_a_reuse_plan_is_not_excluded(self):
        m = _sweep()
        # The triaged shape is the resume deferral, where the plan wanted a REBUILD. An
        # approval-resume that disagrees toward reuse is something else entirely.
        assert (
            m.classify_disagree(line("reuse(approval-resume)", "reuse(no-op)")) is None
        )


def test_the_triage_marker_names_its_source():
    # The provenance travels with every excluded line; a bare "known issue" would be unfalsifiable.
    m = _sweep()
    assert "f7-disagree-triage.md" in m.TRIAGE_MARKER
    assert "2026-08-31" in m.TRIAGE_MARKER


def test_an_agree_line_is_never_a_hit_in_the_first_place():
    m = _sweep()
    agree = (
        "[reconcile] shadow key=proj:sess harness=claude decision=reuse(hit-continue) "
        "plan=reuse(no-op) agree facets=[]"
    )
    assert not m.DISAGREE_LINE.search(agree)
