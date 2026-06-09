"""
Representative matrix for run-flag derivation (`create_run_flags`) and simple-queue
validation (`SimpleQueueData.validate_sources`).

One row per equivalence class rather than the full cartesian product: each source
family once, each evaluator-origin class once, each independent flag toggled once.
Pure unit tests — no DB, no worker.

Companion to `test_run_flags.py` (which covers cache/split preservation and the
direct-vs-backed source distinction); this file focuses on the broader has_*/origin
matrix and the queue "at least one human evaluator" rule.
"""

from uuid import uuid4

import pytest
from pydantic import ValidationError

from oss.src.core.evaluations.types import (
    EvaluationRun,
    EvaluationRunData,
    EvaluationRunDataStep,
    EvaluationRunFlags,
    SimpleQueueData,
    SimpleQueueKind,
)
from oss.src.dbs.postgres.evaluations.utils import create_run_flags


# - helpers -------------------------------------------------------------------


def _input_step(key, references=None, origin="custom"):
    return EvaluationRunDataStep(
        key=key, type="input", origin=origin, references=references or {}
    )


def _annotation_step(origin, key=None):
    return EvaluationRunDataStep(
        key=key or f"annotation-{origin}",
        type="annotation",
        origin=origin,
        references={"evaluator_revision": {"id": str(uuid4())}},
    )


def _run(steps, flags=None):
    return EvaluationRun(
        flags=flags or EvaluationRunFlags(),
        data=EvaluationRunData(steps=steps),
    )


# - source family matrix ------------------------------------------------------
# Each row: (label, input steps, expected source has_* flags)

_QUERY_REF = {"query_revision": {"id": str(uuid4())}}
_TESTSET_REF = {"testset_revision": {"id": str(uuid4())}}

SOURCE_ROWS = [
    # label              steps                                            expected (queries, testsets, traces, testcases)
    ("queries", [_input_step("q", _QUERY_REF)], (True, False, False, False)),
    ("testsets", [_input_step("t", _TESTSET_REF)], (False, True, False, False)),
    ("traces-direct", [_input_step("traces", {})], (False, False, True, False)),
    ("testcases-direct", [_input_step("testcases", {})], (False, False, False, True)),
    (
        "multi-input-query+testset",
        [_input_step("q", _QUERY_REF), _input_step("t", _TESTSET_REF)],
        (True, True, False, False),
    ),
    ("none", [], (False, False, False, False)),
]


@pytest.mark.parametrize(
    "label,steps,expected",
    SOURCE_ROWS,
    ids=[r[0] for r in SOURCE_ROWS],
)
def test_source_family_flag_derivation(label, steps, expected):
    flags = create_run_flags(_run(steps))
    assert flags is not None
    want_q, want_t, want_tr, want_tc = expected
    assert flags.has_queries is want_q
    assert flags.has_testsets is want_t
    assert flags.has_traces is want_tr
    assert flags.has_testcases is want_tc


# - evaluator origin matrix ---------------------------------------------------
# Each row: (label, annotation origins, expected (has_evaluators, has_human, has_auto, has_custom))

ORIGIN_ROWS = [
    ("none", [], (False, False, False, False)),
    ("human", ["human"], (True, True, False, False)),
    ("auto", ["auto"], (True, False, True, False)),
    ("custom", ["custom"], (True, False, False, True)),
    ("human+auto", ["human", "auto"], (True, True, True, False)),
    ("human+custom", ["human", "custom"], (True, True, False, True)),
    ("auto+custom", ["auto", "custom"], (True, False, True, True)),
    ("all", ["human", "auto", "custom"], (True, True, True, True)),
]


@pytest.mark.parametrize(
    "label,origins,expected",
    ORIGIN_ROWS,
    ids=[r[0] for r in ORIGIN_ROWS],
)
def test_evaluator_origin_flag_derivation(label, origins, expected):
    steps = [_input_step("t", _TESTSET_REF)] + [
        _annotation_step(o, key=f"annotation-{i}") for i, o in enumerate(origins)
    ]
    flags = create_run_flags(_run(steps))
    assert flags is not None
    want_eval, want_human, want_auto, want_custom = expected
    assert flags.has_evaluators is want_eval
    assert flags.has_human is want_human
    assert flags.has_auto is want_auto
    assert flags.has_custom is want_custom


# - independent flag preservation ---------------------------------------------
# is_live / is_cached / is_split are explicit flags, preserved across derivation.


@pytest.mark.parametrize("flag_name", ["is_live", "is_cached", "is_split"])
def test_explicit_flags_preserved_through_derivation(flag_name):
    flags_in = EvaluationRunFlags(**{flag_name: True})
    steps = [_input_step("t", _TESTSET_REF), _annotation_step("auto")]
    flags = create_run_flags(_run(steps, flags=flags_in))
    assert flags is not None
    assert getattr(flags, flag_name) is True


# - simple-queue evaluator validation -----------------------------------------
# Rule: a simple queue must resolve to >=1 human evaluator. A bare list is
# origin-less (defaults to human) -> always valid. An explicit dict is valid only
# if at least one value is "human"; a dict of only non-human origins is rejected.

_E1 = uuid4()
_E2 = uuid4()


def _queue_data(evaluators):
    return SimpleQueueData(kind=SimpleQueueKind.TESTCASES, evaluators=evaluators)


def test_bare_evaluator_list_is_valid():
    data = _queue_data([_E1, _E2])
    assert data.evaluators == [_E1, _E2]


@pytest.mark.parametrize(
    "evaluators,ok",
    [
        ({_E1: "human"}, True),
        ({_E1: "human", _E2: "auto"}, True),
        ({_E1: "human", _E2: "custom"}, True),
        ({_E1: "auto"}, False),
        ({_E1: "custom"}, False),
        ({_E1: "auto", _E2: "custom"}, False),
    ],
    ids=[
        "human",
        "human+auto",
        "human+custom",
        "all-auto",
        "all-custom",
        "auto+custom",
    ],
)
def test_simple_queue_human_evaluator_rule(evaluators, ok):
    if ok:
        data = _queue_data(evaluators)
        assert data.evaluators == evaluators
    else:
        with pytest.raises(ValidationError):
            _queue_data(evaluators)
