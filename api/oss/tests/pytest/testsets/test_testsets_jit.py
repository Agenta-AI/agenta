from uuid import uuid4


class TestTestsetsJIT:
    def test_transfer_testset(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        name = uuid4().hex

        csvdata = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        response = authed_api(
            "POST",
            "/testsets/",
            json={
                "name": name,
                "csvdata": csvdata,
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert "id" in response
        assert response["name"] == name
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        testset_id = response["id"]
        response = authed_api(
            "POST",
            f"/preview/simple/testsets/{testset_id}/transfer",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testset"]["name"] == name
        assert response["testset"]["id"] == testset_id

        testcases = response["testset"]["data"]["testcases"]
        assert len(testcases) == len(csvdata)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        csvdata = [testcase["data"] for testcase in testcases][:-1] + [
            {"column1": "data7", "column2": "data8", "column3": "data9"},
        ]

        response = authed_api(
            "PUT",
            f"/testsets/{testset_id}",
            json={
                "name": name,
                "csvdata": csvdata,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["_id"] == testset_id
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/simple/testsets/{testset_id}/transfer",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testset"]["name"] == name
        assert response["testset"]["id"] == testset_id

        testcases = response["testset"]["data"]["testcases"]
        assert len(testcases) == len(csvdata)
        # ----------------------------------------------------------------------

    def test_transfer_testset_no_changes(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        name = uuid4().hex

        csvdata = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        response = authed_api(
            "POST",
            "/testsets/",
            json={
                "name": name,
                "csvdata": csvdata,
            },
        )

        assert response.status_code == 200
        response = response.json()
        assert "id" in response
        assert response["name"] == name
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        testset_id = response["id"]
        response = authed_api(
            "POST",
            f"/preview/simple/testsets/{testset_id}/transfer",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testset"]["name"] == name
        assert response["testset"]["id"] == testset_id

        testcases = response["testset"]["data"]["testcases"]
        assert len(testcases) == len(csvdata)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        csvdata = [testcase["data"] for testcase in testcases]

        response = authed_api(
            "PUT",
            f"/testsets/{testset_id}",
            json={
                "name": name,
                "csvdata": csvdata,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["_id"] == testset_id
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/simple/testsets/{testset_id}/transfer",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["testset"]["name"] == name
        assert response["testset"]["id"] == testset_id

        testcases = response["testset"]["data"]["testcases"]
        assert len(testcases) == len(csvdata)
        # ----------------------------------------------------------------------
