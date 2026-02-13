from uuid import uuid4


class TestTestsetsBasics:
    def test_create_testsets(self, authed_api):
        # ACT ------------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        testcases = [{"data": testcase_data} for testcase_data in testcases_data]

        testset = {
            "slug": slug,
            "name": "Testset Name",
            "description": "This is a testset description.",
            "tags": tags,
            "meta": meta,
            "data": {
                # "testcase_ids": None,
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

        response_testset = response["testset"]
        response_testcases = response_testset["data"]["testcases"]
        response_testcases_data = [testcase["data"] for testcase in response_testcases]

        assert len(response_testcases_data) == len(testcases_data)
        # ----------------------------------------------------------------------

    def test_create_testsets_with_dedup(self, authed_api):
        # ACT ------------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data1", "column2": "data2", "column3": "data3"},
        ]

        testcases = [{"data": testcase_data} for testcase_data in testcases_data]

        testset = {
            "slug": slug,
            "name": "Testset Name",
            "description": "This is a testset description.",
            "tags": tags,
            "meta": meta,
            "data": {
                # "testcase_ids": None,
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

        response_testset = response["testset"]
        response_testcases = response_testset["data"]["testcases"]
        response_testcases_data = [testcase["data"] for testcase in response_testcases]

        assert len(response_testcases_data) == len(testcases_data)
        # ----------------------------------------------------------------------

    def test_fetch_testset(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
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

        response_testset = response["testset"]
        response_testcases = response_testset["data"]["testcases"]
        response_testcases_data = [testcase["data"] for testcase in response_testcases]

        assert len(response_testcases_data) == len(testcases_data)
        # ----------------------------------------------------------------------

    def test_edit_testset_with_changes(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
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

        testset_id = response.json()["testset"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        updated_testcases_data = [
            {"column1": "data6", "column2": "data5", "column3": "data4"},  # 1
            {"column1": "data4", "column2": "data5", "column3": "data6"},  # 2
            {"column1": "data4", "column2": "data5", "column3": "data6"},  # 2 (dedup)
        ]

        updated_testcases = [
            {"data": testcase_data} for testcase_data in updated_testcases_data
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

        response_testset = response["testset"]
        response_testcases = response_testset["data"]["testcases"]
        response_testcases_data = [testcase["data"] for testcase in response_testcases]

        assert len(response_testcases_data) != len(testcases_data)
        # ----------------------------------------------------------------------

    def test_edit_testset(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
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

        testset_id = response.json()["testset"]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        updated_testset = {
            "id": testset_id,
            **testset,
            "name": testset["name"],
            "description": testset["description"],
            "data": {
                "testcases": testcases,
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

        response_testset = response["testset"]
        response_testcases = response_testset["data"]["testcases"]
        response_testcases_data = [testcase["data"] for testcase in response_testcases]

        assert len(response_testcases_data) == len(testcases_data)
        # ----------------------------------------------------------------------

    def test_archive_testset(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        testcases = [{"data": testcase_data} for testcase_data in testcases_data]

        testset = {
            "slug": slug,
            "name": "Testset Name - Archive",
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

        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        testcases = [{"data": testcase_data} for testcase_data in testcases_data]

        testset = {
            "slug": slug,
            "name": "Testset Name - Unarchive",
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
