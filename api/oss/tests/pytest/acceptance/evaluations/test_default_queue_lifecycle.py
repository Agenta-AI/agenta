"""
Default-queue reconciliation state machine.

`_reconcile_default_queue` runs after every create/edit of a run and brings the
default queue + `run.flags.is_queue` in line with the run graph:

    should_exist = EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS or is_human_run

where `is_human_run` = has_human AND no invocation step with an origin other
than `human`. An automatic run that gets a human evaluator stays automatic.

    required + missing   -> create default queue
    required + archived  -> unarchive default queue
    required + active    -> no-op
    not-required + active -> archive default queue

`is_queue == is_human_run AND an active default queue exists`.

Driven through `/evaluations/runs/` (create + PATCH steps) — no worker needed;
reconciliation is synchronous in the create/edit path.
"""

from uuid import uuid4

from ._flow_helpers import (
    create_mock_evaluator,
    create_queue,
    create_testcases_queue,
)


def _input_step():
    return {
        "key": "input",
        "type": "input",
        "origin": "custom",
        "references": {"testset": {"id": str(uuid4())}},
    }


def _human_step():
    return {
        "key": "annotation-human",
        "type": "annotation",
        "origin": "human",
        "references": {"evaluator_revision": {"id": str(uuid4())}},
        "inputs": [{"key": "input"}],
    }


def _auto_step():
    return {
        "key": "annotation-auto",
        "type": "annotation",
        "origin": "auto",
        "references": {"evaluator_revision": {"id": str(uuid4())}},
        "inputs": [{"key": "input"}],
    }


def _invocation_step(origin):
    return {
        "key": "invocation",
        "type": "invocation",
        "origin": origin,
        "references": {"application_revision": {"id": str(uuid4())}},
        "inputs": [{"key": "input"}],
    }


def _create_run(authed_api, steps):
    response = authed_api(
        "POST",
        "/evaluations/runs/",
        json={"runs": [{"name": "dq-lifecycle", "data": {"steps": steps}}]},
    )
    assert response.status_code == 200, response.text
    return response.json()["runs"][0]


def _patch_steps(authed_api, run, steps):
    response = authed_api(
        "PATCH",
        f"/evaluations/runs/{run['id']}",
        json={"run": {"id": run["id"], "name": run["name"], "data": {"steps": steps}}},
    )
    assert response.status_code == 200, response.text
    return response.json()["run"]


def _default_queue(authed_api, run_id) -> dict:
    response = authed_api("GET", f"/evaluations/runs/{run_id}/queues/default")
    assert response.status_code == 200, response.text
    return response.json().get("queue") or {}


