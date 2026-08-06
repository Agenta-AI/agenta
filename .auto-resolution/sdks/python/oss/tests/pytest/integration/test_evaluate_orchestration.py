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
    SDKWorkflowRunner,
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
        testset_slug="ts-" + slug,
        testset_variant_id=uuid4(),
        testset_variant_slug="tsv-" + slug,
        data=SimpleNamespace(testcases=testcases),
    )


def _application_revision(*, slug="app1"):
    return SimpleNamespace(
        id=uuid4(),
        slug=slug,
        version="1",
        application_id=uuid4(),
        application_slug="app-" + slug,
        application_variant_id=uuid4(),
        application_variant_slug="appv-" + slug,
        data=SimpleNamespace(),
    )


def _evaluator_revision(*, slug="ev1"):
    return SimpleNamespace(
        id=uuid4(),
        slug=slug,
        version="1",
        evaluator_id=uuid4(),
        evaluator_slug="ev-" + slug,
        evaluator_variant_id=uuid4(),
        evaluator_variant_slug="evv-" + slug,
        data=SimpleNamespace(),
    )


def _patch_io(*, testset_revision, application_revision, evaluator_revision, captured):
    """Patch every network/IO boundary aevaluate() uses, and capture the
    process_sources kwargs. Returns a context-manager list.

    The flow runs process_sources ONCE per testset over all source items —
    `captured["process_kwargs"]` holds the most recent call and
    `captured["process_calls"]` holds every call's kwargs.
    """
    run_obj = SimpleNamespace(id=uuid4())
    captured["process_calls"] = []

    async def fake_process(**kwargs):
        captured["process_kwargs"] = kwargs
        captured["process_calls"].append(kwargs)
        # Return one processed scenario per source item.
        return [
            SimpleNamespace(
                scenario=SimpleNamespace(id=uuid4()),
                results={},
                metrics={"score": 1.0},
                has_errors=False,
                has_pending=False,
            )
            for _ in kwargs["source_items"]
        ]

    async def fake_add_scenarios(*, run_id, count, timestamp=None):
        return [SimpleNamespace(id=uuid4()) for _ in range(count)]

    # aevaluate queries metrics at end-of-run via two explicit selectors:
    # aquery_global (the single whole-run row) and aquery_variational (one row
    # per scenario). The result's `metrics` is {global, variational}.
    global_metric = SimpleNamespace(
        scenario_id=None, timestamp=None, data={"score": 1.0}
    )

    return [
        patch(f"{MOD}.acreate_run", AsyncMock(return_value=run_obj)),
        patch(f"{MOD}.aclose_run", AsyncMock(return_value=run_obj)),
        patch(f"{MOD}.aget_url", AsyncMock(return_value="http://x/run")),
        patch(f"{MOD}.aadd_scenarios", fake_add_scenarios),
        patch(f"{MOD}.apopulate_slice", AsyncMock(return_value=[])),
        patch(f"{MOD}.arefresh", AsyncMock(return_value=None)),
        patch(f"{MOD}.aedit_scenario", AsyncMock(return_value=None)),
        patch(f"{MOD}.aquery_global", AsyncMock(return_value=global_metric)),
        patch(f"{MOD}.aquery_variational", AsyncMock(return_value=[])),
        patch(f"{MOD}.aretrieve_testset", AsyncMock(return_value=testset_revision)),
        patch(
            f"{MOD}.aretrieve_application",
            AsyncMock(return_value=application_revision),
        ),
        patch(
            f"{MOD}.aretrieve_evaluator",
            AsyncMock(return_value=evaluator_revision),
        ),
        patch(f"{MOD}.process_sources", fake_process),
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

        # one shared SDKWorkflowRunner is wired into both runnable step kinds
        # (it branches on step type internally).
        assert isinstance(runners[f"application-{appr.slug}"], SDKWorkflowRunner)
        # auto evaluator -> local runner is wired
        assert isinstance(runners[f"evaluator-{evr.slug}"], SDKWorkflowRunner)

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
        calls = captured["process_calls"]
        # single-slice: process_sources is called ONCE for the testset, carrying
        # all three source items, with repeats forwarded.
        assert len(calls) == 1
        assert calls[0]["repeats"] == 4
        assert len(calls[0]["source_items"]) == 3

    def test_assembles_result_payload(self):
        result, captured, _ = _evaluate(evaluators={str(uuid4()): "auto"})
        assert set(result.keys()) == {"run", "scenarios", "metrics"}
        # one processed scenario per source item (2 default testcases)
        assert len(result["scenarios"]) == 2
        # metrics is {global, variational}; the global row carries the headline
        # score, variational is the per-scenario list.
        assert result["metrics"]["global"].data == {"score": 1.0}
        assert result["metrics"]["variational"] == []
