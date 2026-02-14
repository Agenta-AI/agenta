import time
from uuid import uuid4


def _wait_for_trace(authed_api, trace_id, *, expect_count=1, max_retries=15, delay=0.5):
    """Poll until the trace appears (or disappears) in the DB."""
    resp = None
    for _ in range(max_retries):
        resp = authed_api("GET", f"/preview/tracing/traces/{trace_id}")
        if resp.status_code == 200 and resp.json()["count"] == expect_count:
            return resp
        time.sleep(delay)
    return resp


class TestTraceBasics:
    def test_create_trace(self, authed_api):
        # ACT ------------------------------------------------------------------
        trace_id = uuid4().hex
        span_id_1 = uuid4().hex[16:]
        span_id_2 = uuid4().hex[16:]

        response = authed_api(
            "POST",
            "/preview/tracing/traces/",
            json={
                "traces": {
                    trace_id: {
                        "spans": {
                            "parent_span": {
                                "trace_id": trace_id,
                                "span_id": span_id_1,
                                "span_name": "parent_span",
                                "span_kind": "SPAN_KIND_SERVER",
                                "start_time": 1670000000,
                                "end_time": 1680000000,
                                "status_code": "STATUS_CODE_OK",
                                "status_message": "This went well",
                                "attributes": {
                                    "some.string": "some-string",
                                    "some.number": 123,
                                    "some.boolean": True,
                                    "some.array": [1, 2, 3],
                                    "some.object": {
                                        "key1": "value1",
                                        "key2": "value2",
                                    },
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
                                "spans": {
                                    "child_span": {
                                        "trace_id": trace_id,
                                        "span_id": span_id_2,
                                        "parent_id": span_id_1,
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
                                                "attributes": {
                                                    "some.attribute": "some-value"
                                                },
                                            }
                                        ],
                                    }
                                },
                            }
                        }
                    }
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 202
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

    def test_fetch_trace(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        trace_id = uuid4().hex
        span_id_1 = uuid4().hex[16:]

        response = authed_api(
            "POST",
            "/preview/tracing/traces/",
            json={
                "spans": [
                    {
                        "trace_id": trace_id,
                        "span_id": span_id_1,
                        "span_name": "parent_span",
                        "span_kind": "SPAN_KIND_SERVER",
                        "start_time": 1670000000,
                        "end_time": 1680000000,
                        "status_code": "STATUS_CODE_OK",
                        "status_message": "This went well",
                        "attributes": {
                            "some.string": "some-string",
                            "some.number": 123,
                            "some.boolean": True,
                            "some.array": [1, 2, 3],
                            "some.object": {
                                "key1": "value1",
                                "key2": "value2",
                            },
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
                ]
            },
        )

        assert response.status_code == 202
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = _wait_for_trace(authed_api, trace_id, expect_count=1)
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 1
        # ----------------------------------------------------------------------

    def test_edit_trace(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        trace_id = uuid4().hex
        span_id_1 = uuid4().hex[16:]
        span_id_2 = uuid4().hex[16:]
        span_id_3 = uuid4().hex[16:]

        response = authed_api(
            "POST",
            "/preview/tracing/traces/",
            json={
                "spans": [
                    {
                        "trace_id": trace_id,
                        "span_id": span_id_1,
                        "span_name": "parent_span",
                        "span_kind": "SPAN_KIND_SERVER",
                        "start_time": 1670000000,
                        "end_time": 1680000000,
                        "status_code": "STATUS_CODE_OK",
                        "status_message": "This went well",
                    },
                    {
                        "trace_id": trace_id,
                        "span_id": span_id_2,
                        "parent_id": span_id_1,
                        "span_name": "child_span",
                        "span_kind": "SPAN_KIND_INTERNAL",
                        "start_time": 1672500000,
                        "end_time": 1677500000,
                        "status_code": "STATUS_CODE_ERROR",
                        "status_message": "This did not go well",
                    },
                ]
            },
        )

        assert response.status_code == 202
        response = response.json()
        assert response["count"] == 2

        _wait_for_trace(authed_api, trace_id, expect_count=1)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "PUT",
            f"/preview/tracing/traces/{trace_id}",
            json={
                "traces": {
                    trace_id: {
                        "spans": {
                            "parent_span": {
                                "trace_id": trace_id,
                                "span_id": span_id_1,
                                "span_name": "parent_span",
                                "span_kind": "SPAN_KIND_CONSUMER",
                                "start_time": 1670000000,
                                "end_time": 1680000000,
                                "status_code": "STATUS_CODE_OK",
                                "status_message": "This went well",
                                "attributes": {
                                    "some.string": "some-string",
                                    "some.number": 123,
                                    "some.boolean": True,
                                    "some.array": [1, 2, 3],
                                    "some.object": {
                                        "key1": "value1",
                                        "key2": "value2",
                                    },
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
                                "spans": {
                                    "child_span": {
                                        "trace_id": trace_id,
                                        "span_id": span_id_3,
                                        "parent_id": span_id_1,
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
                                                "attributes": {
                                                    "some.attribute": "some-value"
                                                },
                                            }
                                        ],
                                    }
                                },
                            }
                        }
                    }
                }
            },
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 202
        response = response.json()
        assert response["count"] == 2
        # ----------------------------------------------------------------------

    def test_delete_trace(self, authed_api):
        # ARRANGE --------------------------------------------------------------
        trace_id = uuid4().hex
        span_id_1 = uuid4().hex[16:]

        response = authed_api(
            "POST",
            "/preview/tracing/traces/",
            json={
                "spans": [
                    {
                        "trace_id": trace_id,
                        "span_id": span_id_1,
                        "span_name": "parent_span",
                        "span_kind": "SPAN_KIND_SERVER",
                        "start_time": 1670000000,
                        "end_time": 1680000000,
                        "status_code": "STATUS_CODE_OK",
                        "status_message": "This went well",
                    },
                ]
            },
        )

        assert response.status_code == 202
        response = response.json()
        assert response["count"] == 1

        _wait_for_trace(authed_api, trace_id, expect_count=1)
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/tracing/traces/{trace_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 202
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = _wait_for_trace(authed_api, trace_id, expect_count=0)
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 200
        response = response.json()
        assert response["count"] == 0
        # ----------------------------------------------------------------------

        # ACT ------------------------------------------------------------------
        response = authed_api(
            "DELETE",
            f"/preview/tracing/traces/{trace_id}",
        )
        # ----------------------------------------------------------------------

        # ASSERT ---------------------------------------------------------------
        assert response.status_code == 202  # IDEMPOTENCY
        # ----------------------------------------------------------------------
