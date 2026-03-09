from uuid import uuid4

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
        {"column1": "data6", "column2": "data5", "column3": "data4"},
    ]

    testcases = [{"data": testcase_data} for testcase_data in testcases_data]

    testset = {
        "slug": slug,
        "name": "Testset Name",
        "description": "This is a testset description.",
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
        "name": "Another Testset Name",
        "description": "This is another testset description.",
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


class TestTestcasesBasics:
    def test_fetch_testcase(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        testset = mock_data["testsets"][0]
        testcases = testset["data"]["testcases"]
        testcase_id = testcases[0]["id"]

        response = authed_api(
            "GET",
            f"/preview/testcases/{testcase_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["testcase"]["id"] == testcase_id
        assert response["testcase"]["data"] == testcases[0]["data"]
        # ----------------------------------------------------------------------

    def test_list_testcases(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        testset = mock_data["testsets"][0]
        testset_id = testset["id"]

        response = authed_api(
            "POST",
            "/preview/testcases/query",
            json={
                "testset_id": testset_id,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == len(testset["data"]["testcases"])
        # ----------------------------------------------------------------------

    def test_query_testcases_by_testcase_ids(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        testset = mock_data["testsets"][0]
        testcases = testset["data"]["testcases"]
        testcase_ids = [testcase["id"] for testcase in testcases]

        response = authed_api(
            "POST",
            "/preview/testcases/query",
            json={
                "testcase_ids": testcase_ids,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == len(testcase_ids)
        # ----------------------------------------------------------------------

    def test_query_testcases_by_testset_id(self, authed_api, mock_data):
        # ACT ------------------------------------------------------------------
        testset = mock_data["testsets"][0]
        testset_id = testset["id"]

        response = authed_api(
            "POST",
            "/preview/testcases/query",
            json={
                "testset_id": testset_id,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == len(testset["data"]["testcases"])
        # ----------------------------------------------------------------------

    def test_query_testcases_by_testset_revision_ref(self, authed_api, mock_data):
        """
        POST /preview/testcases/query with testset_revision_ref should resolve
        the revision's stored testcase_ids list and return those testcases.
        This exercises the B.2 loadable strategy for testsets.
        """
        # ACT ------------------------------------------------------------------
        testset = mock_data["testsets"][0]
        testset_revision_id = testset["revision_id"]

        response = authed_api(
            "POST",
            "/preview/testcases/query",
            json={
                "testset_revision_ref": {"id": testset_revision_id},
                "windowing": {"limit": 100},
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == len(testset["data"]["testcases"])
        returned_ids = {tc["id"] for tc in body["testcases"]}
        expected_ids = {tc["id"] for tc in testset["data"]["testcases"]}
        assert returned_ids == expected_ids
        # ----------------------------------------------------------------------

    def test_query_testcases_without_filter_returns_400(self, authed_api):
        """
        POST /preview/testcases/query with no filter fields returns 400 —
        the endpoint requires at least one of: testcase_ids, testset_id,
        or a testset_ref.
        """
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/testcases/query",
            json={},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 400
        # ----------------------------------------------------------------------

    def test_fetch_testcases_by_ids_query_param(self, authed_api, mock_data):
        """
        GET /preview/testcases/?testcase_ids=<id1>,<id2> fetches testcases
        by comma-separated query param.
        """
        # ACT ------------------------------------------------------------------
        testset = mock_data["testsets"][0]
        testcases = testset["data"]["testcases"]
        ids_csv = ",".join(tc["id"] for tc in testcases[:2])

        response = authed_api(
            "GET",
            f"/preview/testcases/?testcase_ids={ids_csv}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 2
        # ----------------------------------------------------------------------

    def test_fetch_testcases_no_ids_returns_400(self, authed_api):
        """
        GET /preview/testcases/ with no id params returns 400.
        """
        # ACT ------------------------------------------------------------------
        response = authed_api("GET", "/preview/testcases/")
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 400
        # ----------------------------------------------------------------------
