"""
Default-queue policy + validation.

A *default* queue (`flags.is_default=True`) is a system-managed worklist tied to
a run's human evaluators. It must not carry per-user/scenario/step/batch filters,
must not be demoted to a normal queue, and must not be hard-deleted (archive
instead). These are enforced in the service layer with typed domain exceptions
(`DefaultQueueDataInvalid` -> 422, `DefaultQueueDemotionForbidden` /
`DefaultQueueDeletionForbidden` -> 409).

These tests drive the `/evaluations/queues/` HTTP surface directly — no worker.
"""

from uuid import uuid4

import pytest


def _create_run(authed_api, name=None) -> str:
    response = authed_api(
        "POST",
        "/evaluations/runs/",
        json={"runs": [{"name": name or f"run-{uuid4()}"}]},
    )
    assert response.status_code == 200, response.text
    return response.json()["runs"][0]["id"]


def _create_queue(authed_api, run_id, *, flags=None, data=None, name=None):
    queue = {"run_id": run_id}
    if name:
        queue["name"] = name
    if flags is not None:
        queue["flags"] = flags
    if data is not None:
        queue["data"] = data
    return authed_api("POST", "/evaluations/queues/", json={"queues": [queue]})


class TestDefaultQueueDataValidation:
    # A default queue may not carry scenario/step/assignment/batch filters.

    @pytest.mark.parametrize(
        "field,value",
        [
            ("user_ids", [[str(uuid4())]]),
            ("scenario_ids", [str(uuid4())]),
            ("step_keys", ["annotation"]),
            ("batch_size", 5),
            ("batch_offset", 0),
        ],
        ids=["user_ids", "scenario_ids", "step_keys", "batch_size", "batch_offset"],
    )
    def test_default_queue_with_filter_field_is_rejected(
        self, authed_api, field, value
    ):
        run_id = _create_run(authed_api)
        response = _create_queue(
            authed_api,
            run_id,
            flags={"is_default": True},
            data={field: value},
        )
        # DefaultQueueDataInvalid -> 422
        assert response.status_code == 422, response.text

    def test_non_default_queue_may_carry_filter_fields(self, authed_api):
        run_id = _create_run(authed_api)
        response = _create_queue(
            authed_api,
            run_id,
            flags={"is_default": False},
            data={"step_keys": ["annotation"], "batch_size": 5},
        )
        assert response.status_code == 200, response.text
        assert response.json()["count"] == 1

    def test_default_queue_without_filters_is_accepted(self, authed_api):
        run_id = _create_run(authed_api)
        response = _create_queue(
            authed_api,
            run_id,
            flags={"is_default": True},
            data={},
        )
        assert response.status_code == 200, response.text
        assert response.json()["count"] == 1


