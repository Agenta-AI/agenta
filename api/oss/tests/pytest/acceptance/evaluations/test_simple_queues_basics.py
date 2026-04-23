from uuid import uuid4


def _create_evaluator(authed_api) -> str:
    """Create a minimal evaluator and return its revision ID."""
    slug = uuid4()
    response = authed_api(
        "POST",
        "/simple/evaluators/",
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
    return data["evaluator"]["revision_id"]


def _create_query(authed_api) -> str:
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/queries/",
        json={
            "query": {
                "slug": f"query-{slug}",
                "name": f"Query {slug}",
                "data": {
                    "filtering": {
                        "operator": "and",
                        "conditions": [
                            {
                                "field": "trace_type",
                                "operator": "is",
                                "value": "invocation",
                            }
                        ],
                    }
                },
            }
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    return data["query"]["revision_id"]


def _create_testset(authed_api) -> str:
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/testsets/",
        json={
            "testset": {
                "slug": slug,
                "name": f"Testset {slug}",
                "data": {
                    "testcases": [
                        {"data": {"input": "hello", "expected": "world"}},
                        {"data": {"input": "hola", "expected": "mundo"}},
                    ]
                },
            }
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["count"] == 1
    return data["testset"]["revision_id"]


class TestSimpleQueuesBasics:
    # -- create ----------------------------------------------------------------

    def test_create_simple_queue_testcases_kind(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_revision_id = _create_evaluator(authed_api)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-testcases",
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_revision_id],
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
        evaluator_revision_id = _create_evaluator(authed_api)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-traces",
                    "data": {
                        "kind": "traces",
                        "evaluators": [evaluator_revision_id],
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

    def test_create_simple_queue_from_queries(self, authed_api):
        evaluator_revision_id = _create_evaluator(authed_api)
        query_revision_id = _create_query(authed_api)

        response = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "name": "query-backed-queue",
                    "data": {
                        "queries": [query_revision_id],
                        "evaluators": [evaluator_revision_id],
                    },
                }
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queue"]
        assert queue["data"]["kind"] == "traces"
        assert queue["data"]["queries"] == [query_revision_id]

    def test_create_simple_queue_from_testsets(self, authed_api):
        evaluator_revision_id = _create_evaluator(authed_api)
        testset_revision_id = _create_testset(authed_api)

        response = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "name": "testset-backed-queue",
                    "data": {
                        "testsets": [testset_revision_id],
                        "evaluators": [evaluator_revision_id],
                    },
                }
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 1
        queue = data["queue"]
        assert queue["data"]["kind"] == "testcases"
        assert queue["data"]["testsets"] == [testset_revision_id]

    def test_create_simple_queue_without_evaluators_returns_empty(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/queues/",
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

    def test_add_traces_rejects_query_backed_source_queue(self, authed_api):
        evaluator_revision_id = _create_evaluator(authed_api)
        query_revision_id = _create_query(authed_api)
        create_response = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "queries": [query_revision_id],
                        "evaluators": [evaluator_revision_id],
                    },
                }
            },
        )
        assert create_response.status_code == 200
        queue_id = create_response.json()["queue"]["id"]

        response = authed_api(
            "POST",
            f"/simple/queues/{queue_id}/traces/",
            json={"trace_ids": ["trace-1"]},
        )

        assert response.status_code == 400
        data = response.json()
        assert (
            data["detail"]["message"]
            == "Cannot add traces directly to a source-backed queue. Create a direct traces queue instead."
        )

    def test_add_testcases_rejects_testset_backed_source_queue(self, authed_api):
        evaluator_revision_id = _create_evaluator(authed_api)
        testset_revision_id = _create_testset(authed_api)
        create_response = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "testsets": [testset_revision_id],
                        "evaluators": [evaluator_revision_id],
                    },
                }
            },
        )
        assert create_response.status_code == 200
        queue_id = create_response.json()["queue"]["id"]

        response = authed_api(
            "POST",
            f"/simple/queues/{queue_id}/testcases/",
            json={"testcase_ids": [str(uuid4())]},
        )

        assert response.status_code == 400
        data = response.json()
        assert (
            data["detail"]["message"]
            == "Cannot add testcases directly to a source-backed queue. Create a direct testcases queue instead."
        )

    def test_create_simple_queue_rejects_kind_with_queries(self, authed_api):
        evaluator_revision_id = _create_evaluator(authed_api)
        query_revision_id = _create_query(authed_api)

        response = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "kind": "traces",
                        "queries": [query_revision_id],
                        "evaluators": [evaluator_revision_id],
                    },
                }
            },
        )

        assert response.status_code == 422
        assert (
            "simple queue source must not include kind alongside queries or testsets"
            in response.text
        )

    def test_create_simple_queue_with_assignments(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        evaluator_revision_id = _create_evaluator(authed_api)
        user_id_1 = str(uuid4())
        user_id_2 = str(uuid4())
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-assignments",
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_revision_id],
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
        evaluator_revision_id = _create_evaluator(authed_api)
        create_resp = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-to-fetch",
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_revision_id],
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
            f"/simple/queues/{queue_id}",
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
            f"/simple/queues/{uuid4()}",
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
        evaluator_revision_id = _create_evaluator(authed_api)
        authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_revision_id],
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/queues/query",
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
        evaluator_revision_id = _create_evaluator(authed_api)
        authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_revision_id],
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/simple/queues/query",
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
        evaluator_revision_id = _create_evaluator(authed_api)
        create_resp = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "name": "test-queue-query-by-run",
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_revision_id],
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
            "/simple/queues/query",
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
        evaluator_revision_id = _create_evaluator(authed_api)
        create_resp = authed_api(
            "POST",
            "/simple/queues/",
            json={
                "queue": {
                    "data": {
                        "kind": "testcases",
                        "evaluators": [evaluator_revision_id],
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
            f"/simple/queues/{queue_id}/scenarios/query",
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        data = response.json()
        assert data["count"] == 0
        assert data["scenarios"] == []
        # ----------------------------------------------------------------------
