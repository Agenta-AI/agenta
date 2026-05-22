"""
Integration-level tests for the aevaluate() orchestration.

These exercise the real SDK orchestration in agenta.sdk.evaluations.preview.evaluate
(spec parsing, entity retrieval, step-graph construction, runner wiring, result
assembly) with the network boundary and the slice processor mocked. They verify
that aevaluate():

  - builds the input/invocation/annotation step graph with the right keys + origins,
  - wires a local application runner and (for auto evaluators) a local evaluator
    runner, but NOT a runner for human evaluators,
  - forwards repeats and the resolved source_items to the processor,
  - assembles {run, scenarios, metrics} from the processed scenarios.

The runtime processor itself is unit-tested separately (test_evaluations_runtime);
here it is mocked so these tests stay deterministic and free of execution timing.
"""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

import agenta.sdk.evaluations.preview.evaluate as ev
from agenta.sdk.evaluations.runtime.adapters import (
    SdkLocalApplicationRunner,
    SdkLocalEvaluatorRunner,
)

pytestmark = pytest.mark.integration

MOD = "agenta.sdk.evaluations.preview.evaluate"


def run(coro):
    return asyncio.run(coro)


def _testcase(data):
    return SimpleNamespace(
        id=uuid4(),
        data=data,
        model_dump=lambda **kw: {"data": data},
    )


def _testset_revision(*, slug="t1", testcases):
    return SimpleNamespace(
        id=uuid4(),
        slug=slug,
        version="1",
        testset_id=uuid4(),
        testset_variant_id=uuid4(),
        data=SimpleNamespace(testcases=testcases),
    )


def _application_revision(*, slug="app1"):
    return SimpleNamespace(
        id=uuid4(),
        slug=slug,
        version="1",
        application_id=uuid4(),
        application_variant_id=uuid4(),
        data=SimpleNamespace(),
    )


def _evaluator_revision(*, slug="ev1"):
    return SimpleNamespace(
        id=uuid4(),
        slug=slug,
        version="1",
        evaluator_id=uuid4(),
        evaluator_variant_id=uuid4(),
        data=SimpleNamespace(),
    )


def _patch_io(*, testset_revision, application_revision, evaluator_revision, captured):
    """Patch every network/IO boundary aevaluate() uses, and capture the
    process_evaluation_source_slice kwargs. Returns a context-manager list."""
    run_obj = SimpleNamespace(id=uuid4())

    async def fake_process(**kwargs):
        captured["process_kwargs"] = kwargs
        # Return one processed scenario per source item.
        return [
            SimpleNamespace(
                scenario=SimpleNamespace(id=uuid4()),
                results={},
                metrics={"score": 1.0},
            )
            for _ in kwargs["source_items"]
        ]

    return [
        patch(f"{MOD}.acreate_run", AsyncMock(return_value=run_obj)),
        patch(f"{MOD}.aclose_run", AsyncMock(return_value=run_obj)),
        patch(f"{MOD}.aget_url", AsyncMock(return_value="http://x/run")),
        patch(
            f"{MOD}.aadd_scenario", AsyncMock(return_value=SimpleNamespace(id=uuid4()))
        ),
        patch(f"{MOD}.acompute_metrics", AsyncMock(return_value={"score": 1.0})),
        patch(f"{MOD}.aretrieve_testset", AsyncMock(return_value=testset_revision)),
        patch(
            f"{MOD}.aretrieve_application",
            AsyncMock(return_value=application_revision),
        ),
        patch(
            f"{MOD}.aretrieve_evaluator",
            AsyncMock(return_value=evaluator_revision),
        ),
        patch(f"{MOD}.process_evaluation_source_slice", fake_process),
    ]


def _evaluate(*, evaluators, repeats=None, testcases=None):
    captured = {}
    tsr = _testset_revision(
        testcases=testcases or [_testcase({"q": "a"}), _testcase({"q": "b"})]
    )
    appr = _application_revision()
    evr = _evaluator_revision()

    patches = _patch_io(
        testset_revision=tsr,
        application_revision=appr,
        evaluator_revision=evr,
        captured=captured,
    )
    for p in patches:
        p.start()
    try:
        result = run(
            ev.aevaluate(
                testsets={str(tsr.id): "custom"},
                applications={str(appr.id): "custom"},
                evaluators=evaluators,
                repeats=repeats,
            )
        )
    finally:
        for p in patches:
            p.stop()
    return result, captured, (tsr, appr, evr)


class TestAevaluateOrchestration:
    def test_builds_step_graph_and_returns_run_scenarios_metrics(self):
        _, captured, (tsr, appr, evr) = _evaluate(evaluators={str(uuid4()): "auto"})

        steps = captured["process_kwargs"]["steps"]
        kinds = [(s.key, s.type, s.origin) for s in steps]

        # input (testset) + invocation (application) + annotation (evaluator)
        types = [t for _, t, _ in kinds]
        assert "input" in types
        assert "invocation" in types
        assert "annotation" in types

        # input step key derives from the testset slug, invocation from app slug
        assert any(k.startswith("testset-") and t == "input" for k, t, _ in kinds)
        assert any(
            k == f"application-{appr.slug}" and t == "invocation" for k, t, _ in kinds
        )
        assert any(
            k == f"evaluator-{evr.slug}" and t == "annotation" for k, t, _ in kinds
        )

    def test_auto_evaluator_gets_local_runner(self):
        _, captured, (_tsr, appr, evr) = _evaluate(evaluators={str(uuid4()): "auto"})
        runners = captured["process_kwargs"]["runners"]

        assert isinstance(
            runners[f"application-{appr.slug}"], SdkLocalApplicationRunner
        )
        # auto evaluator -> local evaluator runner is wired
        assert isinstance(runners[f"evaluator-{evr.slug}"], SdkLocalEvaluatorRunner)

    def test_human_evaluator_gets_no_runner(self):
        _, captured, (_tsr, _appr, evr) = _evaluate(evaluators={str(uuid4()): "human"})
        runners = captured["process_kwargs"]["runners"]

        # human annotation has no auto runner (it is filled in by a person)
        assert f"evaluator-{evr.slug}" not in runners
        # but the annotation step is still in the graph
        steps = captured["process_kwargs"]["steps"]
        assert any(
            s.key == f"evaluator-{evr.slug}" and s.origin == "human" for s in steps
        )

    def test_forwards_repeats_and_source_items(self):
        tcs = [_testcase({"q": "a"}), _testcase({"q": "b"}), _testcase({"q": "c"})]
        _, captured, _ = _evaluate(
            evaluators={str(uuid4()): "auto"}, repeats=4, testcases=tcs
        )
        assert captured["process_kwargs"]["repeats"] == 4
        # one source item per testcase
        assert len(captured["process_kwargs"]["source_items"]) == 3

    def test_assembles_result_payload(self):
        result, captured, _ = _evaluate(evaluators={str(uuid4()): "auto"})
        assert set(result.keys()) == {"run", "scenarios", "metrics"}
        # one processed scenario per source item (2 default testcases)
        assert len(result["scenarios"]) == 2
        assert result["metrics"] == {"score": 1.0}
