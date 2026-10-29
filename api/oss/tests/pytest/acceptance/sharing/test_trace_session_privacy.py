"""Trace privacy (M9), against a running API with the trace session filter on.

Alice owns a private chat; Bob is an editor of the same project with `VIEW_SPANS`.
Spans that carry the chat id are hidden from Bob, root and child, on the span query,
the trace fetch and the analytics totals, until Alice shares the chat with him. A
deleted private chat stays hidden (its tombstone); a deleted project-visible chat
does not. A trace with no chat id stays readable by both.

Runs only when the deployment has `AGENTA_API_TRACING_SESSION_FILTER_ENABLED=true`
(load the stack's env file, as for every acceptance run).
"""

import os
import secrets

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    agent_references,
    create_header,
    grant,
    heartbeat,
    new_agent,
    new_session_id,
    poll,
    revoke,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.skipif(
        os.getenv("AGENTA_API_TRACING_SESSION_FILTER_ENABLED", "").lower()
        not in ("1", "true", "yes"),
        reason="the trace session filter is off in this deployment",
    ),
]


def _trace_id() -> str:
    return secrets.token_hex(16)


def _span(trace_id, span_id, *, parent_id=None, session_id=None, cost=None):
    ag = {"type": {"trace": "invocation", "span": "task"}}
    if session_id is not None:
        ag["session"] = {"id": session_id}
    if cost is not None:
        ag["metrics"] = {"costs": {"incremental": {"total": cost}}}
    span = {
        "trace_id": trace_id,
        "span_id": span_id,
        "span_name": "child" if parent_id else "root",
        "span_kind": "SPAN_KIND_INTERNAL",
        "start_time": 1760000000,
        "end_time": 1760000001,
        "status_code": "STATUS_CODE_OK",
        "attributes": {"ag": ag},
    }
    if parent_id:
        span["parent_id"] = parent_id
    return span


def _ingest(caller, spans):
    response = caller("POST", "/tracing/spans/ingest", json={"spans": spans})
    assert response.status_code == 202, response.text


def _span_ids(caller, trace_ids):
    response = caller(
        "POST",
        "/tracing/spans/query",
        json={
            "focus": "span",
            "oldest": "2025-01-01T00:00:00Z",
            "filter": {
                "conditions": [
                    {"field": "trace_id", "operator": "in", "value": trace_ids}
                ]
            },
        },
    )
    assert response.status_code == 200, response.text
    return {span["span_id"] for span in response.json().get("spans") or []}


def _trace_span_ids(caller, trace_id):
    """The spans `GET /tracing/traces/{trace_id}` answers (the trace drawer)."""

    response = caller("GET", f"/tracing/traces/{trace_id}")
    assert response.status_code == 200, response.text
    traces = response.json().get("traces") or {}
    ids = set()

    def walk(spans):
        for value in (spans or {}).values():
            for span in value if isinstance(value, list) else [value]:
                ids.add(span["span_id"])
                walk(span.get("spans"))

    for tree in traces.values():
        walk(tree.get("spans"))
    return ids


def _analytics(caller, trace_ids):
    """(trace count, restricted) of the legacy analytics totals over these traces."""

    response = caller(
        "POST",
        "/tracing/spans/analytics",
        json={
            "focus": "trace",
            "oldest": "2025-01-01T00:00:00Z",
            "filter": {
                "conditions": [
                    {"field": "trace_id", "operator": "in", "value": trace_ids}
                ]
            },
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    count = sum(
        int((bucket.get("total") or {}).get("count") or 0)
        for bucket in body.get("buckets") or []
    )
    return count, body["access"]["restricted"]


def _analytics_restricted(caller) -> bool:
    response = caller(
        "POST",
        "/tracing/analytics/query",
        json={"windowing": {"oldest": "2025-01-01T00:00:00Z"}},
    )
    assert response.status_code == 200, response.text
    return response.json()["access"]["restricted"]


def _chat(alice, agent, *, visibility):
    """A chat of Alice on a project agent (a chat that runs an agent can be shared)."""

    session_id = new_session_id()
    response = create_header(alice, session_id, visibility=visibility)
    assert response.status_code == 200, response.text
    response = heartbeat(
        alice,
        session_id=session_id,
        is_running=False,
        references=agent_references(agent),
    )
    assert response.status_code == 200, response.text
    return session_id


def _traced_chat(alice, session_id):
    """One trace linked to the chat: the root carries the id, the child does not, and
    the child is ingested first."""

    trace_id = _trace_id()
    root, child = secrets.token_hex(8), secrets.token_hex(8)
    _ingest(alice, [_span(trace_id, child, parent_id=root, cost=0.01)])
    _ingest(alice, [_span(trace_id, root, session_id=session_id)])
    return trace_id, {root, child}


def test_trace_rule_share_unshare_delete(sharing_team):
    alice, bob = sharing_team["alice"], sharing_team["bob"]

    agent = new_agent(alice, visibility="project")
    private_id = _chat(alice, agent, visibility="private")
    visible_id = _chat(alice, agent, visibility="project")
    private_trace, private_spans = _traced_chat(alice, private_id)
    visible_trace, visible_spans = _traced_chat(alice, visible_id)
    free_trace = _trace_id()
    free_span = secrets.token_hex(8)
    _ingest(alice, [_span(free_trace, free_span)])
    traces = [private_trace, visible_trace, free_trace]
    everything = private_spans | visible_spans | {free_span}

    # The owner reads everything once ingest has landed.
    poll(lambda: _span_ids(alice, traces) >= everything or None, timeout=60)

    # Bob: nothing of the private chat, root or child; the rest stays readable.
    assert _span_ids(bob, traces) == visible_spans | {free_span}
    assert _trace_span_ids(bob, private_trace) == set()
    assert _trace_span_ids(alice, private_trace) == private_spans
    assert _analytics_restricted(bob) is True
    assert _analytics_restricted(alice) is False
    assert _analytics(alice, traces) == (3, False)
    assert _analytics(bob, traces) == (2, True)

    # Shared with Bob: readable. Share removed: hidden again.
    grant(alice, private_id, user_id=bob.user_id, role="viewer")
    assert _span_ids(bob, traces) == everything
    assert _analytics(bob, traces) == (3, False)
    revoke(alice, private_id, user_id=bob.user_id)
    assert _span_ids(bob, traces) == visible_spans | {free_span}

    # Deleting the private chat keeps it hidden; deleting the visible one does not.
    for session_id in (private_id, visible_id):
        response = alice("DELETE", "/sessions/", params={"session_id": session_id})
        assert response.status_code == 200, response.text
    assert _span_ids(bob, traces) == visible_spans | {free_span}
    assert _span_ids(alice, traces) == everything
