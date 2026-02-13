from uuid import uuid4


class TestEvaluationRunsBasics:
    def test_create_evaluation_runs(self, authed_api):
        # ACT ------------------------------------------------------------------
        testset_id = str(uuid4())

        application_id = str(uuid4())

        evaluator_id = str(uuid4())

        steps = [
            {
                "key": "input",
                "type": "input",
                "origin": "custom",
                "references": {
                    "testset": {"id": testset_id},
                },
            },
            {
                "key": "invocation",
                "type": "invocation",
                "origin": "auto",
                "references": {
                    "application": {"id": application_id},
                },
                "inputs": [
                    {"key": "input"},
                ],
            },
            {
                "key": "annotation",
                "type": "annotation",
                "origin": "auto",
                "references": {
                    "evaluator": {"id": evaluator_id},
                },
                "inputs": [
                    {"key": "input"},
                    {"key": "invocation"},
                ],
            },
        ]

        mappings = [
            {
                "column": {"kind": "input", "name": "Country"},
                "step": {"key": "input", "path": "country"},
            },
            {
                "column": {"kind": "ground_truth", "name": "Capital (expected)"},
                "step": {"key": "input", "path": "correct_answer"},
            },
            {
                "column": {"kind": "application", "name": "Capital (actual)"},
                "step": {"key": "invocation", "path": "data.outputs.answer"},
            },
            {
                "column": {"kind": "evaluator", "name": "Score"},
                "step": {"key": "annotation", "path": "data.outputs.score"},
            },
            {
                "column": {"kind": "evaluator", "name": "Confidence"},
                "step": {"key": "annotation", "path": "data.outputs.confidence"},
            },
            {
                "column": {"kind": "evaluator", "name": "Explanation"},
                "step": {"key": "annotation", "path": "data.outputs.explanation"},
            },
        ]

        tags = {
            "tags1": "value1",
            "tags2": "value2",
        }

        meta = {
            "meta1": "value1",
            "meta2": "value2",
        }

        runs = [
            {
                "name": "My evaluation run name",
                "description": "My evaluation run description",
                "tags": tags,
                "meta": meta,
                "data": {
                    "steps": steps,
                    "mappings": mappings,
                },
            }
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/",
            json={"jit": False, "runs": runs},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        run = response["runs"][0]
        assert run["tags"] == tags
        assert run["meta"] == meta
        assert run["status"] == "pending"
        assert len(run["data"]["steps"]) == 3
        assert run["data"]["steps"][0]["key"] == "input"
        assert run["data"]["steps"][0]["type"] == "input"
        assert run["data"]["steps"][1]["key"] == "invocation"
        assert run["data"]["steps"][1]["type"] == "invocation"
        assert run["data"]["steps"][2]["key"] == "annotation"
        assert run["data"]["steps"][2]["type"] == "annotation"
        assert len(run["data"]["mappings"]) == 6
        # ----------------------------------------------------------------------

    def test_delete_evaluation_runs(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_delete_evaluation_runs_1"},
            {"name": "test_delete_evaluation_runs_2"},
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        runs = response["runs"]
        assert runs[0]["name"] == "test_delete_evaluation_runs_1"
        assert runs[1]["name"] == "test_delete_evaluation_runs_2"
        run_id_1 = runs[0]["id"]
        run_id_2 = runs[1]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/preview/evaluations/runs/",
            json={
                "run_ids": [run_id_1, run_id_2],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert response["run_ids"][0] == run_id_1
        assert response["run_ids"][1] == run_id_2
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/preview/evaluations/runs/",
            json={
                "run_ids": [run_id_1, run_id_2],
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_close_evaluation_runs(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_close_evaluation_runs_1"},
            {"name": "test_close_evaluation_runs_2"},
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        runs = response["runs"]
        assert runs[0]["name"] == "test_close_evaluation_runs_1"
        assert runs[1]["name"] == "test_close_evaluation_runs_2"
        run_id_1 = runs[0]["id"]
        run_id_2 = runs[1]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/close",
            json={"run_ids": [run_id_1, run_id_2]},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert response["runs"][0]["id"] == run_id_1
        assert response["runs"][1]["id"] == run_id_2
        # ----------------------------------------------------------------------

    def test_open_evaluation_runs(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_open_evaluation_runs_1"},
            {"name": "test_open_evaluation_runs_2"},
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        runs = response["runs"]
        run_id_1 = runs[0]["id"]
        run_id_2 = runs[1]["id"]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/close",
            json={"run_ids": [run_id_1, run_id_2]},
        )

        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/runs/open",
            json={"run_ids": [run_id_1, run_id_2]},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert response["runs"][0]["id"] == run_id_1
        assert response["runs"][1]["id"] == run_id_2
        # ----------------------------------------------------------------------

    def test_fetch_evaluation_run(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_fetch_evaluation_run"},
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200
        run_id = response.json()["runs"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/preview/evaluations/runs/{run_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_edit_evaluation_run(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        tags = {
            "tags1": "value1",
            "tags2": "value2",
        }

        meta = {
            "meta1": "value1",
            "meta2": "value2",
        }

        runs = [
            {
                "name": "My evaluation run name",
                "description": "My evaluation run description",
                "tags": tags,
                "meta": meta,
            }
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]
        # ----------------------------------------------------------------------

        tags = {
            "tags1": "value2",
            "tags2": "value1",
        }

        meta = {
            "meta1": "value2",
            "meta2": "value1",
        }

        run = {
            "id": run_id,
            "name": "test_edit_evaluation_run",
            "description": "My edited evaluation run description",
            "status": "success",
            "tags": tags,
            "meta": meta,
        }

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "PATCH",
            f"/preview/evaluations/runs/{run_id}",
            json={"run": run},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["run"]["status"] == "success"
        assert response["run"]["tags"] == tags
        assert response["run"]["meta"] == meta
        # ----------------------------------------------------------------------

    def test_delete_evaluation_run(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_delete_evaluation_run"},
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/evaluations/runs/{run_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["run_id"] == run_id
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/evaluations/runs/{run_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_close_evaluation_run(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_close_evaluation_run"},
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/evaluations/runs/{run_id}/close",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["run"]["id"] == run_id
        # ----------------------------------------------------------------------

    def test_open_evaluation_run(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_open_evaluation_run"},
        ]

        response = authed_api(
            "POST",
            "/preview/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]

        response = authed_api(
            "POST",
            f"/preview/evaluations/runs/{run_id}/close",
        )

        assert response.status_code == 200
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            f"/preview/evaluations/runs/{run_id}/open",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["run"]["id"] == run_id
        # ----------------------------------------------------------------------
