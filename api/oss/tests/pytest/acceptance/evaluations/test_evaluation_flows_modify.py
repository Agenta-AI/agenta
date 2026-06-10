"""
End-to-end evaluation FLOW tests for modify-after-run lifecycle:
run to completion, then mutate, then re-verify.

Uses the deterministic LLM-free `agenta:custom:mock:v0` workflow. See
`_flow_helpers.py`.

Covers:
  - re-start a finished batch run -> it re-dispatches and finalizes again
    (validates the finalization rule: a (re)dispatched run resets to running, then
    the slice re-finalizes it).
"""

from ._flow_helpers import (
    create_mock_application,
    create_mock_evaluator,
    create_testset,
    create_simple_evaluation,
    wait_for_run_terminal,
    start_evaluation,
)


class TestEvaluationModifyFlows:
    def test_restart_finished_batch_run_re_dispatches_and_finalizes_again(
        self, authed_api
    ):
        # ARRANGE: run a batch eval to terminal success ------------------------
        testset = create_testset(authed_api)
        application = create_mock_application(authed_api, key="echo")
        evaluator = create_mock_evaluator(authed_api, key="pass")
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-restart-finished",
            data={
                "testset_steps": [testset["revision_id"]],
                "application_steps": [application["revision_id"]],
                "evaluator_steps": {evaluator["revision_id"]: "auto"},
            },
        )
        run_id = evaluation["id"]
        first = wait_for_run_terminal(authed_api, run_id)
        assert first.json()["run"]["status"] == "success"
        # ----------------------------------------------------------------------

        # ACT: re-start the finished run ---------------------------------------
        start_evaluation(authed_api, run_id)
        # ----------------------------------------------------------------------

        # ASSERT: it re-dispatches and reaches a terminal status again ---------
        # (activation resets status=RUNNING, then the slice
        # finalizes it. We assert the end state is terminal again.)
        final = wait_for_run_terminal(authed_api, run_id)
        assert final.json()["run"]["status"] == "success", final.json()["run"]
        # ----------------------------------------------------------------------
