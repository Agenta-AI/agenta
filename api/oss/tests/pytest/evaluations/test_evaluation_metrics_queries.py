from uuid import uuid4
from json import dumps
from urllib.parse import quote

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

    metrics = [
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

    response = authed_api(
        "POST",
        "/preview/evaluations/metrics/",
        json={"metrics": metrics},
    )

    assert response.status_code == 200
    response = response.json()
    assert response["count"] == 2

    metrics = response["metrics"]
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
        metric_ids = [metric["id"] for metric in metrics]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metric": {
                    "ids": metric_ids,
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert all(metric["id"] in metric_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_tags(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        metric_ids = [metric["id"] for metric in metrics]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metric": {
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
        assert all(metric["id"] in metric_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_meta(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        metric_ids = [metric["id"] for metric in metrics]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metric": {
                    "meta": {
                        "meta1": "value1",
                        "meta2": "value2",
                    },
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert all(metric["id"] in metric_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_status(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        metric_ids = [
            metric["id"] for metric in metrics if metric["status"] == "success"
        ]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metric": {
                    "status": "success",
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert all(metric["id"] in metric_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_statuses(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        metric_ids = [
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
                "metric": {
                    "statuses": ["success", "failure"],
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert all(metric["id"] in metric_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_run_id(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        run_id = metrics[0]["run_id"]
        metric_ids = [metric["id"] for metric in metrics if metric["run_id"] == run_id]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metric": {
                    "run_id": run_id,
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert all(metric["id"] in metric_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------

    def test_query_metrics_by_run_ids(self, authed_api, mock_data):
        # ARRANGE --------------------------------------------------------------
        metrics = mock_data["metrics"]
        run_ids = [metrics[0]["run_id"], metrics[1]["run_id"]]
        metric_ids = [metric["id"] for metric in metrics if metric["run_id"] in run_ids]
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/evaluations/metrics/query",
            json={
                "metric": {
                    "run_ids": run_ids,
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert all(metric["id"] in metric_ids for metric in response["metrics"])
        # ----------------------------------------------------------------------
