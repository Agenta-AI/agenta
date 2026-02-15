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
