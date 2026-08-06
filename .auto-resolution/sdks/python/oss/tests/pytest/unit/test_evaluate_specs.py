"""
Unit tests for the evaluate() spec parsing/normalization layer.

These cover the pure, API-free internals of `agenta.sdk.evaluations.preview.evaluate`:

  - `_parse_evaluate_kwargs`: merges kwargs with `specs`, applies kwargs-win
    precedence, carries `repeats`, and validates the three required step groups.
  - `_normalize_step_id`: coerces UUID-compatible ids to canonical str, drops
    invalid ones.
  - `_normalize_target_steps`: builds {step_id: origin}, rejecting invalid ids
    and non-{custom,human,auto} origins.

`_parse_evaluate_kwargs` is async but does no I/O, so it runs via asyncio.run.
"""

import asyncio
from uuid import uuid4

import pytest

from agenta.sdk.evaluations.preview.evaluate import (
    EvaluateSpecs,
    _normalize_step_id,
    _normalize_target_steps,
    _parse_evaluate_kwargs,
)


def run(coro):
    return asyncio.run(coro)


def _str_keys(steps):
    # Target = Dict[UUID, Origin] coerces string keys to UUID objects; compare by
    # canonical string so the assertions are independent of key representation.
    return {str(k): v for k, v in (steps or {}).items()}


# --- _normalize_step_id ----------------------------------------------------


def test_normalize_step_id_passes_through_uuid_object():
    u = uuid4()
    assert _normalize_step_id(u) == str(u)


def test_normalize_step_id_canonicalizes_uuid_string():
    u = uuid4()
    assert _normalize_step_id(str(u)) == str(u)


def test_normalize_step_id_returns_none_for_none():
    assert _normalize_step_id(None) is None


def test_normalize_step_id_returns_none_for_invalid():
    assert _normalize_step_id("not-a-uuid") is None


# --- _normalize_target_steps ----------------------------------------------


def test_normalize_target_steps_keeps_valid_entries():
    a, b = uuid4(), uuid4()
    steps = {str(a): "human", str(b): "auto"}
    out = _normalize_target_steps(steps=steps, step_name="evaluators")
    assert out == {str(a): "human", str(b): "auto"}


def test_normalize_target_steps_rejects_invalid_id():
    with pytest.raises(ValueError, match="invalid"):
        _normalize_target_steps(steps={"not-a-uuid": "auto"}, step_name="evaluators")


def test_normalize_target_steps_rejects_invalid_origin():
    with pytest.raises(ValueError, match="invalid"):
        _normalize_target_steps(steps={str(uuid4()): "robot"}, step_name="evaluators")


def test_normalize_target_steps_rejects_empty():
    with pytest.raises(ValueError, match="missing or invalid"):
        _normalize_target_steps(steps={}, step_name="evaluators")


def test_normalize_target_steps_rejects_non_dict():
    with pytest.raises(ValueError, match="missing or invalid"):
        _normalize_target_steps(steps=["not", "a", "dict"], step_name="evaluators")


# --- _parse_evaluate_kwargs ------------------------------------------------


def _ids():
    return str(uuid4()), str(uuid4()), str(uuid4())


def test_parse_kwargs_builds_data_from_direct_kwargs():
    ts, app, ev = _ids()
    data = run(
        _parse_evaluate_kwargs(
            testsets={ts: "custom"},
            applications={app: "custom"},
            evaluators={ev: "auto"},
            repeats=3,
        )
    )
    assert _str_keys(data.testset_steps) == {ts: "custom"}
    assert _str_keys(data.application_steps) == {app: "custom"}
    assert _str_keys(data.evaluator_steps) == {ev: "auto"}
    assert data.repeats == 3


def test_parse_kwargs_builds_data_from_specs_dict():
    ts, app, ev = _ids()
    data = run(
        _parse_evaluate_kwargs(
            specs={
                "testsets": {ts: "custom"},
                "applications": {app: "custom"},
                "evaluators": {ev: "human"},
                "repeats": 2,
            }
        )
    )
    assert _str_keys(data.testset_steps) == {ts: "custom"}
    assert _str_keys(data.evaluator_steps) == {ev: "human"}
    assert data.repeats == 2


def test_parse_kwargs_accepts_evaluatespecs_instance():
    ts, app, ev = _ids()
    data = run(
        _parse_evaluate_kwargs(
            specs=EvaluateSpecs(
                testsets={ts: "custom"},
                applications={app: "custom"},
                evaluators={ev: "auto"},
            )
        )
    )
    assert _str_keys(data.application_steps) == {app: "custom"}


def test_parse_kwargs_direct_kwargs_win_over_specs():
    ts, app, ev = _ids()
    other_ts = str(uuid4())
    data = run(
        _parse_evaluate_kwargs(
            testsets={ts: "custom"},
            specs={
                "testsets": {other_ts: "custom"},
                "applications": {app: "custom"},
                "evaluators": {ev: "auto"},
            },
        )
    )
    # direct testsets kwarg wins; applications/evaluators fall back to specs
    assert _str_keys(data.testset_steps) == {ts: "custom"}
    assert _str_keys(data.application_steps) == {app: "custom"}


@pytest.mark.parametrize(
    "missing",
    ["testsets", "applications", "evaluators"],
)
def test_parse_kwargs_requires_each_step_group(missing):
    ts, app, ev = _ids()
    kwargs = {
        "testsets": {ts: "custom"},
        "applications": {app: "custom"},
        "evaluators": {ev: "auto"},
    }
    kwargs.pop(missing)
    with pytest.raises(ValueError, match=f"missing {missing}"):
        run(_parse_evaluate_kwargs(**kwargs))


def test_parse_kwargs_ignores_non_spec_object():
    ts, app, ev = _ids()
    # A specs value that is neither dict nor EvaluateSpecs is dropped, so the
    # direct kwargs must still satisfy the required groups.
    data = run(
        _parse_evaluate_kwargs(
            testsets={ts: "custom"},
            applications={app: "custom"},
            evaluators={ev: "auto"},
            specs="not-a-spec",
        )
    )
    assert _str_keys(data.testset_steps) == {ts: "custom"}
