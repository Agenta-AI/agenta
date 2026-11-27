"""The general fields of an annotation, and the flows of today that must not change.

Each "unchanged" test asserts that every field the annotation routes return today keeps its
value. The new fields are read only through the span query.
"""

from uuid import uuid4

from utils.polling import wait_for_response

# The fields `POST /simple/traces` and `GET /simple/traces/{id}` return today.
SIMPLE_TRACE_FIELDS = {
    "trace_id",
    "span_id",
    "created_at",
    "updated_at",
    "deleted_at",
    "created_by_id",
    "updated_by_id",
    "deleted_by_id",
    "origin",
    "kind",
    "channel",
    "tags",
    "meta",
    "data",
    "references",
    "links",
}


def _ingest(authed_api, spans):
    response = authed_api("POST", "/tracing/spans/ingest", json={"spans": spans})
    assert response.status_code == 202
    trace_ids = {span["trace_id"] for span in spans}
    for trace_id in trace_ids:
        expected = len([s for s in spans if s["trace_id"] == trace_id])
        _spans_of(authed_api, trace_id, expected)


def _spans_of(authed_api, trace_id, expected=1):
    response = wait_for_response(
        authed_api,
        "POST",
        "/tracing/spans/query",
        json={
            "focus": "span",
            "filter": {
                "conditions": [
                    {"field": "trace_id", "operator": "is", "value": trace_id}
                ]
            },
        },
        condition_fn=lambda r: r.json().get("count", 0) >= expected,
    )
    assert response.status_code == 200
    return response.json()["spans"]


def _stored(authed_api, trace_id):
    (span,) = _spans_of(authed_api, trace_id)
    return span


def _ag(span):
    return (span.get("attributes") or {}).get("ag") or {}


def _roles(span):
    roles = []
    for link in span.get("links") or []:
        attributes = link.get("attributes") or {}
        roles.append(attributes.get("key") or link.get("attributes.key"))
    return roles


def _run(trace_id, *, session_id=None, turn_id=None, references=None):
    """A root span and a child span of one run."""
    ag = {}
    if session_id:
        ag["session"] = {"id": session_id}
    if turn_id:
        ag["turn"] = {"id": turn_id}
    root_ag = {
        **ag,
        "type": {"trace": "invocation", "span": "agent"},
        "data": {"inputs": {"q": "hi"}, "outputs": "hello"},
    }
    if references:
        root_ag["references"] = references
    return [
        {
            "trace_id": trace_id,
            "span_id": "aaaaaaaaaaaaaaaa",
            "span_name": "run",
            "start_time": 1700000000,
            "end_time": 1700000001,
            "attributes": {"ag": root_ag},
        },
        {
            "trace_id": trace_id,
            "span_id": "bbbbbbbbbbbbbbbb",
            "parent_id": "aaaaaaaaaaaaaaaa",
            "span_name": "llm",
            "start_time": 1700000000,
            "end_time": 1700000001,
            "attributes": {"ag": {**ag, "type": {"span": "llm"}}},
        },
    ]


def _create(authed_api, trace):
    response = authed_api("POST", "/simple/traces/", json={"trace": trace})
    assert response.status_code in (200, 202), response.text
    return response.json()["trace"]


def _read(authed_api, trace_id):
    response = wait_for_response(
        authed_api,
        "GET",
        f"/simple/traces/{trace_id}",
        condition_fn=lambda r: r.json().get("count", 0) == 1,
    )
    assert response.status_code == 200
    return response.json()["trace"]


