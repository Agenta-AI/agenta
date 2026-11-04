"""The trace filter picker fields that live evaluations save in their query.

Before this, the tracing query dropped these fields, so a filtered live evaluation
scored every trace.
"""

import time
from uuid import uuid4

import pytest

from utils.polling import wait_for_response


def _invocation_span(trace_id: str, span_id: str, *, session_id: str, country: str):
    return {
        "trace_id": trace_id,
        "span_id": span_id,
        "span_name": "capital",
        "span_kind": "SPAN_KIND_SERVER",
        "start_time": int(time.time()) - 1,
        "end_time": int(time.time()),
        "status_code": "STATUS_CODE_OK",
        "attributes": {
            "ag": {
                "session": {"id": session_id},
                "tags": {"env": country.lower()},
                "data": {"inputs": {"country": country}, "outputs": "capital"},
            }
        },
    }


@pytest.fixture(scope="class")
def picker_traces(authed_api):
    run = uuid4().hex[:8]
    session_id = f"session-{run}"
    evaluator_slug = f"evaluator-{run}"
    annotated = {"trace_id": uuid4().hex, "span_id": uuid4().hex[16:]}
    plain = {"trace_id": uuid4().hex, "span_id": uuid4().hex[16:]}

    response = authed_api(
        "POST",
        "/tracing/spans/ingest",
        json={
            "spans": [
                _invocation_span(**annotated, session_id=session_id, country="Peru"),
                _invocation_span(**plain, session_id=session_id, country="Japan"),
            ]
        },
    )
    assert response.status_code == 202

    # Two annotations on the same trace, each with one of the two outputs.
    for outputs in ({"score": 1}, {"approved": True}):
        response = authed_api(
            "POST",
            "/simple/traces/",
            json={
                "trace": {
                    "origin": "custom",
                    "kind": "adhoc",
                    "channel": "api",
                    "data": {"outputs": outputs},
                    "references": {"evaluator": {"slug": evaluator_slug}},
                    "links": {"invocation": annotated},
                }
            },
        )
        assert response.status_code in (200, 202)

    wait_for_response(
        authed_api,
        "POST",
        "/tracing/spans/query",
        json={
            "focus": "trace",
            "filter": {
                "conditions": [
                    {"field": "has_annotation", "operator": "in", "value": []},
                    _session(session_id),
                ]
            },
        },
        condition_fn=lambda r: r.json().get("count", 0) == 1,
    )

    return {
        "session_id": session_id,
        "evaluator_slug": evaluator_slug,
        "annotated": annotated["trace_id"],
        "plain": plain["trace_id"],
    }


def _session(session_id: str) -> dict:
    return {"field": "attributes.ag.session.id", "operator": "is", "value": session_id}


def _trace_ids(authed_api, *conditions: dict) -> set:
    response = authed_api(
        "POST",
        "/tracing/spans/query",
        json={"focus": "trace", "filter": {"conditions": list(conditions)}},
    )
    assert response.status_code == 200, response.text
    return {trace_id.replace("-", "") for trace_id in response.json().get("traces", {})}


