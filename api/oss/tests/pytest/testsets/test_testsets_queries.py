from uuid import uuid4
from tempfile import TemporaryFile
from csv import DictWriter
from json import dumps

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE ------------------------------------------------------------------
    slug = uuid4().hex

    tags = {"tag1": "value1", "tag2": "value2"}
    meta = {"meta1": "value1", "meta2": "value2"}

    testcases_data = [
        {"column1": "data1", "column2": "data2", "column3": "data3"},
        {"column1": "data6", "column2": "data5", "column3": "data4"},
    ]

    testcases = [{"data": testcase_data} for testcase_data in testcases_data]

    testset = {
        "slug": slug,
        "name": "Test Set Name",
        "description": "This is a test set description.",
        "tags": tags,
        "meta": meta,
        "data": {
            "testcases": testcases,
        },
    }

    response = authed_api(
        "POST",
        "/preview/simple/testsets/",
        json={
            "testset": testset,
        },
    )

    assert response.status_code == 200

    testset_1 = response.json()["testset"]

    slug = uuid4().hex

    tags = {"tag1": "value2", "tag2": "value1"}
    meta = {"meta1": "value2", "meta2": "value1"}

    testset = {
        "slug": slug,
        "name": "Another Test Set Name",
        "description": "This is another test set description.",
        "tags": tags,
        "meta": meta,
        "data": {
            "testcases": testcases,
        },
    }

    response = authed_api(
        "POST",
        "/preview/simple/testsets/",
        json={
            "testset": testset,
        },
    )

    assert response.status_code == 200

    testset_2 = response.json()["testset"]

    response = authed_api(
        "POST",
        f"/preview/simple/testsets/{testset_2['id']}/archive",
    )

    assert response.status_code == 200
    response = response.json()
    # --------------------------------------------------------------------------

    _mock_data = {
        "testsets": [testset_1, testset_2],
    }

    return _mock_data


class TestTestsetsQueries:
    def test_list_testsets(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            "/preview/simple/testsets/",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_query_testsets_non_archived(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            "/preview/simple/testsets/",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_query_testsets_all(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/testsets/query",
            json={
                "include_archived": True,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

    def test_query_testsets_by_tags(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/testsets/query",
            json={
                "testset": {
                    "tags": {
                        "tag1": "value1",
                    },
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testsets"][0]["id"] == mock_data["testsets"][0]["id"]
        # ----------------------------------------------------------------------

    def test_query_testsets_by_meta(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/testsets/query",
            json={
                "testset": {
                    "meta": {
                        "meta1": "value1",
                    },
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testsets"][0]["id"] == mock_data["testsets"][0]["id"]
        # ----------------------------------------------------------------------

    def test_query_testsets_by_refs(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/testsets/query",
            json={
                "testset_refs": [
                    {
                        "id": mock_data["testsets"][0]["id"],
                    },
                ],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testsets"][0]["id"] == mock_data["testsets"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/simple/testsets/query",
            json={
                "testset_refs": [
                    {
                        "slug": mock_data["testsets"][0]["slug"],
                    },
                ],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testsets"][0]["id"] == mock_data["testsets"][0]["id"]
        # ----------------------------------------------------------------------
