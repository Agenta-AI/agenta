"""
End-to-end evaluation FLOW tests: trigger a run, wait for the worker to finish,
and verify the run reached a terminal state with scenarios/metrics.

These run through the real worker + services container with NO LLM and NO code
sandbox, using the deterministic `agenta:custom:mock:v0` workflow for both the
application and the evaluator. See `_flow_helpers.py`.

Coverage spans the worker dispatch topologies (see
`api/oss/src/core/evaluations/runtime/topology.py`):
  - batch_testset    (testset -> mock app -> mock auto-evaluator)  -> success
  - batch_invocation (testset -> mock app)                         -> success
  - testset_eval     (testset -> mock auto-evaluator, no app)      -> success
  - testcase_queue   (human testcases queue: annotate/close/stop)  -> closed
  - live_query       (live + query -> evaluator)                   -> stays running
  - batch_query      (query -> evaluator)                          -> xfail
"""

import time

from ._flow_helpers import (
    create_mock_application,
    create_mock_evaluator,
    create_query,
    create_testset,
    create_simple_evaluation,
    create_testcases_queue,
    add_testcases_to_queue,
    query_testcase_ids,
    wait_for_run_terminal,
    wait_for_scenarios,
    submit_annotation,
    close_scenario,
    close_run,
    stop_evaluation,
    fetch_run,
    query_scenarios,
)