@pytest.mark.usefixtures("picker_traces")
class TestPickerFilterFields:
    def test_session_field_matches_only_its_session(self, authed_api, picker_traces):
        traces = _trace_ids(authed_api, _session(picker_traces["session_id"]))
        assert traces == {picker_traces["annotated"], picker_traces["plain"]}

        assert _trace_ids(authed_api, _session("no-such-session")) == set()

    def test_key_fields_filter_on_the_attribute_key(self, authed_api, picker_traces):
        session = _session(picker_traces["session_id"])
        rows = [
            {
                "field": "input_keys",
                "key": "attributes.ag.data.inputs.country",
                "operator": "is",
                "value": "Peru",
            },
            {
                "field": "custom",
                "key": "attributes.ag.tags.env",
                "operator": "is",
                "value": "peru",
            },
        ]
        for row in rows:
            assert _trace_ids(authed_api, session, row) == {picker_traces["annotated"]}

        output = {
            "field": "output_keys",
            "key": "attributes.ag.data.outputs",
            "operator": "is",
            "value": "no-such-output",
        }
        assert _trace_ids(authed_api, session, output) == set()

    def test_has_annotation_splits_annotated_and_plain(self, authed_api, picker_traces):
        session = _session(picker_traces["session_id"])
        by_evaluator = [{"evaluator": picker_traces["evaluator_slug"]}]

        assert _trace_ids(
            authed_api,
            session,
            {"field": "has_annotation", "operator": "in", "value": by_evaluator},
        ) == {picker_traces["annotated"]}
        assert _trace_ids(
            authed_api,
            session,
            {"field": "has_annotation", "operator": "not_in", "value": by_evaluator},
        ) == {picker_traces["plain"]}
        assert (
            _trace_ids(
                authed_api,
                session,
                {
                    "field": "has_annotation",
                    "operator": "in",
                    "value": [{"evaluator": "no-such-evaluator"}],
                },
            )
            == set()
        )

    def test_has_annotation_feedbacks_must_hold_on_one_annotation(
        self, authed_api, picker_traces
    ):
        session = _session(picker_traces["session_id"])

        def feedback(field, value):
            return {
                "field": "has_annotation",
                "operator": "in",
                "value": [{"feedback": {"field": [field], "value": value}}],
            }

        assert _trace_ids(authed_api, session, feedback("score", 1)) == {
            picker_traces["annotated"]
        }
        assert (
            _trace_ids(
                authed_api, session, feedback("score", 1), feedback("approved", True)
            )
            == set()
        )

    def test_unknown_field_is_a_400_not_a_dropped_condition(self, authed_api):
        response = authed_api(
            "POST",
            "/tracing/spans/query",
            json={
                "focus": "trace",
                "filter": {
                    "conditions": [
                        {"field": "no_such_field", "operator": "is", "value": "x"}
                    ]
                },
            },
        )
        assert response.status_code == 400

    def test_unknown_field_on_analytics_is_a_400_not_an_empty_result(self, authed_api):
        response = authed_api(
            "POST",
            "/spans/analytics/query",
            json={
                "filter": {
                    "conditions": [
                        {"field": "no_such_field", "operator": "is", "value": "x"}
                    ]
                },
            },
        )
        assert response.status_code == 400


class TestSavedQueryFilterValidation:
    def test_saving_a_query_with_an_unknown_field_is_a_400(self, authed_api):
        response = authed_api(
            "POST",
            "/simple/queries/",
            json={
                "query": {
                    "slug": f"live-{uuid4().hex[:8]}",
                    "data": {
                        "filtering": {
                            "conditions": [
                                {
                                    "field": "trace_type",
                                    "operator": "is",
                                    "value": "invocation",
                                },
                                {
                                    "field": "no_such_field",
                                    "operator": "is",
                                    "value": "x",
                                },
                            ]
                        }
                    },
                }
            },
        )

        assert response.status_code == 400
        assert "no_such_field" in response.json()["detail"]

    def test_saving_a_query_with_picker_fields_keeps_them(self, authed_api):
        conditions = [
            {"field": "trace_type", "operator": "is", "value": "invocation"},
            {"field": "attributes.ag.session.id", "operator": "is", "value": "s-1"},
            {"field": "has_annotation", "operator": "not_in", "value": []},
        ]
        response = authed_api(
            "POST",
            "/simple/queries/",
            json={
                "query": {
                    "slug": f"live-{uuid4().hex[:8]}",
                    "data": {"filtering": {"conditions": conditions}},
                }
            },
        )

        assert response.status_code == 200, response.text
        saved = response.json()["query"]["data"]["filtering"]["conditions"]
        assert [c["field"] for c in saved] == [c["field"] for c in conditions]
