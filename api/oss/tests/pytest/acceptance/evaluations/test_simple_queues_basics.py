from uuid import uuid4


def _create_evaluator(authed_api) -> str:
    """Create a minimal evaluator and return its artifact ID."""
    slug = uuid4()
    response = authed_api(
        "POST",
        "/preview/simple/evaluators/",
        json={
            "evaluator": {
                "slug": f"evaluator-{slug}",
                "name": f"Test Evaluator {slug}",
                "data": {
                    "service": {
                        "agenta": "v0.1.0",
                        "format": {
                            "type": "object",
                            "properties": {
                                "score": {"type": "number"},
                            },
                        },
                    }
                },
            }
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    return data["evaluator"]["id"]


class TestSimpleQueuesBasics:
    # -- create ----------------------------------------------------------------

    def test_create_simple_queue_testcases_kind(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_id = _create_evaluator(authed_api)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-testcases",
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_id],
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queue"]
        assert "id" in queue
        assert "run_id" in queue
        # ----------------------------------------------------------------------

    def test_create_simple_queue_traces_kind(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_id = _create_evaluator(authed_api)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-traces",
                    "data": {
                        "kind": "traces",
                        "evaluators": [evaluator_id],
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queue"]
        assert "id" in queue
        assert "run_id" in queue
        # ----------------------------------------------------------------------

    def test_create_simple_queue_without_evaluators_returns_empty(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "kind": "testcases",
                    },
                }
            },
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

    def test_create_simple_queue_with_invalid_evaluator_returns_400(self, authed_api):
        # The router raises 400 when it cannot resolve the evaluator revision
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "kind": "testcases",
                        "evaluators": [str(uuid4())],
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 400
        # ----------------------------------------------------------------------

    def test_create_simple_queue_with_assignments(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_id = _create_evaluator(authed_api)
        user_id_1 = str(uuid4())
        user_id_2 = str(uuid4())
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-assignments",
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_id],
                        "assignments": [[user_id_1, user_id_2]],
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queue"]
        assert "id" in queue
        assert "run_id" in queue
        # ----------------------------------------------------------------------

    # -- fetch -----------------------------------------------------------------

    def test_fetch_simple_queue(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_id = _create_evaluator(authed_api)
        create_resp = authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-to-fetch",
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_id],
                    },
                }
            },
        )
        assert create_resp.status_code == 200
        queue_id = create_resp.json()["queue"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/simple/queues/{queue_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queue"]
        assert queue["id"] == queue_id
        assert queue["name"] == "test-queue-to-fetch"
        # ----------------------------------------------------------------------

    def test_fetch_nonexistent_simple_queue_returns_empty(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/simple/queues/{uuid4()}",
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

    def test_query_simple_queues_empty_filter(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_id = _create_evaluator(authed_api)
        authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_id],
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/queues/query",
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 1
        assert isinstance(data["queues"], list)
        # ----------------------------------------------------------------------

    def test_query_simple_queues_by_kind_testcases(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_id = _create_evaluator(authed_api)
        authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_id],
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/queues/query",
            json={"queue": {"kind": "testcases"}},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] >= 1
        # ----------------------------------------------------------------------

    def test_query_simple_queues_by_run_id(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_id = _create_evaluator(authed_api)
        create_resp = authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-query-by-run",
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_id],
                    },
                }
            },
        )
        assert create_resp.status_code == 200
        run_id = create_resp.json()["queue"]["run_id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/queues/query",
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

    # -- scenarios -------------------------------------------------------------

    def test_query_simple_queue_scenarios_empty_for_new_queue(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_id = _create_evaluator(authed_api)
        create_resp = authed_api(
            "POST",
            "/preview/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_id],
                    },
                }
            },
        )
        assert create_resp.status_code == 200
        queue_id = create_resp.json()["queue"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/simple/queues/{queue_id}/scenarios/query",
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert data["scenarios"] == []
        # ----------------------------------------------------------------------
