"""Nothing another member sends writes into, or reuses, a person's private session id
(v0.125.0 go/no-go security proof), against a running API.

Alice has two private sessions: one with a turn parked on an approval (turns, records,
a pending interaction) and one with a row but no turn yet (named before its first
turn). Bob, an editor of the same project who can run the project agent, knows both
session ids. He calls every route that reads or writes a session with that id, once
with his browser credential (Bearer) and once with the web run credential the
exchange mints for him (`Secret`).

Each call must be refused (404 with the not-found body, or 403 where the route
already knew the id), or answer without touching the id. Afterwards SQL shows Alice's
session rows unchanged: the stream row, its turns, records, interactions, inputs,
commands, attachments, executions and grants.

Every call and its answer are written to the probe log when
`AGENTA_PRIVATE_SESSION_PROBE_LOG` names a file.
"""

import json
import os
import re
from uuid import uuid4

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    NOT_FOUND_BODY,
    agent_references,
    core_rows,
    create_header,
    exchanged_run_caller,
    invoke,
    new_agent,
    new_session_id,
    poll,
    tracing_rows,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_private_session_probe"),
]

_UUID = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{32}"
)

# Core tables keyed by session id, with the columns that must not change. Liveness
# flags and timestamps of the stream row are left out: Alice's own parked turn may
# still move them.
_CORE = {
    "session_streams": (
        "id::text, visibility, owner_user_id::text, name, description, turn_id,"
        ' "references"::text, archived_at::text, deleted_at::text,'
        " created_by_id::text, tags::text"
    ),
    "session_turns": (
        "id::text, turn_index, principal_kind, principal_id::text,"
        " sender_user_id::text, origin, approved_by::text"
    ),
    "session_interactions": "id::text, status, token, kind",
    "session_inputs": "id::text, state::text",
    "session_commands": "id::text, kind, state::text",
    "session_attachments": "id::text, state::text",
    "session_executions": "execution_id::text, state::text",
}


def _snapshot(project_id, session_id) -> dict:
    snapshot = {
        table: sorted(
            json.dumps(row, sort_keys=True, default=str)
            for row in core_rows(
                f"SELECT {columns} FROM {table}"
                " WHERE project_id = $1::uuid AND session_id = $2",
                str(project_id),
                session_id,
            )
        )
        for table, columns in _CORE.items()
    }
    snapshot["session_grants"] = sorted(
        json.dumps(row, sort_keys=True)
        for row in core_rows(
            "SELECT g.user_id::text AS user_id, g.role FROM session_grants g"
            " JOIN session_streams s ON s.project_id = g.project_id"
            " AND s.id = g.stream_id"
            " WHERE s.project_id = $1::uuid AND s.session_id = $2",
            str(project_id),
            session_id,
        )
    )
    snapshot["records"] = sorted(
        json.dumps(row, sort_keys=True, default=str)
        for row in tracing_rows(
            "SELECT record_id::text AS record_id, record_index, record_type,"
            " record_source, turn_id, deleted_at::text AS deleted_at FROM records"
            " WHERE project_id = $1::uuid AND session_id = $2",
            str(project_id),
            session_id,
        )
    )
    return snapshot


def _settled(project_id, session_id) -> dict:
    """A snapshot that two reads a moment apart agree on (Alice's parked turn has
    stopped writing)."""

    def stable():
        first = _snapshot(project_id, session_id)
        return first if first == _snapshot(project_id, session_id) else None

    return poll(stable, timeout=60.0, delay=2.0)


def _pending_interaction_id(caller, session_id):
    def pending():
        response = caller(
            "POST",
            "/sessions/interactions/query",
            json={"interaction": {"session_id": session_id}},
        )
        assert response.status_code == 200, response.text
        items = [
            item
            for item in response.json().get("interactions") or []
            if item["status"] == "pending"
        ]
        return items[0]["id"] if items else None

    return poll(pending)