class TestDefaultQueueDemotionForbidden:
    def _create_default_queue(self, authed_api):
        run_id = _create_run(authed_api)
        resp = _create_queue(authed_api, run_id, flags={"is_default": True})
        assert resp.status_code == 200, resp.text
        return resp.json()["queues"][0]["id"]

    def test_demoting_default_queue_is_forbidden(self, authed_api):
        queue_id = self._create_default_queue(authed_api)
        response = authed_api(
            "PATCH",
            f"/evaluations/queues/{queue_id}",
            json={"queue": {"id": queue_id, "flags": {"is_default": False}}},
        )
        # DefaultQueueDemotionForbidden -> 409
        assert response.status_code == 409, response.text

    def test_keeping_default_flag_on_edit_is_allowed(self, authed_api):
        queue_id = self._create_default_queue(authed_api)
        response = authed_api(
            "PATCH",
            f"/evaluations/queues/{queue_id}",
            json={
                "queue": {
                    "id": queue_id,
                    "name": "renamed",
                    "flags": {"is_default": True},
                }
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["queue"]["name"] == "renamed"

    def test_promoting_normal_queue_to_default_is_allowed(self, authed_api):
        run_id = _create_run(authed_api)
        resp = _create_queue(authed_api, run_id, flags={"is_default": False})
        assert resp.status_code == 200, resp.text
        queue_id = resp.json()["queues"][0]["id"]
        response = authed_api(
            "PATCH",
            f"/evaluations/queues/{queue_id}",
            json={"queue": {"id": queue_id, "flags": {"is_default": True}}},
        )
        assert response.status_code == 200, response.text


class TestDefaultQueueArchiveForbidden:
    # Default queues are system-managed: their archive/unarchive lifecycle is
    # driven by run reconciliation, not by direct user action. The user-facing
    # archive endpoint refuses a default (DefaultQueueArchiveForbidden -> 409).

    def test_archiving_default_queue_is_forbidden(self, authed_api):
        run_id = _create_run(authed_api)
        resp = _create_queue(authed_api, run_id, flags={"is_default": True})
        assert resp.status_code == 200, resp.text
        queue_id = resp.json()["queues"][0]["id"]

        response = authed_api("POST", f"/evaluations/queues/{queue_id}/archive")
        # DefaultQueueArchiveForbidden -> 409
        assert response.status_code == 409, response.text

    def test_archiving_normal_queue_is_allowed(self, authed_api):
        run_id = _create_run(authed_api)
        resp = _create_queue(authed_api, run_id, flags={"is_default": False})
        assert resp.status_code == 200, resp.text
        queue_id = resp.json()["queues"][0]["id"]

        response = authed_api("POST", f"/evaluations/queues/{queue_id}/archive")
        assert response.status_code == 200, response.text


class TestDefaultQueueDeletionForbidden:
    def test_hard_deleting_default_queue_is_forbidden(self, authed_api):
        run_id = _create_run(authed_api)
        resp = _create_queue(authed_api, run_id, flags={"is_default": True})
        assert resp.status_code == 200, resp.text
        queue_id = resp.json()["queues"][0]["id"]

        response = authed_api("DELETE", f"/evaluations/queues/{queue_id}")
        # DefaultQueueDeletionForbidden -> 409
        assert response.status_code == 409, response.text

    def test_hard_deleting_normal_queue_is_allowed(self, authed_api):
        run_id = _create_run(authed_api)
        resp = _create_queue(authed_api, run_id, flags={"is_default": False})
        assert resp.status_code == 200, resp.text
        queue_id = resp.json()["queues"][0]["id"]

        response = authed_api("DELETE", f"/evaluations/queues/{queue_id}")
        assert response.status_code == 200, response.text
        assert response.json()["count"] == 1

    def test_bulk_delete_including_default_queue_is_forbidden(self, authed_api):
        run_id_1 = _create_run(authed_api)
        run_id_2 = _create_run(authed_api)
        normal = _create_queue(authed_api, run_id_1, flags={"is_default": False})
        default = _create_queue(authed_api, run_id_2, flags={"is_default": True})
        normal_id = normal.json()["queues"][0]["id"]
        default_id = default.json()["queues"][0]["id"]

        response = authed_api(
            "DELETE",
            "/evaluations/queues/",
            json={"queue_ids": [normal_id, default_id]},
        )
        assert response.status_code == 409, response.text


class TestDefaultQueueUniqueness:
    # At most one default queue per run for the run's lifetime (active OR
    # archived), enforced by the partial unique index
    # ux_evaluation_queues_default_per_run; create_queue surfaces the unique
    # violation as an EntityCreationConflict (409).

    def test_second_default_queue_for_same_run_is_rejected(self, authed_api):
        run_id = _create_run(authed_api)
        first = _create_queue(authed_api, run_id, flags={"is_default": True})
        assert first.status_code == 200, first.text
        assert first.json()["count"] == 1

        second = _create_queue(authed_api, run_id, flags={"is_default": True})
        # The second default queue is rejected as a creation conflict.
        assert second.json().get("count", 0) == 0, second.text

    def test_default_queues_allowed_across_different_runs(self, authed_api):
        run_id_1 = _create_run(authed_api)
        run_id_2 = _create_run(authed_api)
        first = _create_queue(authed_api, run_id_1, flags={"is_default": True})
        second = _create_queue(authed_api, run_id_2, flags={"is_default": True})
        assert first.json()["count"] == 1, first.text
        assert second.json()["count"] == 1, second.text
