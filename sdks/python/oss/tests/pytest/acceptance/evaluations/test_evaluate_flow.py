"""
End-to-end acceptance tests for the high-level evaluate() entrypoint
(`agenta.sdk.evaluations.aevaluate`).

aevaluate() is a CLIENT-SIDE orchestrator: it upserts the testset/application/
evaluator, creates a run, builds the input/invocation/annotation step graph,
executes the slice IN-PROCESS via the SDK local runners, computes metrics, and
closes the run — returning {run, scenarios, metrics}. No worker is involved.

These run against the live API (acceptance) using deterministic, LLM-free
handlers, so they exercise the real upsert + run + local-execution path.

Coverage:
  - local-callable mode (handlers passed directly) across the config matrix:
    single auto evaluator, repeats, multiple evaluators;
  - saved-workflow mode once: the application is the saved agenta:custom:mock:v0
    workflow referenced by revision id.

We do not re-run the whole matrix through both modes — the matrix runs through
local-callable mode; saved-workflow mode gets a single wiring test.
"""

from uuid import uuid4

import pytest

import agenta as ag
from agenta.sdk.evaluations import aevaluate
from agenta.sdk.managers import testsets, applications

pytestmark = [pytest.mark.acceptance, pytest.mark.asyncio]

MOCK_URI = "agenta:custom:mock:v0"


@ag.workflow(uri=MOCK_URI, parameters={"key": "echo", "kwargs": {}})
def mock_app():
    """Saved-workflow handle pointing at the deterministic agenta:custom:mock:v0
    workflow (echo selector). Registered as an application via its URI."""


# --- deterministic, LLM-free local handlers --------------------------------


@ag.application()
def echo_app(topic: str = "") -> dict:
    """A trivial deterministic application: echoes the input."""
    return {"answer": topic}


@ag.evaluator()
def pass_evaluator(answer: str = "", **kwargs) -> dict:
    """A deterministic evaluator that always passes."""
    return {"score": 1.0, "success": True}


@ag.evaluator()
def length_evaluator(answer: str = "", **kwargs) -> dict:
    """A deterministic evaluator scoring by output length."""
    return {"score": float(len(answer or "")), "success": True}


async def _make_testset():
    name = f"sdk-eval-flow-{uuid4().hex[:8]}"
    rev = await testsets.aupsert(
        name=name,
        data=[
            {"topic": "alpha"},
            {"topic": "beta"},
        ],
    )
    assert rev is not None and rev.testset_id
    return rev


def _assert_eval_result(result, *, expected_scenarios):
    assert result is not None, "aevaluate returned None"
    assert set(result.keys()) == {"run", "scenarios", "metrics"}
    assert result["run"] is not None and result["run"].id
    assert len(result["scenarios"]) == expected_scenarios


def _metrics_data(result):
    m = result["metrics"]
    return getattr(m, "data", None) or {}


def _assert_evaluator_metrics_present(result):
    # The evaluator must actually be EXECUTED by the SDK runtime (custom origin),
    # so its outputs land in the run metrics. Before the custom-execution fix the
    # evaluator step was skipped (logged pending, trace_id=None) and produced no
    # metrics — this assertion guards that regression.
    data = _metrics_data(result)
    evaluator_steps = {k: v for k, v in data.items() if k.startswith("evaluator-")}
    assert evaluator_steps, f"no evaluator metrics in run metrics: {list(data.keys())}"
    # at least one evaluator step exposes its scored output
    assert any(
        any("ag.data.outputs.score" in path for path in v)
        for v in evaluator_steps.values()
    ), f"evaluator metrics present but no score output: {evaluator_steps}"


class TestEvaluateLocalCallable:
    async def test_basic_testset_app_auto_evaluator(self, agenta_init):
        rev = await _make_testset()
        result = await aevaluate(
            name="sdk-eval-basic",
            testsets={str(rev.id): "custom"},
            applications=[echo_app],
            evaluators=[pass_evaluator],
        )
        # 2 testcases x 1 repeat = 2 scenarios
        _assert_eval_result(result, expected_scenarios=2)
        # the custom (SDK-run) evaluator must actually execute and yield metrics
        _assert_evaluator_metrics_present(result)

    async def test_with_repeats(self, agenta_init):
        rev = await _make_testset()
        result = await aevaluate(
            name="sdk-eval-repeats",
            testsets={str(rev.id): "custom"},
            applications=[echo_app],
            evaluators=[pass_evaluator],
            repeats=2,
        )
        # repeats fan out at the scenario/cell level; still one scenario per
        # testcase row (2), each carrying repeated cells.
        _assert_eval_result(result, expected_scenarios=2)

    async def test_multiple_evaluators(self, agenta_init):
        rev = await _make_testset()
        result = await aevaluate(
            name="sdk-eval-multi",
            testsets={str(rev.id): "custom"},
            applications=[echo_app],
            evaluators=[pass_evaluator, length_evaluator],
        )
        _assert_eval_result(result, expected_scenarios=2)
        _assert_evaluator_metrics_present(result)

    async def test_specs_dict_equivalent_to_kwargs(self, agenta_init):
        rev = await _make_testset()
        result = await aevaluate(
            name="sdk-eval-specs",
            specs={
                "testsets": {str(rev.id): "custom"},
                "applications": [echo_app],
                "evaluators": [pass_evaluator],
            },
        )
        _assert_eval_result(result, expected_scenarios=2)

    async def test_missing_evaluators_raises(self, agenta_init):
        rev = await _make_testset()
        with pytest.raises(ValueError, match="missing evaluators"):
            await aevaluate(
                name="sdk-eval-bad",
                testsets={str(rev.id): "custom"},
                applications=[echo_app],
            )


class TestEvaluateSavedWorkflow:
    async def test_saved_mock_workflow_application(self, agenta_init):
        # Saved-workflow mode: register the agenta:custom:mock:v0 workflow as an
        # application revision, then reference it by revision id in aevaluate.
        rev = await _make_testset()

        app_revision_id = await applications.aupsert(
            application_slug=f"mock-app-{uuid4().hex[:8]}",
            name="Mock App",
            handler=mock_app,
        )
        assert app_revision_id is not None

        result = await aevaluate(
            name="sdk-eval-saved",
            testsets={str(rev.id): "custom"},
            applications={str(app_revision_id): "custom"},
            evaluators=[pass_evaluator],
        )
        _assert_eval_result(result, expected_scenarios=2)
