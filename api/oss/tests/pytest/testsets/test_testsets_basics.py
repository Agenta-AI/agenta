from uuid import uuid4
from tempfile import TemporaryFile
from csv import DictWriter
from json import dumps


class TestTestsetsBasics:
    def test_create_testsets(self, authed_api):
        # ACT ------------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

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
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1

        response_testcases = response["testset"]["data"]["testcases"]
        for testcase in response_testcases:
            del testcase["testcase_id"]

        assert response_testcases == testcases
        # ----------------------------------------------------------------------

    def test_fetch_testset(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

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

        testset_id = response.json()["testset"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/simple/testsets/{testset_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testset"]["id"] == testset_id
        assert response["testset"]["slug"] == slug
        assert response["testset"]["name"] == testset["name"]
        assert response["testset"]["description"] == testset["description"]
        assert response["testset"]["tags"] == tags
        assert response["testset"]["meta"] == meta

        response_testcases = response["testset"]["data"]["testcases"]
        for testcase in response_testcases:
            del testcase["testcase_id"]

        assert response_testcases == testcases
        # ----------------------------------------------------------------------

    def test_edit_testset(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

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

        testset_id = response.json()["testset"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        updated_testcases = [
            {"column1": "data6", "column2": "data5", "column3": "data4"},  # 1
            {"column1": "data4", "column2": "data5", "column3": "data6"},  # 2
            {"column1": "data4", "column2": "data5", "column3": "data6"},  # 2 (dedup)
        ]
        updated_testset = {
            "id": testset_id,
            **testset,
            "name": f"{testset['name']} - Updated",
            "description": f"{testset['description']} - Updated",
            "data": {
                "testcases": updated_testcases,
            },
        }

        response = authed_api(
            "PUT",
            f"/preview/simple/testsets/{testset_id}",
            json={
                "testset": updated_testset,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testset"]["id"] == testset_id
        assert response["testset"]["slug"] == slug
        assert response["testset"]["name"] == updated_testset["name"]
        assert response["testset"]["description"] == updated_testset["description"]
        assert response["testset"]["tags"] == tags
        assert response["testset"]["meta"] == meta

        assert len(response["testset"]["data"]["testcases"]) == 2
        # ----------------------------------------------------------------------

    def test_archive_testset(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

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

        testset_id = response.json()["testset"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/simple/testsets/{testset_id}/archive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_unarchive_testset(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

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

        testset_id = response.json()["testset"]["id"]

        response = authed_api(
            "POST",
            f"/preview/simple/testsets/{testset_id}/archive",
        )
        assert response.status_code == 200
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/simple/testsets/{testset_id}/unarchive",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------
