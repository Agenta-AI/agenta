from datetime import datetime, timezone

import pytest


@pytest.fixture(scope="class")
def mock_data(authed_api):
    # ARRANGE ------------------------------------------------------------------
    response = authed_api(
        "POST",
        "/preview/evaluations/runs/",
        json={"runs": [{}, {}]},
    )
    assert response.status_code == 200

    response = response.json()

    runs = response["runs"]

    tags = {
        "tags1": "value1",
        "tags2": "value2",
    }

    meta = {
        "meta1": "value1",
        "meta2": "value2",
    }

    response = authed_api(
        "POST",
        "/preview/evaluations/metrics/",
        json={
            "metrics": [
                {
                    "run_id": runs[0]["id"],
                    "status": "success",
                    "data": {
                        "integer_metric": 42,
                        "float_metric": 3.14,
                        "string_metric": "test",
                        "boolean_metric": True,
                    },
                    "tags": tags,
                    "meta": meta,
                },
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1

    metric_1 = response.json()["metrics"][0]

    response = authed_api(
        "POST",
        "/preview/evaluations/metrics/",
        json={
            "metrics": [
                {
                    "run_id": runs[1]["id"],
                    "status": "failure",
                    "data": {
                        "integer_metric": 42,
                        "float_metric": 3.14,
                        "string_metric": "test",
                        "boolean_metric": True,
                    },
                },
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()["count"] == 1

    metric_2 = response.json()["metrics"][0]

    metrics = [metric_1, metric_2]
    # --------------------------------------------------------------------------

    _mock_data = {
        "runs": runs,
        "metrics": metrics,
    }

    return _mock_data


class TestEvaluationMetricsQueries:
    def test_query_metrics_by_ids(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        metrics_ids = [metric["id"] for metric in metrics]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metrics": {
                    "ids": metrics_ids,
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert all(metric["id"] in metrics_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_tags(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        metrics_ids = [metric["id"] for metric in metrics]
        run_ids = [r["id"] for r in mock_data["runs"]]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metrics": {
                    "run_ids": run_ids,
                    "tags": {
                        "tags1": "value1",
                        "tags2": "value2",
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert all(metric["id"] in metrics_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_status(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        run_ids = [r["id"] for r in mock_data["runs"]]
        metrics_ids = [
            metric["id"] for metric in metrics if metric["status"] == "success"
        ]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metrics": {
                    "run_ids": run_ids,
                    "status": "success",
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert all(metric["id"] in metrics_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_statuses(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        run_ids = [r["id"] for r in mock_data["runs"]]
        metrics_ids = [
            metric["id"]
            for metric in metrics
            if metric["status"] in ["success", "failure"]
        ]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metrics": {
                    "run_ids": run_ids,
                    "statuses": ["success", "failure"],
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert all(metric["id"] in metrics_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_run_id(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        run_id = metrics[0]["run_id"]
        metrics_ids = [metric["id"] for metric in metrics if metric["run_id"] == run_id]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metrics": {
                    "run_id": run_id,
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert all(metric["id"] in metrics_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_run_ids(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        run_ids = [metrics[0]["run_id"], metrics[1]["run_id"]]
        metrics_ids = [
            metric["id"] for metric in metrics if metric["run_id"] in run_ids
        ]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metrics": {
                    "run_ids": run_ids,
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert all(metric["id"] in metrics_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_no_timestamps_filters(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        run_id = mock_data["runs"][0]["id"]
        timestamp = datetime.now(timezone.utc).isoformat()
        temporal_metric = {
            "run_id": run_id,
            "status": "success",
            "timestamp": timestamp,
            "interval": 60,
            "data": {
                "temporal_metric": 99,
            },
        }
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/",
            json={"metrics": [temporal_metric]},
        )
        assert response.status_code == 200
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        # timestamps: False => metrics WHERE timestamp IS NULL (run-level)
        run_level_response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metrics": {
                    "run_id": run_id,
                    "timestamps": False,
                }
            },
        )
        # timestamps: True => metrics WHERE timestamp IS NOT NULL (temporal)
        temporal_response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metrics": {
                    "run_id": run_id,
                    "timestamps": True,
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert run_level_response.status_code == 200
        run_level_payload = run_level_response.json()
        assert run_level_payload["count"] >= 1
        assert all(
            metric.get("timestamp") is None for metric in run_level_payload["metrics"]
        )

        assert temporal_response.status_code == 200
        temporal_payload = temporal_response.json()
        assert temporal_payload["count"] >= 1
        assert all(
            metric.get("timestamp") is not None
            for metric in temporal_payload["metrics"]
        )
        # ----------------------------------------------------------------------