def _probes(session_id, *, agent, interaction_id, turn_id, token, input_id):
    """Every route that reads or writes a session, as (label, kind, method, path,
    kwargs). `kind` is "api" or "services". `turn_id`, `token` and `input_id` are
    Alice's own when her session has them (the strongest guess Bob could make)."""

    refs = agent_references(agent)
    messages = {"inputs": {"messages": [{"role": "user", "content": "hi"}]}}
    turn_id = turn_id or str(uuid4())
    token = token or f"probe-{uuid4()}"
    input_id = input_id or str(uuid4())
    image = ("probe.png", b"\x89PNG\r\n\x1a\n", "image/png")
    q = {"session_id": session_id}
    return [
        # header: the /w pre-create and a rename
        ("header visibility only", "api", "PUT", "/sessions/streams/header",
         {"params": {**q, "visibility": "project"}, "json": {}}),
        ("header rename", "api", "PUT", "/sessions/streams/header",
         {"params": q, "json": {"name": "bob was here"}}),
        ("header rename post", "api", "POST", "/sessions/streams/header",
         {"params": {**q, "visibility": "project"}, "json": {"name": "bob"}}),
        # sends and commands
        ("stream send", "api", "POST", "/sessions/streams/",
         {"json": {"session_id": session_id, "data": messages}}),
        ("stream steer", "api", "POST", "/sessions/streams/",
         {"json": {"session_id": session_id, "data": messages, "force": True}}),
        # Deprecated stop mode; drop this row when the mode is removed.
        ("stream cancel", "api", "POST", "/sessions/streams/",
         {"json": {"session_id": session_id}}),
        ("stream attach", "api", "POST", "/sessions/streams/",
         {"json": {"session_id": session_id, "attach": True}}),
        ("stream detach", "api", "POST", "/sessions/streams/detach",
         {"json": {"session_id": session_id, "watcher_id": "probe"}}),
        ("queued input", "api", "POST", "/sessions/control/inputs/admit",
         {"json": {"session_id": session_id, "content": messages, "on_busy": "queue"}}),
        ("queued steer", "api", "POST", "/sessions/control/inputs/admit",
         {"json": {"session_id": session_id, "content": messages, "on_busy": "steer"}}),
        ("input update", "api", "PATCH", f"/sessions/{session_id}/inputs/{input_id}",
         {"json": {"text": "bob edits"}}),
        ("input remove", "api", "DELETE", f"/sessions/{session_id}/inputs/{input_id}",
         {}),
        ("input send now", "api", "POST",
         f"/sessions/{session_id}/inputs/{input_id}/send-now", {}),
        ("session cancel", "api", "POST", f"/sessions/{session_id}/cancel", {"json": {}}),
        ("continuation resume", "api", "POST",
         f"/sessions/{session_id}/continuations/resume", {}),
        # runner paths
        ("heartbeat with turn", "api", "POST", "/sessions/streams/heartbeat",
         {"json": {"session_id": session_id, "replica_id": "probe", "turn_id": turn_id,
                   "is_running": True, "references": refs}}),
        ("heartbeat no turn", "api", "POST", "/sessions/streams/heartbeat",
         {"json": {"session_id": session_id, "replica_id": "probe",
                   "is_running": False}}),
        ("turn append", "api", "POST", "/sessions/turns/",
         {"json": {"session_id": session_id, "stream_id": str(uuid4()),
                   "turn_index": 99, "harness_kind": "pi_core"}}),
        ("turn complete", "api", "POST", "/sessions/turns/complete",
         {"json": {"session_id": session_id, "turn_index": 0,
                   "end_time": "2026-10-26T00:00:00Z"}}),
        ("record ingest", "api", "POST", "/sessions/records/ingest",
         {"json": {"session_id": session_id, "turn_id": turn_id, "record_index": 0,
                   "record_source": "agent", "record_type": "message",
                   "attributes": {"type": "message", "text": "bob"}}}),
        ("records incomplete", "api", "POST", "/sessions/records/incomplete",
         {"json": {"session_id": session_id}}),
        ("interaction create", "api", "POST", "/sessions/interactions/",
         {"json": {"session_id": session_id, "token": f"probe-{uuid4()}",
                   "kind": "user_approval"}}),
        ("interaction transition", "api", "POST", "/sessions/interactions/transition",
         {"json": {"session_id": session_id, "token": token, "status": "cancelled"}}),
        ("interaction cancel stale", "api", "POST",
         "/sessions/interactions/cancel-stale",
         {"json": {"session_id": session_id, "turn_id": turn_id}}),
        # approval answers
        *(
            [
                ("approval answer", "api", "POST",
                 f"/sessions/interactions/{interaction_id}/respond",
                 {"headers": {"Idempotency-Key": str(uuid4())},
                  "json": {"answer": {"approved": True}}}),
                ("approval read", "api", "GET",
                 f"/sessions/interactions/{interaction_id}", {}),
            ]
            if interaction_id
            else []
        ),
        # files
        ("attachment upload", "api", "POST", "/sessions/attachments",
         {"params": q, "files": {"file": image},
          "data": {"idempotency_key": str(uuid4())}}),
        ("attachment reference", "api", "POST", "/sessions/attachments/reference",
         {"json": {"session_id": session_id, "attachment_ids": [str(uuid4())]}}),
        ("attachment content", "api", "GET",
         f"/sessions/attachments/{uuid4()}/content", {"params": q}),
        ("mounts sign", "api", "POST", "/sessions/mounts/sign", {"params": q}),
        ("mounts list", "api", "GET", "/sessions/mounts/", {"params": q}),
        # reads
        ("stream read", "api", "GET", "/sessions/streams/", {"params": q}),
        ("session read", "api", "GET", f"/sessions/{session_id}", {}),
        ("records query", "api", "POST", "/sessions/records/query",
         {"json": {"session_id": session_id}}),
        ("turns query", "api", "POST", "/sessions/turns/query",
         {"json": {"query": {"session_id": session_id}}}),
        ("interactions query", "api", "POST", "/sessions/interactions/query",
         {"json": {"query": {"session_id": session_id}}}),
        ("sharing read", "api", "GET", f"/sessions/{session_id}/sharing", {}),
        # lifecycle
        ("archive", "api", "POST", "/sessions/archive", {"params": q}),
        ("unarchive", "api", "POST", "/sessions/unarchive", {"params": q}),
        ("stream delete", "api", "DELETE", "/sessions/streams/", {"params": q}),
        ("session delete", "api", "DELETE", "/sessions/", {"params": q}),
        # the /m and /w run path
        ("invoke", "services", "POST", "/agent/v0/invoke",
         {"headers": {"Accept": "text/event-stream"},
          "json": {"session_id": session_id,
                   "references": {"workflow_revision": {"id": agent["revision_id"]}},
                   "data": {"inputs": {"messages": [
                       {"role": "user", "content": "bob writes"}]}}}}),
    ]  # fmt: skip


