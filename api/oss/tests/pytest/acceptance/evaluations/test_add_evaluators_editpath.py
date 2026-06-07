"""Verify the CLEAN FE path: PATCH simple-eval (evaluator_steps) + process.

FE sends only revision IDs; server rebuilds steps+mappings. No client replication.
"""

from uuid import uuid4
from ._flow_helpers import (
    create_mock_application,
    create_mock_evaluator,
    create_testset,
    create_simple_evaluation,
    wait_for_run_terminal,
    query_scenarios,
    refresh_global_metric,
    evaluator_score_means,
    fetch_run,
)


def _steps(run, t):
    return [
        s for s in ((run.get("data") or {}).get("steps") or []) if s.get("type") == t
    ]


def _rev_ids(run, t, ref_key):
    return [
        s["references"][ref_key]["id"]
        for s in _steps(run, t)
        if (s.get("references") or {}).get(ref_key)
    ]


class TestEditPath:
    def test_edit_then_process(self, authed_api):
        ts = create_testset(authed_api)
        app = create_mock_application(authed_api, key="echo")
        e1 = create_mock_evaluator(
            authed_api, key="score", kwargs={"score": 0.5, "threshold": 0.5}
        )
        e2 = create_mock_evaluator(
            authed_api, key="score", kwargs={"score": 0.7, "threshold": 0.5}
        )
        run_id = create_simple_evaluation(
            authed_api,
            name=f"editpath-{uuid4()}",
            data={
                "testset_steps": [ts["revision_id"]],
                "application_steps": [app["revision_id"]],
                "evaluator_steps": {e1["revision_id"]: "auto"},
            },
        )["id"]
        wait_for_run_terminal(authed_api, run_id)
        before = fetch_run(authed_api, run_id)
        scn = [s["id"] for s in query_scenarios(authed_api, run_id)]
        before_keys = {s["key"] for s in _steps(before, "annotation")}

        ev_revs = _rev_ids(before, "annotation", "evaluator_revision")
        body = {
            "evaluation": {
                "id": run_id,
                "data": {
                    "testset_steps": _rev_ids(before, "input", "testset_revision"),
                    "application_steps": _rev_ids(
                        before, "invocation", "application_revision"
                    ),
                    "evaluator_steps": {
                        **{r: "auto" for r in ev_revs},
                        e2["revision_id"]: "auto",
                    },
                },
            }
        }
        resp = authed_api("PATCH", f"/simple/evaluations/{run_id}", json=body)
        assert resp.status_code in (200, 202), (
            f"edit failed: {resp.status_code} {resp.text[:300]}"
        )

        after = fetch_run(authed_api, run_id)
        new_keys = {s["key"] for s in _steps(after, "annotation")} - before_keys
        assert len(new_keys) == 1, f"expected 1 new evaluator step, got {new_keys}"
        new_key = next(iter(new_keys))
        assert [
            m
            for m in (after["data"].get("mappings") or [])
            if (m.get("step") or {}).get("key") == new_key
        ], "server did not build mappings for the new evaluator"

        proc = authed_api(
            "POST",
            f"/simple/evaluations/{run_id}/process",
            json={"scenario_ids": scn, "step_keys": [new_key], "overwrite": False},
        )
        assert proc.status_code in (200, 202), proc.text
        wait_for_run_terminal(authed_api, run_id)
        assert len(query_scenarios(authed_api, run_id)) == len(scn), (
            "app re-invoked (new scenarios)"
        )
        means = sorted(
            evaluator_score_means(
                refresh_global_metric(authed_api, run_id, expect_evaluators=2)
            ).values()
        )
        assert means == [0.5, 0.7], f"got {means}"
