"""Acceptance test for the record-ingest contract on POST /sessions/records/ingest.

Pins the regression from debug/qa-sessions-rebase/FINDING-record-ingest-422.md: the runner
posts a 16-hex OTel span_id, and the API had typed span_id as UUID (32 hex) — so every
ingest 422'd and session records silently dropped. This drives the endpoint with the body the
runner actually sends and asserts it is accepted (200) and lands as a queryable record whose
span_id round-trips.

Requires a live stack (AGENTA_API_URL/AGENTA_AUTH_KEY) with the record worker running — see
the pytest `acceptance` marker.
"""

import time
import uuid


class TestRecordIngestContract:
    """POST /sessions/records/ingest accepts the runner-shaped body (16-hex span_id) and the
    record becomes queryable with the span id intact."""

    def test_runner_shaped_ingest_is_accepted_and_persists(self, authed_api):
        session_id = str(uuid.uuid4())
        # Exactly the shape services/runner/src/sessions/persist.ts posts: a 16-hex OTel span
        # id (NOT a UUID), a turn_id, a per-turn record_index, and the event as attributes.
        span_id = uuid.uuid4().hex[:16]
        turn_id = f"turn-{uuid.uuid4().hex[:8]}"

        ingest = authed_api(
            "POST",
            "/sessions/records/ingest",
            json={
                "session_id": session_id,
                "record_index": 0,
                "timestamp": "2026-07-18T00:00:00.000Z",
                "record_source": "agent",
                "record_type": "message",
                "attributes": {"type": "message", "text": "hello from the runner"},
                "turn_id": turn_id,
                "span_id": span_id,
            },
        )
        assert ingest.status_code == 200, ingest.text
        assert ingest.json() == {"ok": True}

        # The record flows through Redis -> worker -> DB; poll the query endpoint until it lands.
        record = None
        deadline = time.time() + 20
        while time.time() < deadline:
            query = authed_api(
                "POST", "/sessions/records/query", json={"session_id": session_id}
            )
            assert query.status_code == 200, query.text
            records = query.json().get("records", [])
            if records:
                record = records[0]
                break
            time.sleep(1)

        assert record is not None, "ingested record never became queryable"
        assert record["turn_id"] == turn_id
        assert record["span_id"] == span_id

    def test_a_uuid_span_id_is_rejected(self, authed_api):
        """A 32-hex UUID is not a span id; the endpoint must reject it (422), which is exactly
        the validation that a 16-hex span id must pass."""
        response = authed_api(
            "POST",
            "/sessions/records/ingest",
            json={
                "session_id": str(uuid.uuid4()),
                "record_source": "agent",
                "span_id": uuid.uuid4().hex,  # 32 hex — a UUID, not a span id
            },
        )
        assert response.status_code == 422, response.text


def _frame_batch(session_id: str, execution_id: str) -> list:
    return [
        {
            "version": 1,
            "kind": "frame",
            "session_id": session_id,
            "execution_id": execution_id,
            "frame_or_event_id": f"{execution_id}:0",
            "frame_index": 0,
            "entity_id": "message-1",
            "type": "text-delta",
            "payload": {"id": "message-1", "delta": "partial"},
            "created_at": "2026-10-26T00:00:00.000Z",
        }
    ]


class TestRecordIngestAfterTheTurnStopped:
    """After a Stop (or a takeover, or a newer turn) the turn is no longer the session's
    running turn. Its live frames answer 409, never 403: the runner reads 403 as lost
    access and would then drop the turn's own records. Those records are still accepted.
    An unknown session keeps its 403."""

    def test_a_frame_of_a_turn_that_is_not_running_answers_409(self, authed_api):
        session_id = str(uuid.uuid4())
        header = authed_api(
            "PUT",
            "/sessions/streams/header",
            params={"session_id": session_id},
            json={"name": "stopped turn"},
        )
        assert header.status_code == 200, header.text

        response = authed_api(
            "POST",
            "/sessions/records/ingest",
            json=_frame_batch(session_id, str(uuid.uuid4())),
        )
        assert response.status_code == 409, response.text

    def test_a_frame_of_an_unknown_session_answers_403(self, authed_api):
        response = authed_api(
            "POST",
            "/sessions/records/ingest",
            json=_frame_batch(str(uuid.uuid4()), str(uuid.uuid4())),
        )
        assert response.status_code == 403, response.text

    def test_the_stopped_turn_s_partial_answer_and_done_record_are_accepted(
        self, authed_api
    ):
        session_id = str(uuid.uuid4())
        turn_id = str(uuid.uuid4())
        for index, (record_type, attributes) in enumerate(
            (
                ("message", {"type": "message", "text": "a partial answer"}),
                ("done", {"type": "done", "stopReason": "cancelled"}),
            )
        ):
            ingest = authed_api(
                "POST",
                "/sessions/records/ingest",
                json={
                    "session_id": session_id,
                    "record_index": index,
                    "timestamp": "2026-10-26T00:00:00.000Z",
                    "record_source": "agent",
                    "record_type": record_type,
                    "attributes": attributes,
                    "turn_id": turn_id,
                },
            )
            assert ingest.status_code == 200, ingest.text

        types = []
        deadline = time.time() + 20
        while time.time() < deadline:
            query = authed_api(
                "POST", "/sessions/records/query", json={"session_id": session_id}
            )
            assert query.status_code == 200, query.text
            types = [r["record_type"] for r in query.json().get("records", [])]
            if len(types) == 2:
                break
            time.sleep(1)
        assert types == ["message", "done"]
