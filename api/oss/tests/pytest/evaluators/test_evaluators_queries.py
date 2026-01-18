from uuid import uuid4
from json import dumps
from urllib.parse import quote

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
        "/v2/simple/evaluators/",
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
        "/v2/simple/evaluators/",
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
        f"/v2/simple/evaluators/{evaluator_2['id']}/archive",
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
            "POST",  # TODO: FIX ME
            "/v2/simple/evaluators/query",  # TODO: FIX ME
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluators"][0]["id"] == mock_data["evaluators"][0]["id"]
        # ----------------------------------------------------------------------

    def test_query_all_evaluators(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",  # TODO: FIX ME
            "/v2/simple/evaluators/query",  # TODO: FIX ME
            json={
                "include_archived": True,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert len(response["evaluators"]) == 2
        assert response["evaluators"][0]["id"] == mock_data["evaluators"][0]["id"]
        assert response["evaluators"][1]["id"] == mock_data["evaluators"][1]["id"]
        # ----------------------------------------------------------------------

    def test_query_paginated_evaluators(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",  # TODO: FIX ME
            "/v2/simple/evaluators/query",  # TODO: FIX ME
            json={
                "include_archived": True,
                "windowing": {"limit": 1},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluators"][0]["id"] == mock_data["evaluators"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",  # TODO: FIX ME
            "/v2/simple/evaluators/query",  # TODO: FIX ME
            json={
                "include_archived": True,
                "windowing": {"limit": 1, "next": response["evaluators"][0]["id"]},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluators"][0]["id"] == mock_data["evaluators"][1]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",  # TODO: FIX ME
            "/v2/simple/evaluators/query",  # TODO: FIX ME
            json={
                "include_archived": True,
                "windowing": {"limit": 1, "next": response["evaluators"][0]["id"]},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
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
        # flags = quote(dumps(mock_data["evaluators"][0]["flags"]))
        response = authed_api(
            "POST",  # TODO: FIX ME
            "/v2/simple/evaluators/query",  # TODO: FIX ME
            json={
                "flags": mock_data["evaluators"][0]["flags"],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluators"][0]["id"] == mock_data["evaluators"][0]["id"]
        # ----------------------------------------------------------------------

    def test_query_evaluators_by_tags(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        # tags = quote(dumps(mock_data["evaluators"][0]["tags"]))
        response = authed_api(
            "POST",  # TODO: FIX ME
            "/v2/simple/evaluators/query",  # TODO: FIX ME,
            json={
                "tags": mock_data["evaluators"][0]["tags"],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluators"][0]["id"] == mock_data["evaluators"][0]["id"]
        # ----------------------------------------------------------------------

    def test_query_evaluators_by_meta(
        self,
        authed_api,
        mock_data,
    ):
        # ACT ------------------------------------------------------------------
        # meta = quote(dumps(mock_data["evaluators"][0]["meta"]))
        response = authed_api(
            "POST",  # TODO: FIX ME
            "/v2/simple/evaluators/query",  # TODO: FIX ME
            json={
                "meta": mock_data["evaluators"][0]["meta"],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["evaluators"][0]["id"] == mock_data["evaluators"][0]["id"]
        # ----------------------------------------------------------------------
