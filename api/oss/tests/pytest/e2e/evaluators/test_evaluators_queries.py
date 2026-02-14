from uuid import uuid4

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE ------------------------------------------------------------------
    _format = {
        "type": "object",
        "properties": {
            "id": {"type": "integer"},
            "score": {"type": "number"},
            "name": {"type": "string"},
            "active": {"type": "boolean"},
            "meta": {
                "type": "object",
                "properties": {
                    "version": {"type": "integer"},
                    "notes": {"type": "string"},
                },
                "required": ["version"],
            },
        },
        "required": ["id", "name"],
    }

    evaluator_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/simple/evaluators/",
        json={
            "evaluator": {
                "slug": f"evaluator-{evaluator_slug}",
                "name": f"Evaluator {evaluator_slug}",
                "description": "Evaluator Description",
                "flags": {
                    "is_custom": False,
                    "is_evaluator": False,
                    "is_human": False,
                },
                "tags": {
                    "tag1": "value1",
                    "tag2": "value2",
                    "tag3": "value3",
                },
                "meta": {
                    "meta1": "value1",
                    "meta2": "value2",
                    "meta3": "value3",
                },
                "data": {
                    "service": {
                        "agenta": "v0.1.0",
                        "format": _format,
                    }
                },
            }
        },
    )

    assert response.status_code == 200
    response = response.json()
    assert response["count"] == 1

    evaluator_1 = response["evaluator"]

    evaluator_slug = uuid4()

    response = authed_api(
        "POST",
        "/preview/simple/evaluators/",
        json={
            "evaluator": {
                "slug": f"evaluator-{evaluator_slug}",
                "name": f"Evaluator {evaluator_slug}",
                "description": "Evaluator Description",
                "flags": {
                    "is_custom": False,
                    "is_evaluator": False,
                    "is_human": False,
                },
                "tags": {
                    "tag1": "value3",
                    "tag2": "value2",
                    "tag3": "value1",
                },
                "meta": {
                    "meta1": "value3",
                    "meta2": "value2",
                    "meta3": "value1",
                },
                "data": {
                    "service": {
                        "agenta": "v0.1.0",
                        "format": _format,
                    }
                },
            }
        },
    )

    assert response.status_code == 200
    response = response.json()
    assert response["count"] == 1

    evaluator_2 = response["evaluator"]

    response = authed_api(
        "POST",
        f"/preview/simple/evaluators/{evaluator_2['id']}/archive",
    )

    assert response.status_code == 200
    response = response.json()
    assert response["count"] == 1
    assert response["evaluator"]["id"] == evaluator_2["id"]
    assert response["evaluator"]["deleted_at"] is not None

    _mock_data = {
        "evaluators": [evaluator_1, evaluator_2],
    }
    # --------------------------------------------------------------------------

    return _mock_data


class TestEvaluatorsQueries:
    def test_query_non_archived_evaluators(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/evaluators/query",
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        evaluator_ids = [e["id"] for e in response["evaluators"]]
        assert mock_data["evaluators"][0]["id"] in evaluator_ids
        assert mock_data["evaluators"][1]["id"] not in evaluator_ids  # archived
        # ----------------------------------------------------------------------

    def test_query_all_evaluators(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/evaluators/query",
            json={
                "include_archived": True,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        evaluator_ids = [e["id"] for e in response["evaluators"]]
        assert mock_data["evaluators"][0]["id"] in evaluator_ids
        assert mock_data["evaluators"][1]["id"] in evaluator_ids
        # ----------------------------------------------------------------------

    def test_query_paginated_evaluators(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        # First, get total count with include_archived
        response = authed_api(
            "POST",
            "/preview/simple/evaluators/query",
            json={
                "include_archived": True,
            },
        )
        assert response.status_code == 200
        total_evaluators = response.json()["evaluators"]
        total_count = len(total_evaluators)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        # Page through all evaluators one by one
        seen_ids = []
        next_cursor = None
        for _ in range(total_count):
            windowing = {"limit": 1}
            if next_cursor:
                windowing["next"] = next_cursor
            response = authed_api(
                "POST",
                "/preview/simple/evaluators/query",
                json={
                    "include_archived": True,
                    "windowing": windowing,
                },
            )
            assert response.status_code == 200
            response = response.json()
            assert response["count"] == 1
            seen_ids.append(response["evaluators"][0]["id"])
            next_cursor = response["evaluators"][0]["id"]
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        # Verify all evaluators were seen
        assert len(seen_ids) == total_count
        for e in total_evaluators:
            assert e["id"] in seen_ids

        # Verify next page is empty
        response = authed_api(
            "POST",
            "/preview/simple/evaluators/query",
            json={
                "include_archived": True,
                "windowing": {"limit": 1, "next": next_cursor},
            },
        )
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_query_evaluators_by_flags(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/evaluators/query",
            json={
                "evaluator": {
                    "flags": mock_data["evaluators"][0]["flags"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] >= 1
        evaluator_ids = [e["id"] for e in response["evaluators"]]
        assert mock_data["evaluators"][0]["id"] in evaluator_ids
        # ----------------------------------------------------------------------

    def test_query_evaluators_by_tags(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/evaluators/query",
            json={
                "evaluator": {
                    "tags": mock_data["evaluators"][0]["tags"],
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluators"][0]["id"] == mock_data["evaluators"][0]["id"]
        # ----------------------------------------------------------------------
