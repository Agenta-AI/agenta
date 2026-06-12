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
  - the INPUT -> APPLICATION -> EVALUATOR(s) ordering invariant: heterogeneous
    evaluators run in both orders, asserting each consumes the application's
    output (never a sibling evaluator's), so order does not change any result;
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
def pass_evaluator(**kwargs) -> dict:
    """A deterministic evaluator that always passes."""
    return {"score": 1.0, "success": True}


@ag.evaluator()
def length_evaluator(outputs=None, **kwargs) -> dict:
    """A deterministic evaluator scoring by the app output's length.

    The upstream application output arrives under the `outputs` kwarg (a dict
    like {"answer": topic}), NOT splatted as individual kwargs — so it reads
    outputs["answer"], not a bare `answer` param.
    """
    answer = (outputs or {}).get("answer") if isinstance(outputs, dict) else None
    return {"score": float(len(answer or "")), "success": True}


# An evaluator receives the UPSTREAM application output under the `outputs`
# kwarg (a dict like {"answer": topic}) and its own testcase under `inputs` —
# the app output is NOT splatted as individual kwargs. These two evaluators pin
# the ordering invariant end-to-end:
#   - output_matches scores 1.0 only when `outputs` is the app's echo dict
#     ({"answer": <topic>}) — i.e. it received the APPLICATION's output;
#   - score_dict returns a {"score", "success"} dict — the SAME shape a leaked
#     upstream would take. If evaluator order ever contaminated the shared
#     upstream channel, output_matches would see score_dict's dict under
#     `outputs` (no "answer" key) and score 0.0. Running BOTH orders proves the
#     order does not matter.


@ag.evaluator()
def output_matches(outputs=None, inputs=None, **kwargs) -> dict:
    """Score 1.0 iff the upstream `outputs` is the application's echo dict
    (carries an "answer" key matching the testcase topic)."""
    expected = (inputs or {}).get("topic")
    got = (outputs or {}).get("answer") if isinstance(outputs, dict) else None
    matched = got is not None and got == expected
    return {"score": 1.0 if matched else 0.0, "success": matched}


@ag.evaluator()
def output_matches_b(outputs=None, inputs=None, **kwargs) -> dict:
    """Second contamination-sensitive evaluator with a distinct sentinel (0.25)
    so it can be told apart from output_matches when both run in one matrix."""
    expected = (inputs or {}).get("topic")
    got = (outputs or {}).get("answer") if isinstance(outputs, dict) else None
    matched = got is not None and got == expected
    return {"score": 0.25 if matched else 0.0, "success": matched}


@ag.evaluator()
def score_dict(outputs=None, **kwargs) -> dict:
    """Returns a fixed {score, success} dict — the SAME shape a leaked upstream
    would take. Its sentinel score 0.5 is distinct from the output_matches
    sentinels so the evaluators can be told apart in the (slug-hashed) metric
    keys."""
    return {"score": 0.5, "success": True}


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
    # metrics is {global, variational}; the evaluator outputs land in the
    # whole-run (global) row's data.
    m = (result["metrics"] or {}).get("global")
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


def _evaluator_score_means(result):
    """Mean of each evaluator step's score metric, keyed by step_key.

    The whole-run (global) metrics row carries one entry per step; evaluator
    steps expose `attributes.ag.data.outputs.score`. Returns {step_key: mean}
    for every evaluator step that scored.
    """
    data = _metrics_data(result)
    means = {}
    for step_key, step_metrics in data.items():
        if not step_key.startswith("evaluator-"):
            continue
        score = step_metrics.get("attributes.ag.data.outputs.score")
        if score and "mean" in score:
            means[step_key] = score["mean"]
    return means


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
        # pass_evaluator -> 1.0; length_evaluator reads the app output
        # ("alpha"/"beta") -> mean length 4.5. The length score proves the
        # evaluator received the real app output, not an empty `answer` kwarg.
        means = sorted(_evaluator_score_means(result).values())
        assert means == [1.0, 4.5], means

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


class TestEvaluatorOrderingInvariant:
    """End-to-end guard for INPUT -> APPLICATION -> EVALUATOR(s) with the
    application as the sole producer of path output and evaluators as pure,
    mutually independent consumers. A contamination-sensitive evaluator
    (output_matches) is run alongside a dict-returning one (score_dict) in BOTH
    orders; output_matches must score 1.0 (saw the app output) either way.

    Regression guard for the bug where a later evaluator read an earlier
    evaluator's output instead of the application's (Exact Match -> 0%).
    """

    @pytest.mark.parametrize(
        "evaluators",
        [
            [score_dict, output_matches],  # contaminator first
            [output_matches, score_dict],  # contaminator second
        ],
        ids=["contaminator-first", "contaminator-second"],
    )
    async def test_order_does_not_change_evaluator_inputs(
        self, agenta_init, evaluators
    ):
        rev = await _make_testset()
        result = await aevaluate(
            name="sdk-eval-order",
            testsets={str(rev.id): "custom"},
            applications=[echo_app],
            evaluators=evaluators,
        )
        _assert_eval_result(result, expected_scenarios=2)

        means = _evaluator_score_means(result)
        # both evaluators scored.
        assert len(means) == 2, means
        score_values = sorted(means.values())
        # score_dict always reports its 0.5 sentinel; output_matches must report
        # 1.0 (it received the app output). If the path channel were contaminated
        # by score_dict's dict, output_matches would see no `answer` and report
        # 0.0 — so {0.5, 0.0} would appear instead of {0.5, 1.0}.
        assert score_values == [0.5, 1.0], (
            f"evaluator order leaked outputs across siblings: {means}"
        )

    async def test_sensitive_evaluator_on_both_sides_of_contaminator(self, agenta_init):
        # The strongest shape: a contamination-sensitive evaluator sits BEFORE
        # and AFTER the dict-returning one. Both must score 1.0 — the one after
        # the contaminator is the position that regressed in production.
        rev = await _make_testset()
        result = await aevaluate(
            name="sdk-eval-sandwich",
            testsets={str(rev.id): "custom"},
            applications=[echo_app],
            evaluators=[output_matches, score_dict, output_matches_b],
        )
        _assert_eval_result(result, expected_scenarios=2)
        means = _evaluator_score_means(result)
        assert len(means) == 3, means
        # output_matches -> 1.0, score_dict -> 0.5, output_matches_b -> 0.25;
        # any contamination would drop a sensitive evaluator to 0.0.
        assert sorted(means.values()) == [0.25, 0.5, 1.0], (
            f"a sibling's output leaked into a sensitive evaluator: {means}"
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
