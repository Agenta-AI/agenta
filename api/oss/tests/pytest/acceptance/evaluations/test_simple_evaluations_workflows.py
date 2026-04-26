from uuid import uuid4


def _create_simple_query(authed_api, *, trace_type: str = "invocation") -> dict:
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
                                "value": trace_type,
                                "operator": "is",
                            },
                            {
                                "field": "attributes",
                                "key": f"test-key-{slug[:8]}",
                                "value": "test-value",
                                "operator": "is",
                            },
                        ],
                    }
                },
            }
        },
    )
    assert response.status_code == 200
    return response.json()["query"]


def _create_simple_evaluator(authed_api) -> dict:
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/evaluators/",
        json={
            "evaluator": {
                "slug": f"evaluator-{slug}",
                "name": f"Evaluator {slug}",
                "data": {
                    "schemas": {
                        "outputs": {
                            "type": "object",
                            "properties": {
                                "score": {"type": "number"},
                            },
                            "required": ["score"],
                            "additionalProperties": False,
                        }
                    }
                },
            }
        },
    )
    assert response.status_code == 200
    return response.json()["evaluator"]


def _create_simple_testset(authed_api) -> dict:
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/testsets/",
        json={
            "testset": {
                "slug": f"testset-{slug}",
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
    return response.json()["testset"]


def _create_simple_application(authed_api) -> dict:
    slug = uuid4().hex
    response = authed_api(
        "POST",
        "/simple/applications/",
        json={
            "application": {
                "slug": f"application-{slug}",
                "name": f"Application {slug}",
            }
        },
    )
    assert response.status_code == 200
    return response.json()["application"]


class TestSimpleEvaluationsWorkflowReferences:
    def test_create_live_simple_evaluation_accepts_query_and_evaluator_revision_ids(
        self, authed_api
    ):
        query = _create_simple_query(authed_api)
        evaluator = _create_simple_evaluator(authed_api)

        response = authed_api(
            "POST",
            "/simple/evaluations/",
            json={
                "evaluation": {
                    "name": "live-workflow-backed-evaluation",
                    "flags": {
                        "is_live": True,
                    },
                    "data": {
                        "query_steps": [query["revision_id"]],
                        "evaluator_steps": [evaluator["revision_id"]],
                    },
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1

        evaluation = body["evaluation"]
        assert set(evaluation["data"]["query_steps"].keys()) == {query["revision_id"]}
        assert set(evaluation["data"]["evaluator_steps"].keys()) == {
            evaluator["revision_id"]
        }

    def test_create_live_simple_evaluation_rejects_non_invocation_query_revision(
        self, authed_api
    ):
        query = _create_simple_query(authed_api, trace_type="annotation")
        evaluator = _create_simple_evaluator(authed_api)

        response = authed_api(
            "POST",
            "/simple/evaluations/",
            json={
                "evaluation": {
                    "name": "live-non-invocation-query-rejected",
                    "flags": {
                        "is_live": True,
                    },
                    "data": {
                        "query_steps": [query["revision_id"]],
                        "evaluator_steps": [evaluator["revision_id"]],
                    },
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 0
        assert body.get("evaluation") is None

    def test_create_batch_inference_evaluation_preserves_flags_repeats_and_refs(
        self, authed_api
    ):
        testset = _create_simple_testset(authed_api)
        application = _create_simple_application(authed_api)

        response = authed_api(
            "POST",
            "/simple/evaluations/",
            json={
                "evaluation": {
                    "name": "batch-inference-setup",
                    "flags": {
                        "is_cached": True,
                        "is_split": True,
                    },
                    "data": {
                        "testset_steps": [testset["revision_id"]],
                        "application_steps": [application["revision_id"]],
                        "repeats": 3,
                    },
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1

        evaluation = body["evaluation"]
        assert evaluation["flags"]["is_cached"] is True
        assert evaluation["flags"]["is_split"] is True
        assert evaluation["data"]["repeats"] == 3
        assert set(evaluation["data"]["testset_steps"].keys()) == {
            testset["revision_id"]
        }
        assert set(evaluation["data"]["application_steps"].keys()) == {
            application["revision_id"]
        }

    def test_create_batch_evaluation_preserves_application_evaluator_matrix(
        self, authed_api
    ):
        testset = _create_simple_testset(authed_api)
        application = _create_simple_application(authed_api)
        evaluator = _create_simple_evaluator(authed_api)

        response = authed_api(
            "POST",
            "/simple/evaluations/",
            json={
                "evaluation": {
                    "name": "batch-application-evaluator-setup",
                    "flags": {
                        "is_cached": False,
                        "is_split": False,
                    },
                    "data": {
                        "testset_steps": {testset["revision_id"]: "custom"},
                        "application_steps": {application["revision_id"]: "custom"},
                        "evaluator_steps": {evaluator["revision_id"]: "auto"},
                        "repeats": 2,
                    },
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1

        evaluation = body["evaluation"]
        assert evaluation["flags"]["is_cached"] is False
        assert evaluation["flags"]["is_split"] is False
        assert evaluation["data"]["repeats"] == 2
        assert evaluation["data"]["testset_steps"] == {testset["revision_id"]: "custom"}
        assert evaluation["data"]["application_steps"] == {
            application["revision_id"]: "custom"
        }
        assert evaluation["data"]["evaluator_steps"] == {
            evaluator["revision_id"]: "auto"
        }

    def test_create_testset_to_evaluator_evaluation_does_not_fail_setup(
        self, authed_api
    ):
        testset = _create_simple_testset(authed_api)
        evaluator = _create_simple_evaluator(authed_api)

        response = authed_api(
            "POST",
            "/simple/evaluations/",
            json={
                "evaluation": {
                    "name": "testset-to-evaluator-setup",
                    "data": {
                        "testset_steps": [testset["revision_id"]],
                        "evaluator_steps": [evaluator["revision_id"]],
                    },
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        evaluation = body["evaluation"]
        assert set(evaluation["data"]["testset_steps"].keys()) == {
            testset["revision_id"]
        }
        assert set(evaluation["data"]["evaluator_steps"].keys()) == {
            evaluator["revision_id"]
        }

    def test_create_query_to_application_evaluation_does_not_fail_setup(
        self, authed_api
    ):
        query = _create_simple_query(authed_api)
        application = _create_simple_application(authed_api)

        response = authed_api(
            "POST",
            "/simple/evaluations/",
            json={
                "evaluation": {
                    "name": "query-to-application-setup",
                    "data": {
                        "query_steps": [query["revision_id"]],
                        "application_steps": [application["revision_id"]],
                    },
                }
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        evaluation = body["evaluation"]
        assert set(evaluation["data"]["query_steps"].keys()) == {query["revision_id"]}
        assert set(evaluation["data"]["application_steps"].keys()) == {
            application["revision_id"]
        }
