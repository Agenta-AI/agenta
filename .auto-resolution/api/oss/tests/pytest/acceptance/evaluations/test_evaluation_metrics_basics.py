class TestEvaluationMetricsBasics:
    def test_create_evaluation_metrics(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_evaluation_metrics_basics"},
        ]

        response = authed_api(
            "POST",
            "/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]

        metrics = [
            {
                "run_id": run_id,
                "status": "success",
                "data": {
                    "integer_metric": 42,
                    "float_metric": 3.14,
                    "string_metric": "test",
                    "boolean_metric": True,
                },
            },
        ]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/evaluations/metrics/",
            json={"metrics": metrics},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_upsert_evaluation_metrics(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_edit_evaluation_metrics"},
        ]

        response = authed_api(
            "POST",
            "/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]

        metrics = [
            {
                "run_id": run_id,
                "status": "success",
                "data": {
                    "integer_metric": 42,
                    "float_metric": 3.14,
                    "string_metric": "test",
                    "boolean_metric": True,
                },
            },
        ]

        response = authed_api(
            "POST",
            "/evaluations/metrics/",
            json={"metrics": metrics},
        )
        assert response.status_code == 200

        metrics = response.json()["metrics"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        metrics[0]["data"]["integer_metric"] = 84
        metrics[0]["data"]["float_metric"] = 6.28
        metrics[0]["data"]["string_metric"] = "updated_test"
        metrics[0]["data"]["boolean_metric"] = False

        response = authed_api(
            "POST",
            "/evaluations/metrics/",
            json={"metrics": metrics},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["metrics"][0]["data"]["integer_metric"] == 84
        assert response["metrics"][0]["data"]["float_metric"] == 6.28
        assert response["metrics"][0]["data"]["string_metric"] == "updated_test"
        assert response["metrics"][0]["data"]["boolean_metric"] is False
        # ----------------------------------------------------------------------

    def test_delete_evaluation_metrics(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_delete_evaluation_metrics"},
        ]

        response = authed_api(
            "POST",
            "/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]

        metrics = [
            {
                "run_id": run_id,
                "status": "success",
                "data": {
                    "integer_metric": 42,
                    "float_metric": 3.14,
                    "string_metric": "test",
                    "boolean_metric": True,
                },
            },
        ]

        response = authed_api(
            "POST",
            "/evaluations/metrics/",
            json={"metrics": metrics},
        )
        assert response.status_code == 200

        metrics = response.json()["metrics"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/evaluations/metrics/",
            json={"metrics_ids": [metrics[0]["id"]]},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["metrics_ids"][0] == metrics[0]["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            "/evaluations/metrics/",
            json={"metrics_ids": [metrics[0]["id"]]},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_fetch_evaluation_metric(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_fetch_evaluation_metric"},
        ]

        response = authed_api(
            "POST",
            "/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]

        metrics = [
            {
                "run_id": run_id,
                "status": "success",
                "data": {
                    "integer_metric": 42,
                    "float_metric": 3.14,
                    "string_metric": "test",
                    "boolean_metric": True,
                },
            },
        ]

        response = authed_api(
            "POST",
            "/evaluations/metrics/",
            json={"metrics": metrics},
        )
        assert response.status_code == 200

        response = response.json()
        metric = response["metrics"][0]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "GET",
            f"/evaluations/metrics/{metric['id']}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        matched = response["metrics"][0]
        assert matched["id"] == metric["id"]
        assert matched["data"]["integer_metric"] == 42
        assert matched["data"]["float_metric"] == 3.14
        assert matched["data"]["string_metric"] == "test"
        assert matched["data"]["boolean_metric"] is True
        # ----------------------------------------------------------------------

    def test_upsert_evaluation_metric(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_edit_evaluation_metric"},
        ]

        response = authed_api(
            "POST",
            "/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]

        metrics = [
            {
                "run_id": run_id,
                "status": "success",
                "data": {
                    "integer_metric": 42,
                    "float_metric": 3.14,
                    "string_metric": "test",
                    "boolean_metric": True,
                },
            },
        ]

        response = authed_api(
            "POST",
            "/evaluations/metrics/",
            json={"metrics": metrics},
        )
        assert response.status_code == 200

        response = response.json()
        metric = response["metrics"][0]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        metric["data"]["integer_metric"] = 84
        metric["data"]["float_metric"] = 6.28
        metric["data"]["string_metric"] = "updated_test"
        metric["data"]["boolean_metric"] = False

        response = authed_api(
            "POST",
            "/evaluations/metrics/",
            json={"metrics": [metric]},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["metrics"][0]["id"] == metric["id"]
        assert response["metrics"][0]["data"]["integer_metric"] == 84
        assert response["metrics"][0]["data"]["float_metric"] == 6.28
        assert response["metrics"][0]["data"]["string_metric"] == "updated_test"
        assert response["metrics"][0]["data"]["boolean_metric"] is False

    def test_delete_evaluation_metric(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_delete_evaluation_metric"},
        ]

        response = authed_api(
            "POST",
            "/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]

        metrics = [
            {
                "run_id": run_id,
                "status": "success",
                "data": {
                    "integer_metric": 42,
                    "float_metric": 3.14,
                    "string_metric": "test",
                    "boolean_metric": True,
                },
            },
        ]

        response = authed_api(
            "POST",
            "/evaluations/metrics/",
            json={"metrics": metrics},
        )
        assert response.status_code == 200

        response = response.json()
        metric = response["metrics"][0]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/evaluations/metrics/{metric['id']}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert response["metrics_ids"][0] == metric["id"]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/evaluations/metrics/{metric['id']}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

    def test_invalid_metric_shape_is_rejected(self, authed_api):
        # A metric with BOTH scenario_id and timestamp set matches none of the
        # three partial unique indexes (global/variational/temporal). It must be
        # rejected (422), not silently dropped.
        # ARRANGE --------------------------------------------------------------
        runs = [
            {"name": "test_invalid_metric_shape"},
        ]

        response = authed_api(
            "POST",
            "/evaluations/runs/",
            json={"runs": runs},
        )

        assert response.status_code == 200

        run_id = response.json()["runs"][0]["id"]

        metrics = [
            {
                "run_id": run_id,
                "scenario_id": run_id,  # any UUID; the shape check runs first
                "timestamp": "2026-01-01T00:00:00+00:00",
                "status": "success",
                "data": {"integer_metric": 1},
            },
        ]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/evaluations/metrics/",
            json={"metrics": metrics},
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 422, response.text
        # ----------------------------------------------------------------------
