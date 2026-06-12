"""
End-to-end evaluator-ordering FLOW tests through the real worker.

The runtime contract is INPUT -> APPLICATION -> EVALUATOR(s), where the
application is the sole PRODUCER of a path's output and each evaluator is a
pure, mutually independent CONSUMER (it reads the app output and its own
inputs, never a sibling evaluator's output). Evaluators are conceptually
parallel, so their order must not change any evaluator's input or result.

These guard the bug where a later evaluator read an earlier evaluator's output
instead of the application's (Exact Match -> 0%), exercised through the worker
path (not the SDK in-process path). They use the deterministic
`agenta:custom:mock:v0` workflow — no LLM, no sandbox:
  - app  `echo`    -> outputs the testcase inputs dict (a real app output);
  - eval `reflect` -> contamination-sensitive: scores 1.0 iff it received a
                      real app output, 0.0 if it received an evaluator-result
                      dict (a leaked sibling output);
  - eval `score`   -> a fixed-score evaluator whose output is the SAME
                      {"score","success"} shape a leak would take; its sentinel
                      0.5 (distinct from reflect's 0.0/1.0) is the contaminator.
"""

from ._flow_helpers import (
    create_mock_application,
    create_mock_evaluator,
    create_testset,
    create_simple_evaluation,
    wait_for_run_terminal,
    query_scenarios,
    refresh_global_metric,
    evaluator_score_means,
)


class TestEvaluatorOrderingFlows:
    def _run_with_evaluator_order(self, authed_api, *, name, evaluator_steps):
        testset = create_testset(authed_api)  # 2 testcases
        application = create_mock_application(authed_api, key="echo")
        evaluation = create_simple_evaluation(
            authed_api,
            name=name,
            data={
                "testset_steps": [testset["revision_id"]],
                "application_steps": [application["revision_id"]],
                "evaluator_steps": evaluator_steps,
            },
        )
        run_id = evaluation["id"]
        final = wait_for_run_terminal(authed_api, run_id)
        assert final.json()["run"]["status"] == "success", final.json()
        assert len(query_scenarios(authed_api, run_id)) == 2
        return run_id

    def test_reflect_before_contaminator(self, authed_api):
        # reflect runs BEFORE the score evaluator.
        reflect = create_mock_evaluator(authed_api, key="reflect")
        score = create_mock_evaluator(
            authed_api, key="score", kwargs={"score": 0.5, "threshold": 0.5}
        )
        # dict preserves insertion order -> reflect first.
        run_id = self._run_with_evaluator_order(
            authed_api,
            name="flow-order-reflect-first",
            evaluator_steps={
                reflect["revision_id"]: "auto",
                score["revision_id"]: "auto",
            },
        )
        global_metric = refresh_global_metric(authed_api, run_id, expect_evaluators=2)
        means = sorted(evaluator_score_means(global_metric).values())
        # reflect -> 1.0 (saw the app output), score -> 0.5.
        assert means == [0.5, 1.0], evaluator_score_means(global_metric)

    def test_reflect_after_contaminator(self, authed_api):
        # reflect runs AFTER the score evaluator — the position that regressed in
        # production. A leaked score-evaluator output would drop reflect to 0.0.
        score = create_mock_evaluator(
            authed_api, key="score", kwargs={"score": 0.5, "threshold": 0.5}
        )
        reflect = create_mock_evaluator(authed_api, key="reflect")
        run_id = self._run_with_evaluator_order(
            authed_api,
            name="flow-order-reflect-second",
            evaluator_steps={
                score["revision_id"]: "auto",
                reflect["revision_id"]: "auto",
            },
        )
        global_metric = refresh_global_metric(authed_api, run_id, expect_evaluators=2)
        means = sorted(evaluator_score_means(global_metric).values())
        assert means == [0.5, 1.0], evaluator_score_means(global_metric)

    def test_reflect_sandwiched_between_contaminators(self, authed_api):
        # Strongest shape: a sensitive evaluator with a contaminator on BOTH
        # sides. reflect must still score 1.0 regardless of siblings/order.
        score_a = create_mock_evaluator(
            authed_api, key="score", kwargs={"score": 0.25, "threshold": 0.5}
        )
        reflect = create_mock_evaluator(authed_api, key="reflect")
        score_b = create_mock_evaluator(
            authed_api, key="score", kwargs={"score": 0.75, "threshold": 0.5}
        )
        run_id = self._run_with_evaluator_order(
            authed_api,
            name="flow-order-sandwich",
            evaluator_steps={
                score_a["revision_id"]: "auto",
                reflect["revision_id"]: "auto",
                score_b["revision_id"]: "auto",
            },
        )
        global_metric = refresh_global_metric(authed_api, run_id, expect_evaluators=3)
        means = sorted(evaluator_score_means(global_metric).values())
        # score_a -> 0.25, score_b -> 0.75, reflect -> 1.0. Contamination would
        # drop reflect to 0.0.
        assert means == [0.25, 0.75, 1.0], evaluator_score_means(global_metric)