def _call(caller, kind, method, path, kwargs):
    send = caller.services if kind == "services" else caller
    return send(method, path, **kwargs)


def _log(lines):
    """Opt in with `AGENTA_PRIVATE_SESSION_PROBE_LOG`. Every id (session, interaction,
    input, attachment, command, user) is masked before the line is written."""
    target = os.environ.get("AGENTA_PRIVATE_SESSION_PROBE_LOG")
    if target:
        with open(target, "a", encoding="utf-8") as handle:
            handle.write("\n".join(_UUID.sub("<id>", line) for line in lines) + "\n")


def _body(response):
    try:
        return response.json()
    except ValueError:
        return response.text[:300]


def _shape(response, *ids) -> str:
    """The answer with every id replaced, to compare a hidden id's answer with an
    unknown id's."""
    text = json.dumps(_body(response), sort_keys=True)
    for value in ids:
        text = text.replace(value, "<id>")
    return f"{response.status_code} {_UUID.sub('<uuid>', text)}"


def _alice_state(project_id, session_id):
    """Alice's current turn id and the token of her pending interaction, if any."""
    row = core_rows(
        "SELECT turn_id FROM session_streams WHERE project_id = $1::uuid"
        " AND session_id = $2",
        str(project_id),
        session_id,
    )
    tokens = core_rows(
        "SELECT token FROM session_interactions WHERE project_id = $1::uuid"
        " AND session_id = $2 AND status = 'pending'",
        str(project_id),
        session_id,
    )
    return (
        row[0]["turn_id"] if row else None,
        tokens[0]["token"] if tokens else None,
    )


