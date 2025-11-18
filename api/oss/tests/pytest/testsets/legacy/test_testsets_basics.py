from uuid import uuid4
from tempfile import TemporaryFile
from csv import DictWriter
from json import dumps


class TestLegacyTestsetsBasics:
    def test_create_legacy_testsets(self, authed_api):
        # ACT ------------------------------------------------------------------
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
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert "id" in response
        assert response["name"] == name
        # ----------------------------------------------------------------------

    def test_fetch_legacy_testsets(self, authed_api):
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

        testset_id = response.json()["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/testsets/{testset_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["id"] == testset_id
        assert response["name"] == name
        assert response["csvdata"] == csvdata
        # ----------------------------------------------------------------------

    def test_edit_legacy_testsets(self, authed_api):
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

        testset_id = response.json()["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        new_name = uuid4().hex
        new_csvdata = [
            {"column1": "data6", "column2": "data5", "column3": "data4"},
            {"column1": "data3", "column2": "data2", "column3": "data1"},
        ]

        response = authed_api(
            "PUT",
            f"/testsets/{testset_id}",
            json={
                "name": new_name,
                "csvdata": new_csvdata,
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["_id"] == testset_id
        # ----------------------------------------------------------------------

    def test_delete_legacy_testsets(self, authed_api):
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

        testset_id = response.json()["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/testsets/",
            json={
                "testset_ids": [testset_id],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        # ----------------------------------------------------------------------

    def test_list_legacy_testsets(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        name1 = uuid4().hex
        name2 = uuid4().hex

        csvdata1 = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        csvdata2 = [
            {"column1": "data7", "column2": "data8", "column3": "data9"},
            {"column1": "data10", "column2": "data11", "column3": "data12"},
        ]

        response1 = authed_api(
            "POST",
            "/testsets/",
            json={
                "name": name1,
                "csvdata": csvdata1,
            },
        )

        response2 = authed_api(
            "POST",
            "/testsets/",
            json={
                "name": name2,
                "csvdata": csvdata2,
            },
        )

        assert response1.status_code == 200
        assert response2.status_code == 200

        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            "/testsets/",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert len(response) >= 2
        assert any(testset["name"] == name1 for testset in response)
        assert any(testset["name"] == name2 for testset in response)
        # ----------------------------------------------------------------------

    def test_upload_legacy_testsets_from_csv(self, authed_api):
        # ACT ------------------------------------------------------------------
        name = uuid4().hex
        file_name = uuid4().hex + ".csv"

        csvdata = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        with TemporaryFile("w+", newline="") as temp_file:
            writer = DictWriter(temp_file, fieldnames=csvdata[0].keys())
            writer.writeheader()
            writer.writerows(csvdata)
            temp_file.seek(0)

            files = {
                "file": (file_name, temp_file, "text/csv"),
                "testset_name": (None, name),
            }
            data = {
                "upload_type": "CSV",
            }

            response = authed_api(
                "POST",
                "/testsets/upload/",
                files=files,
                data=data,
            )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert "id" in response
        assert response["name"] == name
        # ----------------------------------------------------------------------

    def test_upload_legacy_testsets_from_json(self, authed_api):
        # ACT ------------------------------------------------------------------
        name = uuid4().hex
        file_name = uuid4().hex + ".json"

        jsondata = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        # Create a temporary JSON file
        with TemporaryFile("w+", newline="") as temp_file:
            temp_file.write(dumps(jsondata))
            temp_file.seek(0)
            # Upload the JSON file
            files = {
                "file": (file_name, temp_file, "application/json"),
                "testset_name": (None, name),
            }
            data = {
                "upload_type": "JSON",
            }

            response = authed_api(
                "POST",
                "/testsets/upload/",
                files=files,
                data=data,
            )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert "id" in response
        assert response["name"] == name
        # ----------------------------------------------------------------------