class TestFlowsThatMustNotChange:
    def test_web_trace_drawer_annotation_unchanged(self, authed_api):
        run = uuid4().hex
        _ingest(
            authed_api,
            _run(run, references={"application": {"id": str(uuid4()), "slug": "p"}}),
        )
        links = {"invocation": {"trace_id": run, "span_id": "bbbbbbbbbbbbbbbb"}}
        request = {
            "origin": "human",
            "kind": "adhoc",
            "channel": "web",
            "data": {"outputs": {"correct": True}},
            "meta": {"name": "Correctness"},
            "references": {"evaluator": {"slug": f"correct-{uuid4().hex[:8]}"}},
            "links": links,
        }

        created = _create(authed_api, request)
        read = _read(authed_api, created["trace_id"])

        assert set(created) <= SIMPLE_TRACE_FIELDS
        assert set(read) <= SIMPLE_TRACE_FIELDS
        for value in (created, read):
            assert value["origin"] == "human"
            assert value["kind"] == "adhoc"
            assert value["channel"] == "web"
            assert value["data"] == request["data"]
            assert value["links"] == links
            assert (
                value["references"]["evaluator"]["slug"]
                == (request["references"]["evaluator"]["slug"])
            )

        # The web app edits with the links and the evaluator references it read.
        response = authed_api(
            "PATCH",
            f"/simple/traces/{created['trace_id']}",
            json={
                "trace": {
                    "data": {"outputs": {"correct": False}},
                    "meta": read["meta"],
                    "references": {"evaluator": read["references"]["evaluator"]},
                    "links": read["links"],
                }
            },
        )
        assert response.status_code == 200, response.text
        edited = wait_for_response(
            authed_api,
            "GET",
            f"/simple/traces/{created['trace_id']}",
            condition_fn=lambda r: (
                r.json().get("trace", {}).get("data", {}).get("outputs")
                == {"correct": False}
            ),
        ).json()["trace"]
        assert edited["origin"] == "human"
        assert edited["channel"] == "web"
        assert edited["links"] == links

        stored = _ag(_stored(authed_api, created["trace_id"]))
        assert stored["annotation"]["scope"] == "span"
        assert stored["annotation"]["author"]["type"] == "person"
        assert stored["annotation"]["actor"] == stored["annotation"]["author"]
        assert "session" not in stored and "turn" not in stored
        # The edit kept the agent reference that the create copied from the run.
        assert stored["references"]["application"]["slug"] == "p"

    def test_evaluation_step_key_annotation_unchanged(self, authed_api):
        step_key = f"step-{uuid4().hex[:8]}"
        links = {step_key: {"trace_id": uuid4().hex, "span_id": "cccccccccccccccc"}}

        created = _create(
            authed_api,
            {
                "origin": "human",
                "kind": "eval",
                "channel": "web",
                "data": {"outputs": {"score": 3}},
                "references": {"evaluator": {"slug": f"eval-{uuid4().hex[:8]}"}},
                "links": links,
            },
        )
        read = _read(authed_api, created["trace_id"])

        assert read["links"] == links
        assert read["kind"] == "eval"
        assert _roles(_stored(authed_api, created["trace_id"])) == [step_key]

    def test_testcase_annotation_without_links_unchanged(self, authed_api):
        created = _create(
            authed_api,
            {
                "origin": "human",
                "channel": "web",
                "data": {"outputs": {"label": "good"}},
                "references": {
                    "evaluator": {"slug": f"tc-{uuid4().hex[:8]}"},
                    "testcase": {"id": str(uuid4())},
                },
                "links": {},
            },
        )
        read = _read(authed_api, created["trace_id"])

        assert set(read) <= SIMPLE_TRACE_FIELDS
        assert read["links"] == {}
        assert read["data"] == {"outputs": {"label": "good"}}

        stored = _ag(_stored(authed_api, created["trace_id"]))
        # Only the author and the actor; they mark the record for retention.
        assert set(stored["annotation"]) == {"author", "actor"}
        assert "session" not in stored and "turn" not in stored

    def test_sdk_annotation_call_unchanged(self, authed_api):
        evaluator_slug = f"sdk-{uuid4().hex[:8]}"
        links = {"invocation": {"trace_id": uuid4().hex, "span_id": "dddddddddddddddd"}}

        response = authed_api(
            "POST",
            "/annotations/",
            json={
                "annotation": {
                    "data": {"outputs": {"score": 1}},
                    "references": {"evaluator": {"slug": evaluator_slug}},
                    "links": links,
                }
            },
        )
        assert response.status_code == 200, response.text
        annotation = response.json()["annotation"]
        assert annotation["links"] == links

        # The evaluator schema check still refuses data of the wrong type.
        response = authed_api(
            "POST",
            "/annotations/",
            json={
                "annotation": {
                    "data": {"outputs": {"score": "one"}},
                    "references": {"evaluator": {"slug": evaluator_slug}},
                    "links": links,
                }
            },
        )
        assert response.status_code == 422

    def test_list_links_without_role_keep_key(self, authed_api):
        created = _create(
            authed_api,
            {
                "data": {"outputs": {"score": 1}},
                "references": {"evaluator": {"slug": f"list-{uuid4().hex[:8]}"}},
                "links": [{"trace_id": uuid4().hex, "span_id": "eeeeeeeeeeeeeeee"}],
            },
        )
        assert _roles(_stored(authed_api, created["trace_id"])) == ["key"]
        assert list(_read(authed_api, created["trace_id"])["links"]) == ["key"]


