"""Acceptance tests for per-turn usage on /sessions/turns/.

A turn gets its tokens and cost from two writers. The runner sends its figure when it
completes the turn, and only a request with the runner token is kept. Ingest then writes
the priced usage of the trace root to the turn with the same trace id, with source
`trace`, over the runner figure. A trace that no turn carries updates no turn.
"""

import os
import time
from uuid import UUID, uuid4

import pytest

HARNESS_KIND = "pi_core"
WRITE_BACK_TIMEOUT = 60


def _start_turn(authed_api, *, trace_id):
    session_id = str(uuid4())
    response = authed_api(
        "PUT",
        "/sessions/streams/header",
        params={"session_id": session_id},
        json={"name": "turn usage"},
    )
    assert response.status_code == 200, response.text
    stream_id = response.json()["stream"]["id"]

    response = authed_api(
        "POST",
        "/sessions/turns/",
        json={
            "session_id": session_id,
            "stream_id": stream_id,
            "turn_index": 0,
            "harness_kind": HARNESS_KIND,
            "trace_id": str(trace_id),
        },
    )
    assert response.status_code == 200, response.text
    return session_id


def _complete_turn(authed_api, *, session_id, usage, headers=None):
    response = authed_api(
        "POST",
        "/sessions/turns/complete",
        headers=dict(headers or {}),
        json={
            "session_id": session_id,
            "turn_index": 0,
            "end_time": "2026-10-30T00:00:00Z",
            "usage": usage,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["turn"]


def _turn(authed_api, session_id):
    response = authed_api(
        "POST",
        "/sessions/turns/query",
        json={"query": {"session_id": session_id}},
    )
    assert response.status_code == 200, response.text
    turns = response.json()["turns"]
    assert len(turns) == 1, turns
    return turns[0]


def _ingest_priced_trace(authed_api, *, trace_id):
    """A root span with one chat child that used 10 input and 5 output tokens for
    0.02. Ingest rolls the child's figures up to the root."""

    root_span_id = uuid4().hex[16:]
    child_span_id = uuid4().hex[16:]
    response = authed_api(
        "POST",
        "/tracing/traces/",
        json={
            "traces": {
                trace_id.hex: {
                    "spans": {
                        "agent": {
                            "trace_id": trace_id.hex,
                            "span_id": root_span_id,
                            "span_name": "agent",
                            "span_kind": "SPAN_KIND_SERVER",
                            "start_time": 1761782400,
                            "end_time": 1761782410,
                            "status_code": "STATUS_CODE_OK",
                            "attributes": {"ag": {"type": {"span": "workflow"}}},
                            "spans": {
                                "chat": {
                                    "trace_id": trace_id.hex,
                                    "span_id": child_span_id,
                                    "parent_id": root_span_id,
                                    "span_name": "chat",
                                    "span_kind": "SPAN_KIND_CLIENT",
                                    "start_time": 1761782401,
                                    "end_time": 1761782409,
                                    "status_code": "STATUS_CODE_OK",
                                    "attributes": {
                                        "ag": {
                                            "type": {"span": "chat"},
                                            "metrics": {
                                                "costs": {
                                                    "incremental": {"total": 0.02}
                                                },
                                                "tokens": {
                                                    "incremental": {
                                                        "prompt": 10,
                                                        "completion": 5,
                                                        "total": 15,
                                                    }
                                                },
                                            },
                                        }
                                    },
                                }
                            },
                        }
                    }
                }
            }
        },
    )
    assert response.status_code == 202, response.text


def _wait_for_source(authed_api, session_id, source):
    deadline = time.monotonic() + WRITE_BACK_TIMEOUT
    turn = _turn(authed_api, session_id)
    while (turn.get("usage") or {}).get("source") != source:
        if time.monotonic() > deadline:
            raise AssertionError(f"turn usage never reached source {source}: {turn}")
        time.sleep(1)
        turn = _turn(authed_api, session_id)
    return turn["usage"]


class TestTurnUsage:
    def test_usage_without_the_runner_token_is_not_stored(self, authed_api):
        session_id = _start_turn(authed_api, trace_id=uuid4())

        turn = _complete_turn(
            authed_api,
            session_id=session_id,
            usage={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
        )

        assert turn.get("usage") is None

    def test_runner_usage_is_stored_on_completion(self, authed_api):
        runner_token = os.getenv("AGENTA_RUNNER_TOKEN")
        if not runner_token:
            pytest.skip("AGENTA_RUNNER_TOKEN is not set for this run")
        session_id = _start_turn(authed_api, trace_id=uuid4())

        turn = _complete_turn(
            authed_api,
            session_id=session_id,
            usage={"input_tokens": 3, "output_tokens": 4, "total_tokens": 7},
            headers={"X-Agenta-Runner-Token": runner_token},
        )

        # The response leaves out null fields: no cost was reported.
        assert turn["usage"] == {
            "input_tokens": 3,
            "output_tokens": 4,
            "total_tokens": 7,
            "source": "runner",
        }

    def test_the_priced_trace_replaces_the_runner_usage(self, authed_api):
        runner_token = os.getenv("AGENTA_RUNNER_TOKEN")
        trace_id = UUID(uuid4().hex)
        session_id = _start_turn(authed_api, trace_id=trace_id)
        if runner_token:
            _complete_turn(
                authed_api,
                session_id=session_id,
                usage={"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
                headers={"X-Agenta-Runner-Token": runner_token},
            )

        _ingest_priced_trace(authed_api, trace_id=trace_id)

        usage = _wait_for_source(authed_api, session_id, "trace")
        assert (
            usage["input_tokens"],
            usage["output_tokens"],
            usage["total_tokens"],
        ) == (10, 5, 15)
        assert usage["cost"] == pytest.approx(0.02)

    def test_a_trace_of_another_turn_leaves_this_turn_alone(self, authed_api):
        other = uuid4()
        session_id = _start_turn(authed_api, trace_id=uuid4())
        other_session_id = _start_turn(authed_api, trace_id=other)

        _ingest_priced_trace(authed_api, trace_id=other)
        _wait_for_source(authed_api, other_session_id, "trace")

        assert _turn(authed_api, session_id).get("usage") is None