@pytest.fixture
def alice_private_sessions(sharing_cast):
    """Alice's private session with a turn parked on an approval, and her private
    session with a row and no turn. The agent is project-visible, so Bob may run it:
    a refusal comes from the session, never from the agent."""

    alice = sharing_cast["alice"]
    agent = new_agent(alice, visibility="project", behavior="approval", tool="deploy")

    with_turns = new_session_id()
    parked = invoke(alice, session_id=with_turns, agent=agent, text="deploy it")
    assert parked.status_code == 200, parked.text
    interaction_id = _pending_interaction_id(alice, with_turns)

    without_turns = new_session_id()
    named = create_header(alice, without_turns, name="alice only")
    assert named.status_code == 200, named.text

    for session_id in (with_turns, without_turns):
        row = core_rows(
            "SELECT visibility, owner_user_id::text AS owner FROM session_streams"
            " WHERE project_id = $1::uuid AND session_id = $2",
            str(sharing_cast.project_id),
            session_id,
        )
        assert row == [{"visibility": "private", "owner": alice.user_id}]
    return {
        "agent": agent,
        "sessions": [
            ("with turns", with_turns, interaction_id),
            ("without turns", without_turns, None),
        ],
    }


@pytest.mark.parametrize("credential", ["bearer", "secret"])
def test_nothing_bob_sends_touches_alice_s_private_session(
    sharing_cast, alice_private_sessions, credential
):
    """Every call is refused with the canonical not-found body, or answers exactly
    what the same call on an unknown id answers. Nothing Bob sends changes Alice's
    rows or shows her content."""

    bob = sharing_cast["bob"]
    caller = bob if credential == "bearer" else exchanged_run_caller(bob)
    agent = alice_private_sessions["agent"]
    project_id = sharing_cast.project_id

    failures = []
    for shape, session_id, interaction_id in alice_private_sessions["sessions"]:
        before = _settled(project_id, session_id)
        turn_id, token = _alice_state(project_id, session_id)
        lines = [f"## {credential} / Alice's private session {shape}"]
        probes = _probes(
            session_id,
            agent=agent,
            interaction_id=interaction_id,
            turn_id=turn_id,
            token=token,
            input_id=None,
        )
        for label, kind, method, path, kwargs in probes:
            response = _call(caller, kind, method, path, kwargs)
            body = _body(response)
            secrets = ("alice only", "deploy it", interaction_id or "\0", token or "\0")
            if response.status_code < 400 and any(
                secret in response.text for secret in secrets
            ):
                failures.append(f"{shape}: {label} answered Alice's content")
            if _snapshot(project_id, session_id) != before:
                failures.append(f"{shape}: {label} wrote ({response.status_code})")

            if response.status_code == 404 and body == NOT_FOUND_BODY:
                verdict = "refused (canonical not-found)"
            elif kind == "services":
                # The run path answers in the stream: the runner's admission beat was
                # refused by the API, so the turn never started (an unknown id would
                # start a new session of Bob's instead).
                refused = (
                    "session_admission_rejected" in response.text
                    and '"type": "turn"' not in response.text
                )
                verdict = (
                    "refused (session_admission_rejected, no turn)"
                    if refused
                    else "NOT REFUSED"
                )
                if not refused:
                    failures.append(f"{shape}: {label} was not refused")
            else:
                # Not the canonical refusal: it must be the answer an unknown id gets.
                unknown = new_session_id()
                twin = [
                    p
                    for p in _probes(
                        unknown,
                        agent=agent,
                        interaction_id=interaction_id,
                        turn_id=turn_id,
                        token=token,
                        input_id=None,
                    )
                    if p[0] == label
                ][0]
                other = _call(caller, *twin[1:])
                same = _shape(response, session_id) == _shape(other, unknown)
                verdict = (
                    "same answer as an unknown id"
                    if same
                    else (f"DIFFERS from an unknown id: {_shape(other, unknown)[:160]}")
                )
                if not same:
                    failures.append(f"{shape}: {label} differs from an unknown id")
            lines.append(
                f"{response.status_code} {method} {path.replace(session_id, '<alice>')}"
                f" ({label}): {verdict}. {json.dumps(body)[:140]}"
            )
        after = _snapshot(project_id, session_id)
        lines.append(f"Alice's rows unchanged: {after == before}")
        _log(lines)
        if after != before:
            failures.append(
                f"{shape}: Alice's session changed: "
                + ", ".join(k for k in before if before[k] != after[k])
            )
    assert not failures, failures