class TestGeneralFields:
    def test_list_links_keep_their_roles(self, authed_api):
        subject = {"trace_id": uuid4().hex, "span_id": "1111111111111111"}
        evidence = [
            {"trace_id": uuid4().hex, "span_id": "2222222222222222"},
            {"trace_id": uuid4().hex, "span_id": "3333333333333333"},
        ]
        created = _create(
            authed_api,
            {
                "data": {"outputs": {"note": "see evidence"}},
                "references": {"evaluator": {"slug": f"roles-{uuid4().hex[:8]}"}},
                "links": [
                    {**evidence[0], "attributes": {"key": "evidence"}},
                    {**evidence[1], "attributes": {"key": "evidence"}},
                    {**subject, "attributes": {"key": "subject"}},
                ],
            },
        )
        assert _roles(_stored(authed_api, created["trace_id"])) == [
            "evidence",
            "evidence",
            "subject",
        ]

    def test_unknown_scope_is_refused(self, authed_api):
        response = authed_api(
            "POST",
            "/simple/traces/",
            json={
                "trace": {
                    "data": {"outputs": {"score": 1}},
                    "references": {"evaluator": {"slug": "x"}},
                    "links": {},
                    "scope": "galaxy",
                }
            },
        )
        assert response.status_code == 422

    def test_annotation_copies_the_session_of_its_stored_subject(self, authed_api):
        run = uuid4().hex
        session_id = f"s-{uuid4().hex[:8]}"
        agent_id = str(uuid4())
        _ingest(
            authed_api,
            _run(
                run,
                session_id=session_id,
                references={"workflow": {"id": agent_id, "slug": "quotes"}},
            ),
        )

        created = _create(
            authed_api,
            {
                "origin": "human",
                "data": {"outputs": {"score": 0}},
                "references": {"evaluator": {"slug": f"thumbs-{uuid4().hex[:8]}"}},
                "links": {
                    "invocation": {"trace_id": run, "span_id": "bbbbbbbbbbbbbbbb"}
                },
                # The stored span wins over a session the request names.
                "session_id": "s-other",
            },
        )

        stored = _stored(authed_api, created["trace_id"])
        assert _ag(stored)["session"] == {"id": session_id}
        assert stored["session_id"] == session_id
        assert _ag(stored)["references"]["application"]["id"] == agent_id

        response = wait_for_response(
            authed_api,
            "POST",
            "/tracing/spans/query",
            json={
                "focus": "span",
                "filter": {
                    "operator": "and",
                    "conditions": [
                        {"field": "session_id", "operator": "is", "value": session_id},
                        {
                            "field": "attributes",
                            "key": "ag.annotation",
                            "operator": "exists",
                        },
                    ],
                },
            },
            condition_fn=lambda r: r.json().get("count", 0) >= 1,
        )
        spans = response.json()["spans"]
        assert [span["trace_id"] for span in spans] == [created["trace_id"]]

    def test_session_note_without_turn_row_is_stored_not_refused(self, authed_api):
        session_id = f"s-{uuid4().hex[:8]}"
        created = _create(
            authed_api,
            {
                "data": {"outputs": {"note": "asks for the address twice"}},
                "references": {"evaluator": {"slug": f"notes-{uuid4().hex[:8]}"}},
                "links": [],
                "scope": "session",
                "session_id": session_id,
            },
        )

        stored = _stored(authed_api, created["trace_id"])
        assert _ag(stored)["annotation"]["scope"] == "session"
        assert _ag(stored)["session"] == {"id": session_id}
        assert "turn" not in _ag(stored)
        assert not stored.get("links")
