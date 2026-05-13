from uuid import uuid4


def _create_run(authed_api, name: str = None) -> str:
    """Create a minimal evaluation run and return its ID."""
    response = authed_api(
        "POST",
        "/evaluations/runs/",
        json={"runs": [{"name": name or f"run-{uuid4()}"}]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    return data["runs"][0]["id"]


class TestEvaluationQueuesBasics:
    # -- create ----------------------------------------------------------------

    def test_create_evaluation_queues(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id = _create_run(authed_api)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/evaluations/queues/",
            json={
                "queues": [
                    {
                        "name": "test-queue-create",
                        "run_id": run_id,
                    }
                ]
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queues"][0]
        assert queue["name"] == "test-queue-create"
        assert queue["run_id"] == run_id
        assert "id" in queue
        # ----------------------------------------------------------------------

    def test_create_evaluation_queues_with_flags(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id = _create_run(authed_api)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/evaluations/queues/",
            json={
                "queues": [
                    {
                        "run_id": run_id,
                        "flags": {"is_sequential": True},
                    }
                ]
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queues"][0]
        assert queue["flags"]["is_sequential"] is True
        # ----------------------------------------------------------------------

    def test_create_multiple_evaluation_queues(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id_1 = _create_run(authed_api)
        run_id_2 = _create_run(authed_api)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/evaluations/queues/",
            json={
                "queues": [
                    {"name": "queue-1", "run_id": run_id_1},
                    {"name": "queue-2", "run_id": run_id_2},
                ]
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        names = {q["name"] for q in data["queues"]}
        assert names == {"queue-1", "queue-2"}
        # ----------------------------------------------------------------------

    # -- fetch -----------------------------------------------------------------

    def test_fetch_evaluation_queue(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id = _create_run(authed_api)
        create_resp = authed_api(
            "POST",
            "/evaluations/queues/",
            json={"queues": [{"name": "test-queue-fetch", "run_id": run_id}]},
        )
        assert create_resp.status_code == 200
        queue_id = create_resp.json()["queues"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/evaluations/queues/{queue_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queue"]
        assert queue["id"] == queue_id
        assert queue["name"] == "test-queue-fetch"
        assert queue["run_id"] == run_id
        # ----------------------------------------------------------------------

    def test_fetch_nonexistent_evaluation_queue(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/evaluations/queues/{uuid4()}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert (
            data.get("queue") is None
        )  # excluded when None (response_model_exclude_none)
        # ----------------------------------------------------------------------

    # -- query -----------------------------------------------------------------

    def test_query_evaluation_queues_empty_filter(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id = _create_run(authed_api)
        authed_api(
            "POST",
            "/evaluations/queues/",
            json={"queues": [{"name": "test-queue-query", "run_id": run_id}]},
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/evaluations/queues/query",
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 1
        assert isinstance(data["queues"], list)
        # ----------------------------------------------------------------------

    def test_query_evaluation_queues_by_run_id(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id = _create_run(authed_api)
        authed_api(
            "POST",
            "/evaluations/queues/",
            json={"queues": [{"name": "test-queue-query-by-run", "run_id": run_id}]},
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/evaluations/queues/query",
            json={"queue": {"run_id": run_id}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queues"][0]
        assert queue["run_id"] == run_id
        # ----------------------------------------------------------------------

    # -- edit ------------------------------------------------------------------

    def test_edit_evaluation_queue(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id = _create_run(authed_api)
        create_resp = authed_api(
            "POST",
            "/evaluations/queues/",
            json={"queues": [{"name": "before-edit", "run_id": run_id}]},
        )
        assert create_resp.status_code == 200
        queue_id = create_resp.json()["queues"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "PATCH",
            f"/evaluations/queues/{queue_id}",
            json={
                "queue": {
                    "id": queue_id,
                    "name": "after-edit",
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queue"]
        assert queue["id"] == queue_id
        assert queue["name"] == "after-edit"
        # ----------------------------------------------------------------------

    def test_edit_evaluation_queues_bulk(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id_1 = _create_run(authed_api)
        run_id_2 = _create_run(authed_api)
        create_resp = authed_api(
            "POST",
            "/evaluations/queues/",
            json={
                "queues": [
                    {"name": "bulk-edit-1", "run_id": run_id_1},
                    {"name": "bulk-edit-2", "run_id": run_id_2},
                ]
            },
        )
        assert create_resp.status_code == 200
        queues = create_resp.json()["queues"]
        queue_id_1 = queues[0]["id"]
        queue_id_2 = queues[1]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "PATCH",
            "/evaluations/queues/",
            json={
                "queues": [
                    {"id": queue_id_1, "name": "bulk-edited-1"},
                    {"id": queue_id_2, "name": "bulk-edited-2"},
                ]
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        names = {q["name"] for q in data["queues"]}
        assert names == {"bulk-edited-1", "bulk-edited-2"}
        # ----------------------------------------------------------------------

    # -- delete ----------------------------------------------------------------

    def test_delete_evaluation_queue(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id = _create_run(authed_api)
        create_resp = authed_api(
            "POST",
            "/evaluations/queues/",
            json={"queues": [{"name": "to-delete", "run_id": run_id}]},
        )
        assert create_resp.status_code == 200
        queue_id = create_resp.json()["queues"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/evaluations/queues/{queue_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        assert data["queue_id"] == queue_id
        # ----------------------------------------------------------------------

        # VERIFY ---------------------------------------------------------------
        fetch_resp = authed_api(
            "GET",
            f"/evaluations/queues/{queue_id}",
        )
        assert fetch_resp.status_code == 200
        assert fetch_resp.json()["count"] == 0
        # ----------------------------------------------------------------------

    def test_delete_evaluation_queues_bulk(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        run_id_1 = _create_run(authed_api)
        run_id_2 = _create_run(authed_api)
        create_resp = authed_api(
            "POST",
            "/evaluations/queues/",
            json={
                "queues": [
                    {"run_id": run_id_1},
                    {"run_id": run_id_2},
                ]
            },
        )
        assert create_resp.status_code == 200
        queues = create_resp.json()["queues"]
        queue_id_1 = queues[0]["id"]
        queue_id_2 = queues[1]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/evaluations/queues/",
            json={"queue_ids": [queue_id_1, queue_id_2]},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 2
        deleted_ids = set(data["queue_ids"])
        assert queue_id_1 in deleted_ids
        assert queue_id_2 in deleted_ids
        # ----------------------------------------------------------------------

    def test_delete_nonexistent_queues_returns_empty(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/evaluations/queues/",
            json={"queue_ids": [str(uuid4()), str(uuid4())]},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        # ----------------------------------------------------------------------

    # -- scenarios -------------------------------------------------------------

    def test_query_evaluation_queue_scenarios_returns_empty_for_new_queue(
        self, authed_api
    ):
        # ARRANGE --------------------------------------------------------------
        run_id = _create_run(authed_api)
        create_resp = authed_api(
            "POST",
            "/evaluations/queues/",
            json={"queues": [{"run_id": run_id}]},
        )
        assert create_resp.status_code == 200
        queue_id = create_resp.json()["queues"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/evaluations/queues/{queue_id}/scenarios/query",
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert data["scenarios"] == []
        # ----------------------------------------------------------------------
