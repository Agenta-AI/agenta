import time
from uuid import uuid4

import pytest

from utils.polling import wait_for_response


TRACE_ID = uuid4().hex


@pytest.fixture(scope="class")
def mock_data(authed_api):
    trace_id = TRACE_ID

    # ARRANGE ------------------------------------------------------------------
    spans = [
        {
            "trace_id": trace_id,
            "span_id": "abcdef1234567890",
            "span_name": "parent_span",
            "span_kind": "SPAN_KIND_SERVER",
            "start_time": 1670000000,
            "end_time": 1680000000,
            "status_code": "STATUS_CODE_OK",
            "status_message": "This went well",
            "attributes": {
                "ag": {
                    "type": {
                        "trace": "unknown",
                        "span": "unknown",
                        "extra_type": "x",  # unsupported
                    },
                    "flags": {"env": True},
                    "tags": {"foo": "bar"},
                    "meta": {"service": "api"},
                    "data": {
                        "inputs": {"text": "hello"},
                        "outputs": "world",
                        "internals": {"debug": True},
                        "extra_data": 42,  # unsupported
                    },
                    "metrics": {
                        "duration": {
                            "acc": 12.5,
                            "unit": None,
                            "extra_duration": "bad",  # unsupported
                        },
                        "tokens": {"acc": 100},
                        "costs": {"unit": 0.02},
                        "extra_metric": {"acc": 999},  # unsupported full metric
                    },
                    "references": {"testcase": {"id": uuid4().hex}},
                    "exception": {"message": "boom"},
                    "custom": "oops",  # unsupported top-level
                },
                "some.string": "some-string",
                "some.number": 123,
                "some.boolean": True,
                "some.array": [1, 2, 3],
                "some.object": {"key1": "value1", "key2": "value2"},
                "some.more.array.0": "array-value-0",
                "some.more.array.1": "array-value-1",
                "some.more.array.2": "array-value-2",
            },
            "events": [
                {
                    "name": "some-event",
                    "timestamp": 1675000000,
                    "attributes": {
                        "some.attribute": "some-value",
                    },
                },
                {
                    "name": "exception",
                    "timestamp": 1675000001,
                    "attributes": {
                        "message": "PANIC!",
                        "type": "NotImplementedError",
                        "stacktrace": "Traceback ...",
                    },
                },
            ],
        },
        {
            "trace_id": trace_id,
            "span_id": "1234567890abcdef",
            "parent_id": "abcdef1234567890",
            "span_name": "child_span",
            "span_kind": "SPAN_KIND_INTERNAL",
            "start_time": 1672500000,
            "end_time": 1677500000,
            "status_code": "STATUS_CODE_ERROR",
            "status_message": "This did not go well",
            "events": [
                {
                    "name": "exception",
                    "timestamp": 1675000000,
                    "attributes": {"some.attribute": "some-value"},
                }
            ],
        },
    ]
    response = authed_api(
        "POST",
        "/preview/tracing/spans/ingest",
        json={"spans": spans},
    )

    assert response.status_code == 202
    response = response.json()
    assert response["count"] == 2

    # Wait for spans to be ingested and verify they're available
    wait_response = wait_for_response(
        authed_api,
        "POST",
        "/preview/tracing/spans/query",
        json={
            "focus": "span",
            "filter": {
                "conditions": [
                    {
                        "field": "trace_id",
                        "operator": "is",
                        "value": trace_id,
                    }
                ]
            },
        },
        condition_fn=lambda r: r.json().get("count", 0) >= 2,
    )
    assert wait_response.status_code == 200, (
        f"Failed to wait for spans: {wait_response.status_code}"
    )
    assert wait_response.json().get("count", 0) >= 2, (
        f"Expected at least 2 spans, got {wait_response.json().get('count', 0)}"
    )
    # --------------------------------------------------------------------------

    _mock_data = {"spans": spans, "trace_id": trace_id}

    return _mock_data


@pytest.fixture(scope="class")
def string_comparison_data(authed_api):
    trace_ids = [uuid4().hex, uuid4().hex, uuid4().hex]
    name_prefix = f"string_cmp_{uuid4().hex[:8]}"
    now = int(time.time())

    spans = [
        {
            "trace_id": trace_ids[0],
            "span_id": "1111111111111111",
            "span_name": f"{name_prefix}_jan_15",
            "span_kind": "SPAN_KIND_SERVER",
            "start_time": now - 180,
            "end_time": now - 120,
            "status_code": "STATUS_CODE_OK",
            "attributes": {
                "tags": {
                    "created_at": "2024-01-15T10:30:00Z",
                },
            },
        },
        {
            "trace_id": trace_ids[1],
            "span_id": "2222222222222222",
            "span_name": f"{name_prefix}_jan_20",
            "span_kind": "SPAN_KIND_SERVER",
            "start_time": now - 120,
            "end_time": now - 60,
            "status_code": "STATUS_CODE_OK",
            "attributes": {
                "tags": {
                    "created_at": "2024-01-20T10:30:00Z",
                },
            },
        },
        {
            "trace_id": trace_ids[2],
            "span_id": "3333333333333333",
            "span_name": f"{name_prefix}_jan_25",
            "span_kind": "SPAN_KIND_SERVER",
            "start_time": now - 60,
            "end_time": now,
            "status_code": "STATUS_CODE_OK",
            "attributes": {
                "tags": {
                    "created_at": "2024-01-25T10:30:00Z",
                },
            },
        },
    ]

    response = authed_api(
        "POST",
        "/tracing/spans/ingest",
        json={"spans": spans},
    )

    assert response.status_code == 202
    response = response.json()
    assert response["count"] == 3

    wait_response = wait_for_response(
        authed_api,
        "POST",
        "/tracing/spans/query",
        json={
            "focus": "span",
            "filter": {
                "conditions": [
                    {
                        "field": "span_name",
                        "operator": "startswith",
                        "value": name_prefix,
                    }
                ]
            },
        },
        condition_fn=lambda r: r.json().get("count", 0) >= 3,
    )

    assert wait_response.status_code == 200
    assert wait_response.json().get("count", 0) >= 3

    return {"name_prefix": name_prefix, "spans": spans}


