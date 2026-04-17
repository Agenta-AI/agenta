from uuid import uuid4


def _create_simple_query(authed_api) -> dict:
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
                                "field": "attributes",
                                "key": f"test-key-{slug[:8]}",
                                "value": "test-value",
                                "operator": "is",
                            }
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
