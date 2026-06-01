"""
End-to-end evaluation FLOW tests for modify-after-run lifecycle:
run to completion, then mutate, then re-verify.

Uses the deterministic LLM-free `agenta:custom:mock:v0` workflow. See
`_flow_helpers.py`.

Covers:
  - re-start a finished batch run -> it re-dispatches and finalizes again
    (validates the finalization rule: a (re)dispatched run resets to running, then
    the slice re-finalizes it).
  - archive / unarchive a default queue on a CLOSED run -> both succeed
    (queue archival is a worklist action, independent of run lock).
"""

from ._flow_helpers import (
    create_mock_application,
    create_mock_evaluator,
    create_testset,
    create_simple_evaluation,
    wait_for_run_terminal,
    fetch_run,
    fetch_default_queue,
    start_evaluation,
    close_run,
    archive_queue,
    unarchive_queue,
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

    def test_unarchive_and_archive_default_queue_on_closed_run(self, authed_api):
        # A human evaluator makes the run a queue (gets a default queue).
        # Closing the run reconciles and archives the default queue;
        # archiving/unarchiving a queue must work even on a CLOSED (locked) run,
        # because queue archival is a worklist action, not a content edit.
        # ARRANGE --------------------------------------------------------------
        testset = create_testset(authed_api)
        evaluator = create_mock_evaluator(authed_api, key="pass")
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-human-queue",
            data={
                "testset_steps": [testset["revision_id"]],
                "evaluator_steps": {evaluator["revision_id"]: "human"},
            },
        )
        run_id = evaluation["id"]

        default_queue = fetch_default_queue(authed_api, run_id)
        assert default_queue.get("id"), default_queue
        queue_id = default_queue["id"]

        # close (lock) the run
        close_run(authed_api, run_id)
        run = fetch_run(authed_api, run_id)
        assert (run.get("flags") or {}).get("is_closed") is True, run
        # ----------------------------------------------------------------------

        # ACT + ASSERT: mutate the queue on the CLOSED run ---------------------
        # Regression guard: before the fix these raised
        # EvaluationClosedConflict -> HTTP 409. Now the closed run must NOT block
        # queue archival, so neither call returns 409. (The exact archived/active
        # state depends on close-time reconciliation, which is not what this test
        # asserts.)
        unarchived = unarchive_queue(authed_api, queue_id)
        assert unarchived.status_code != 409, unarchived.text
        assert unarchived.status_code == 200, unarchived.text

        archived = archive_queue(authed_api, queue_id)
        assert archived.status_code != 409, archived.text
        assert archived.status_code == 200, archived.text
        # ----------------------------------------------------------------------