def _span_names(response_json):
    return {span["span_name"] for span in response_json.get("spans", [])}


class TestSpanStringComparisonOperators:
    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_gt_operator(self, authed_api, string_comparison_data):
        name_prefix = string_comparison_data["name_prefix"]

        response = authed_api(
            "POST",
            "/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {
                            "field": "span_name",
                            "operator": "startswith",
                            "value": name_prefix,
                        },
                        {
                            "field": "attributes",
                            "key": "tags.created_at",
                            "operator": "gt",
                            "value": "2024-01-15T10:30:00Z",
                        },
                    ]
                },
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 2
        assert _span_names(body) == {
            f"{name_prefix}_jan_20",
            f"{name_prefix}_jan_25",
        }

    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_gte_operator(self, authed_api, string_comparison_data):
        name_prefix = string_comparison_data["name_prefix"]

        response = authed_api(
            "POST",
            "/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {
                            "field": "span_name",
                            "operator": "startswith",
                            "value": name_prefix,
                        },
                        {
                            "field": "attributes",
                            "key": "tags.created_at",
                            "operator": "gte",
                            "value": "2024-01-20T10:30:00Z",
                        },
                    ]
                },
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 2
        assert _span_names(body) == {
            f"{name_prefix}_jan_20",
            f"{name_prefix}_jan_25",
        }

    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_lt_operator(self, authed_api, string_comparison_data):
        name_prefix = string_comparison_data["name_prefix"]

        response = authed_api(
            "POST",
            "/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {
                            "field": "span_name",
                            "operator": "startswith",
                            "value": name_prefix,
                        },
                        {
                            "field": "attributes",
                            "key": "tags.created_at",
                            "operator": "lt",
                            "value": "2024-01-25T10:30:00Z",
                        },
                    ]
                },
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 2
        assert _span_names(body) == {
            f"{name_prefix}_jan_15",
            f"{name_prefix}_jan_20",
        }

    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_lte_operator(self, authed_api, string_comparison_data):
        name_prefix = string_comparison_data["name_prefix"]

        response = authed_api(
            "POST",
            "/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {
                            "field": "span_name",
                            "operator": "startswith",
                            "value": name_prefix,
                        },
                        {
                            "field": "attributes",
                            "key": "tags.created_at",
                            "operator": "lte",
                            "value": "2024-01-15T10:30:00Z",
                        },
                    ]
                },
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert _span_names(body) == {f"{name_prefix}_jan_15"}

    @pytest.mark.coverage_smoke
    @pytest.mark.path_happy
    def test_string_range_query(self, authed_api, string_comparison_data):
        name_prefix = string_comparison_data["name_prefix"]

        response = authed_api(
            "POST",
            "/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "operator": "and",
                    "conditions": [
                        {
                            "field": "span_name",
                            "operator": "startswith",
                            "value": name_prefix,
                        },
                        {
                            "field": "attributes",
                            "key": "tags.created_at",
                            "operator": "gte",
                            "value": "2024-01-15T10:30:00Z",
                        },
                        {
                            "field": "attributes",
                            "key": "tags.created_at",
                            "operator": "lt",
                            "value": "2024-01-25T10:30:00Z",
                        },
                    ],
                },
            },
        )

        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 2
        assert _span_names(body) == {
            f"{name_prefix}_jan_15",
            f"{name_prefix}_jan_20",
        }


class TestSpansQueries:
    @pytest.mark.skip(reason="Flaky in CI - investigating quota/timing issues")
    def test_query_all(self, authed_api, mock_data):
        trace_id = mock_data["trace_id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {
                            "field": "trace_id",
                            "operator": "is",
                            "value": trace_id,
                        }
                    ]
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 2
        assert len(response["spans"]) == 2
        # ----------------------------------------------------------------------

    @pytest.mark.skip(reason="Flaky in CI - investigating quota/timing issues")
    def test_query_fts(self, authed_api, mock_data):
        trace_id = mock_data["trace_id"]

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "conditions": [
                        {
                            "field": "trace_id",
                            "operator": "is",
                            "value": trace_id,
                        },
                        {
                            "field": "content",
                            "operator": "contains",
                            "value": "hello world",
                        },
                    ]
                },
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        assert len(response["spans"]) == 1
        # ----------------------------------------------------------------------
