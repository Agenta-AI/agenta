"""
Default-queue reconciliation state machine.

`_reconcile_default_queue` runs after every create/edit of a run and brings the
default queue + `run.flags.is_queue` in line with the run graph:

    should_exist = EVALUATIONS_DEFAULT_QUEUES_FOR_ALL_RUNS or has_human

    required + missing   -> create default queue
    required + archived  -> unarchive default queue
    required + active    -> no-op
    not-required + active -> archive default queue

`is_queue == has_human AND an active default queue exists`.

Driven through `/evaluations/runs/` (create + PATCH steps) — no worker needed;
reconciliation is synchronous in the create/edit path.
"""

from uuid import uuid4


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
    response = authed_api("GET", f"/evaluations/runs/{run_id}/default-queue")
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