class TestEvaluationRunFlows:
    def test_testset_to_mock_app_to_mock_evaluator_runs_to_success(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        testset = create_testset(authed_api)
        application = create_mock_application(authed_api, key="echo")
        evaluator = create_mock_evaluator(authed_api, key="pass")
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-testset-app-evaluator",
            data={
                "testset_steps": [testset["revision_id"]],
                "application_steps": [application["revision_id"]],
                "evaluator_steps": {evaluator["revision_id"]: "auto"},
            },
        )
        run_id = evaluation["id"]
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        final = wait_for_run_terminal(authed_api, run_id)
        run = final.json()["run"]
        assert run["status"] == "success", run
        # terminal run is no longer active
        assert (run.get("flags") or {}).get("is_active") is False, run

        scenarios = query_scenarios(authed_api, run_id)
        # the default testset has 2 testcases -> 2 scenarios
        assert len(scenarios) == 2, scenarios
        # ----------------------------------------------------------------------

    def test_testset_to_mock_app_batch_invocation_runs_to_success(self, authed_api):
        # batch_invocation: testset -> application, no evaluator.
        # ARRANGE --------------------------------------------------------------
        testset = create_testset(authed_api)
        application = create_mock_application(authed_api, key="echo")
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-testset-app-only",
            data={
                "testset_steps": [testset["revision_id"]],
                "application_steps": [application["revision_id"]],
            },
        )
        run_id = evaluation["id"]
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        final = wait_for_run_terminal(authed_api, run_id)
        run = final.json()["run"]
        assert run["status"] == "success", run
        assert (run.get("flags") or {}).get("is_active") is False, run
        # ----------------------------------------------------------------------

    def test_testset_to_mock_evaluator_runs_to_success(self, authed_api):
        # batch_testset with NO application: testset -> auto-evaluator. Scores
        # each testcase directly (UEL-043 — supported {testset, batch} shape).
        # ARRANGE --------------------------------------------------------------
        testset = create_testset(authed_api)
        evaluator = create_mock_evaluator(authed_api, key="pass")
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-testset-evaluator-no-app",
            data={
                "testset_steps": [testset["revision_id"]],
                "evaluator_steps": {evaluator["revision_id"]: "auto"},
            },
        )
        run_id = evaluation["id"]
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        final = wait_for_run_terminal(authed_api, run_id)
        run = final.json()["run"]
        assert run["status"] == "success", run
        assert (run.get("flags") or {}).get("is_active") is False, run

        scenarios = query_scenarios(authed_api, run_id)
        # the default testset has 2 testcases -> 2 scenarios
        assert len(scenarios) == 2, scenarios
        # ----------------------------------------------------------------------

    def test_human_testcases_queue_annotate_stop_close_scenarios_then_run(
        self, authed_api
    ):
        # {testcase, queue} with a HUMAN evaluator: scenarios mint at PENDING and
        # wait for manual scoring. The e2e is the manual workbench flow — push the
        # annotation trace, close the scenarios, stop (deactivate) the run, then
        # close (lock) it.
        # ARRANGE --------------------------------------------------------------
        testset = create_testset(authed_api)
        evaluator = create_mock_evaluator(authed_api, key="pass")
        testcase_ids = query_testcase_ids(authed_api, testset)
        assert len(testcase_ids) == 2, testcase_ids

        queue = create_testcases_queue(authed_api, evaluator=evaluator)
        run_id = queue["run_id"]
        add_testcases_to_queue(authed_api, queue["id"], testcase_ids)
        scenarios = wait_for_scenarios(authed_api, run_id, expected_count=2)
        assert all(s["status"] == "pending" for s in scenarios), scenarios
        # ----------------------------------------------------------------------

        # ACT — push the trace + close each scenario; then stop + close the run -
        for scenario in scenarios:
            submit_annotation(
                authed_api,
                evaluator=evaluator,
                outputs={"score": 1},
                links={"testcase": {"id": str(scenario["id"])}},
            )
            close_scenario(authed_api, scenario, status="success")

        # stop deactivates (is_active=False); close locks (is_closed=True).
        stop_evaluation(authed_api, run_id)
        closed = close_run(authed_api, run_id)["run"]
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert closed["flags"]["is_closed"] is True, closed
        assert closed["flags"]["is_active"] is False, closed

        final_scenarios = query_scenarios(authed_api, run_id)
        assert all(s["status"] == "success" for s in final_scenarios), final_scenarios

        # a closed run rejects further mutation
        rejected = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/scenarios/add",
            json={"count": 1},
        )
        assert rejected.status_code == 409, rejected.text
        # ----------------------------------------------------------------------

    def test_live_query_evaluation_stays_running_and_active(self, authed_api):
        # live_query never finalizes via the slice (update_run_status=False); it
        # stays running/active so the scheduler keeps polling. This guards that
        # the finalization fix does NOT finalize live evals.
        # ARRANGE --------------------------------------------------------------
        query = create_query(authed_api, trace_type="invocation")
        evaluator = create_mock_evaluator(authed_api, key="pass")
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-live-query-evaluator",
            data={
                "query_steps": [query["revision_id"]],
                "evaluator_steps": {evaluator["revision_id"]: "auto"},
            },
            flags={"is_live": True},
        )
        run_id = evaluation["id"]
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        # give the worker a moment, then assert it has NOT been finalized
        time.sleep(5)
        run = fetch_run(authed_api, run_id)
        assert run.get("status") == "running", run
        assert (run.get("flags") or {}).get("is_active") is True, run
        # ----------------------------------------------------------------------

    def test_batch_query_to_evaluator_runs_to_success(self, authed_api):
        # batch_query: query -> evaluator (no app, not live). Resolves traces via
        # the query filter; with no matching traces in the test env it resolves
        # zero items and still finalizes to success (batch query
        # runs finalize, unlike live query runs).
        # ARRANGE --------------------------------------------------------------
        query = create_query(authed_api, trace_type="invocation")
        evaluator = create_mock_evaluator(authed_api, key="pass")
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        evaluation = create_simple_evaluation(
            authed_api,
            name="flow-batch-query-evaluator",
            data={
                "query_steps": [query["revision_id"]],
                "evaluator_steps": {evaluator["revision_id"]: "auto"},
            },
        )
        run_id = evaluation["id"]
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        final = wait_for_run_terminal(authed_api, run_id)
        run = final.json()["run"]
        assert run["status"] == "success", run
        assert (run.get("flags") or {}).get("is_active") is False, run
        # ----------------------------------------------------------------------
