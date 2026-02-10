import time
from uuid import uuid4


def _wait_for_spans(authed_api, *, max_retries=15, delay=0.5):
    """Poll until spans appear in the DB."""
    resp = None
    for _ in range(max_retries):
        resp = authed_api("POST", "/preview/tracing/spans/query")
        if resp.status_code == 200 and resp.json()["count"] != 0:
            return resp
        time.sleep(delay)
    return resp


class TestSpansBasics:
    trace_ids = [
        "1234567890abcdef1234567890abc000",
        "1234567890abcdef1234567890abc001",
        "1234567890abcdef1234567890abc002",
        "1234567890abcdef1234567890abc003",
        "1234567890abcdef1234567890abc004",
        "1234567890abcdef1234567890abc005",
    ]

    def test_ingest_spans(self, authed_api):
        # ACT ------------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/tracing/spans/ingest",
            json={
                "spans": [
                    {
                        "trace_id": self.trace_ids[0],
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
                                    "extra_metric": {  # unsupported full metric
                                        "acc": 999
                                    },
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
                        "trace_id": self.trace_ids[0],
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
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 202
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

    def test_query_spans(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        response = authed_api(
            "POST",
            "/preview/tracing/spans/ingest",
            json={
                "spans": [
                    {
                        "trace_id": self.trace_ids[1],
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
                                    "errors": {"unit": 1},
                                    "tokens": {"acc": 100},
                                    "costs": {"unit": 0.02},
                                    "extra_metric": {  # unsupported full metric
                                        "acc": 999
                                    },
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
                                "attributes": {"some.attribute": "some-value"},
                            }
                        ],
                    },
                    {
                        "trace_id": self.trace_ids[1],
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
            },
        )

        assert response.status_code == 202
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = _wait_for_spans(authed_api)
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] != 0
        # ----------------------------------------------------------------------
