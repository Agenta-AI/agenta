from uuid import uuid4
from tempfile import TemporaryFile
from csv import DictWriter, DictReader
from json import dumps, loads
from io import TextIOWrapper


class TestTestsetsFiles:
    def test_create_testsets_from_csv_file(self, authed_api):
        # ACT ------------------------------------------------------------------
        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        with TemporaryFile("w+", newline="") as csvfile:
            writer = DictWriter(csvfile, fieldnames=testcases_data[0].keys())
            writer.writeheader()
            writer.writerows(testcases_data)
            csvfile.seek(0)

            files = {
                "file": ("testset.csv", csvfile, "text/csv"),
                "testset_name": (None, "Testset Name"),
            }

            data = {
                "file_type": "csv",
                "testset_description": "This is a testset description.",
                "testset_tags": dumps({"tag1": "value1", "tag2": "value2"}),
                "testset_meta": dumps({"meta1": "value1", "meta2": "value2"}),
            }

            response = authed_api(
                "POST",
                "/preview/simple/testsets/upload",
                files=files,
                data=data,
            )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        response_testcases = response["testset"]["data"]["testcases"]
        assert len(response_testcases) == len(testcases_data)
        # ----------------------------------------------------------------------

    def test_create_testsets_from_json_file(self, authed_api):
        # ACT ------------------------------------------------------------------
        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
        ]

        with TemporaryFile("w+", newline="") as jsonfile:
            jsonfile.write(dumps(testcases_data))
            jsonfile.seek(0)

            files = {
                "file": ("testset.json", jsonfile, "application/json"),
                "testset_name": (None, "Testset Name"),
            }

            data = {
                "file_type": "json",
                "testset_description": "This is a testset description.",
                "testset_tags": dumps({"tag1": "value1", "tag2": "value2"}),
                "testset_meta": dumps({"meta1": "value1", "meta2": "value2"}),
            }

            response = authed_api(
                "POST",
                "/preview/simple/testsets/upload",
                files=files,
                data=data,
            )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        response_testcases = response["testset"]["data"]["testcases"]
        assert len(response_testcases) == len(testcases_data)
        # ----------------------------------------------------------------------

    def test_fetch_testset_to_csv_file(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
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

        # ACT ------------------------------------------------------------------
        with TemporaryFile(mode="w+b", suffix=".csv") as tmpfile:
            response = authed_api(
                "POST",
                f"/preview/simple/testsets/{testset_id}/download",
                params={
                    "file_type": "csv",
                    "file_name": "testset_export.csv",
                },
                stream=True,
            )
            assert response.status_code == 200

            for chunk in response.iter_content(chunk_size=8192):
                tmpfile.write(chunk)

            tmpfile.seek(0)

            # Read CSV into list of dicts
            text_stream = TextIOWrapper(tmpfile, encoding="utf-8")
            reader = DictReader(text_stream)
            parsed = [row for row in reader]

            assert len(parsed) == len(testcases_data)
        # ----------------------------------------------------------------------

    def test_fetch_testset_to_json_file(self, authed_api):
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

        # ACT ------------------------------------------------------------------
        with TemporaryFile(mode="w+b", suffix=".json") as tmpfile:
            response = authed_api(
                "POST",
                f"/preview/simple/testsets/{testset_id}/download",
                params={
                    "file_type": "json",
                    "file_name": "testset_export.json",
                },
                stream=True,
            )
            assert response.status_code == 200

            for chunk in response.iter_content(chunk_size=8192):
                tmpfile.write(chunk)

            tmpfile.seek(0)  # rewind to beginning for reading
            actual = tmpfile.read()

            parsed = loads(actual)

            assert len(parsed) == len(testcases_data)
        # ----------------------------------------------------------------------

    def test_edit_testset_from_file(self, authed_api):
        # FIRST UPLOAD THEN UPLOAD AGAIN WITH CHANGES

        # ARRANGE --------------------------------------------------------------
        slug = uuid4().hex

        tags = {"tag1": "value1", "tag2": "value2"}
        meta = {"meta1": "value1", "meta2": "value2"}

        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
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
        testcases_data = [
            {"column1": "data1", "column2": "data2", "column3": "data3"},
            {"column1": "data4", "column2": "data5", "column3": "data6"},
            {"column1": "data6", "column2": "data5", "column3": "data4"},
            {"column1": "data6", "column2": "data5", "column3": "data4"},
        ]

        with TemporaryFile("w+", newline="") as csvfile:
            writer = DictWriter(csvfile, fieldnames=testcases_data[0].keys())
            writer.writeheader()
            writer.writerows(testcases_data)
            csvfile.seek(0)

            files = {
                "file": ("testset.csv", csvfile, "text/csv"),
                "testset_name": (None, "Updated Testset Name"),
            }

            data = {
                "file_type": "csv",
                "testset_description": "This is an updated description.",
                "testset_tags": dumps({"tag1": "value2", "tag2": "value3"}),
                "testset_meta": dumps({"meta1": "value4", "meta2": "value5"}),
            }

            response = authed_api(
                "POST",
                f"/preview/simple/testsets/{testset_id}/upload",
                files=files,
                data=data,
            )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        response_testcases = response["testset"]["data"]["testcases"]
        assert len(response_testcases) == len(testcases_data)

        # ----------------------------------------------------------------------