class TestDefaultQueueLifecycle:
    def test_required_missing_creates_default_queue(self, authed_api):
        # required + missing -> CREATE. A run with a human step gets a default
        # queue and is_queue=True at creation.
        run = _create_run(authed_api, steps=[_input_step(), _human_step()])
        assert run["flags"]["has_human"] is True
        assert run["flags"]["is_queue"] is True

        dq = _default_queue(authed_api, run["id"])
        assert dq.get("id"), dq
        assert dq["flags"]["is_default"] is True

    def test_not_required_active_archives_default_queue(self, authed_api):
        # not-required + active -> ARCHIVE. Dropping the human step removes queue
        # eligibility; the default queue is archived and is_queue flips False.
        run = _create_run(authed_api, steps=[_input_step(), _human_step()])
        assert _default_queue(authed_api, run["id"]).get("id")

        edited = _patch_steps(authed_api, run, steps=[_input_step(), _auto_step()])
        assert edited["flags"]["has_human"] is False
        assert edited["flags"]["is_queue"] is False
        # active default queue is gone (archived)
        assert _default_queue(authed_api, run["id"]) == {}

    def test_required_archived_unarchives_default_queue(self, authed_api):
        # required + archived -> UNARCHIVE. Re-adding a human step after the
        # default queue was archived brings it back and re-sets is_queue=True.
        run = _create_run(authed_api, steps=[_input_step(), _human_step()])
        # drop human -> archive
        _patch_steps(authed_api, run, steps=[_input_step(), _auto_step()])
        assert _default_queue(authed_api, run["id"]) == {}

        # re-add human -> unarchive
        re_added = _patch_steps(authed_api, run, steps=[_input_step(), _human_step()])
        assert re_added["flags"]["has_human"] is True
        assert re_added["flags"]["is_queue"] is True
        dq = _default_queue(authed_api, run["id"])
        assert dq.get("id"), dq

    def test_required_active_is_noop(self, authed_api):
        # required + active -> NO-OP. Editing a run that keeps its human step
        # (changing an unrelated step) keeps the SAME default queue active.
        run = _create_run(authed_api, steps=[_input_step(), _human_step()])
        dq_before = _default_queue(authed_api, run["id"])
        assert dq_before.get("id")

        # edit graph but keep the human step (add an auto step alongside)
        edited = _patch_steps(
            authed_api, run, steps=[_input_step(), _human_step(), _auto_step()]
        )
        assert edited["flags"]["is_queue"] is True
        dq_after = _default_queue(authed_api, run["id"])
        assert dq_after.get("id") == dq_before["id"], (dq_before, dq_after)

    def test_non_human_run_has_no_default_queue(self, authed_api):
        # auto-only run: not a queue, no default queue created.
        run = _create_run(authed_api, steps=[_input_step(), _auto_step()])
        assert run["flags"]["has_human"] is False
        assert run["flags"]["is_queue"] is False
        assert _default_queue(authed_api, run["id"]) == {}

    def test_planted_is_queue_flag_is_reconciled_back(self, authed_api):
        # is_queue is service-derived: an edit that tries to PLANT is_queue=True
        # on a run that is not queue-eligible (no human step) must be reconciled
        # back to False rather than persisted as-is.
        run = _create_run(authed_api, steps=[_input_step(), _auto_step()])
        assert run["flags"]["is_queue"] is False

        response = authed_api(
            "PATCH",
            f"/evaluations/runs/{run['id']}",
            json={
                "run": {
                    "id": run["id"],
                    "name": run["name"],
                    "flags": {"is_queue": True},
                    "data": {"steps": [_input_step(), _auto_step()]},
                }
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["run"]["flags"]["is_queue"] is False
        assert _default_queue(authed_api, run["id"]) == {}


class TestDefaultQueueFollowsRunKind:
    def test_human_step_added_by_patch_to_automatic_run_gives_no_default_queue(
        self, authed_api
    ):
        run = _create_run(
            authed_api,
            steps=[_input_step(), _invocation_step("auto"), _auto_step()],
        )
        assert _default_queue(authed_api, run["id"]) == {}

        edited = _patch_steps(
            authed_api,
            run,
            steps=[
                _input_step(),
                _invocation_step("auto"),
                _auto_step(),
                _human_step(),
            ],
        )
        assert edited["flags"]["has_human"] is True
        assert edited["flags"]["is_queue"] is False
        assert _default_queue(authed_api, run["id"]) == {}

    def test_human_step_added_by_steps_add_to_automatic_run_gives_no_default_queue(
        self, authed_api
    ):
        run = _create_run(
            authed_api,
            steps=[_input_step(), _invocation_step("auto"), _auto_step()],
        )

        response = authed_api(
            "POST",
            f"/simple/evaluations/{run['id']}/steps/add",
            json={"steps": [_human_step()]},
        )
        assert response.status_code == 200, response.text
        edited = response.json()["run"]
        assert edited["flags"]["has_human"] is True
        assert edited["flags"]["is_queue"] is False
        assert _default_queue(authed_api, run["id"]) == {}

    def test_automatic_run_with_a_default_queue_has_it_archived_at_next_edit(
        self, authed_api
    ):
        # A default queue that an automatic run got before this rule stays
        # until the run's next edit, which archives it (nothing is deleted).
        steps = [_input_step(), _invocation_step("auto"), _human_step()]
        run = _create_run(authed_api, steps=steps)
        queue = create_queue(authed_api, run["id"], is_default=True)
        assert _default_queue(authed_api, run["id"])["id"] == queue["id"]

        edited = _patch_steps(authed_api, run, steps=steps)
        assert edited["flags"]["is_queue"] is False
        assert _default_queue(authed_api, run["id"]) == {}

    def test_human_run_keeps_its_default_queue(self, authed_api):
        run = _create_run(
            authed_api,
            steps=[_input_step(), _invocation_step("human"), _human_step()],
        )
        assert run["flags"]["has_human"] is True
        assert run["flags"]["is_queue"] is True
        assert _default_queue(authed_api, run["id"]).get("id")

    def test_simple_queue_keeps_its_default_queue(self, authed_api):
        evaluator = create_mock_evaluator(authed_api)
        queue = create_testcases_queue(authed_api, evaluator=evaluator)

        response = authed_api("GET", f"/evaluations/runs/{queue['run_id']}")
        assert response.status_code == 200, response.text
        assert response.json()["run"]["flags"]["is_queue"] is True
        assert _default_queue(authed_api, queue["run_id"]).get("id")
