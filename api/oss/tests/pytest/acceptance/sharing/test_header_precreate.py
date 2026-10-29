"""The /w pre-create of a new chat, against a running API (M3 regression).

/w creates a new chat as a project-visible session before its first run, with a header
call that carries only `visibility` (no name: the chat has no title yet). The header
route refused that call (422, "no header field to update"), so every first /w send
failed with "Message wasn't sent".
"""

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    core_rows,
    new_session_id,
    stream_row,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_header_precreate"),
]


def _name(project_id, session_id):
    rows = core_rows(
        "SELECT name FROM session_streams WHERE project_id = $1::uuid "
        "AND session_id = $2",
        project_id,
        session_id,
    )
    return rows[0]["name"]


def _put_header(caller, session_id, *, body, visibility=None):
    params = {"session_id": session_id}
    if visibility is not None:
        params["visibility"] = visibility
    return caller("PUT", "/sessions/streams/header", params=params, json=body)


def test_a_visibility_only_header_creates_a_project_session(sharing_cast):
    alice = sharing_cast["alice"]
    session_id = new_session_id()

    created = _put_header(alice, session_id, body={}, visibility="project")
    assert created.status_code == 200, created.text
    stream = created.json()["stream"]
    assert stream["name"] is None
    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("project", alice.user_id)


def test_a_visibility_only_header_leaves_an_existing_session_unchanged(sharing_cast):
    alice = sharing_cast["alice"]
    session_id = new_session_id()
    named = _put_header(alice, session_id, body={"name": "kept"}, visibility="private")
    assert named.status_code == 200, named.text

    again = _put_header(alice, session_id, body={}, visibility="project")
    assert again.status_code == 200, again.text
    # It returns no session data for an existing session (it is checked like a send).
    assert again.json()["stream"] is None
    assert _name(sharing_cast.project_id, session_id) == "kept"
    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("private", alice.user_id)


def test_an_empty_header_without_a_visibility_is_still_refused(sharing_cast):
    response = _put_header(sharing_cast["alice"], new_session_id(), body={})
    assert response.status_code == 422, response.text


def test_a_member_s_pre_create_on_a_colleague_s_project_chat_changes_nothing(
    sharing_cast,
):
    """Bob opens Alice's project chat before its first answer, and his first send
    pre-creates it again: the call needs what a send needs, so it passes and changes
    nothing (Alice stays the owner, her name stays)."""
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    session_id = new_session_id()
    created = _put_header(
        alice, session_id, body={"name": "alice's"}, visibility="project"
    )
    assert created.status_code == 200, created.text

    again = _put_header(bob, session_id, body={}, visibility="project")
    assert again.status_code == 200, again.text
    assert again.json()["stream"] is None
    assert _name(sharing_cast.project_id, session_id) == "alice's"
    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("project", alice.user_id)

    # A rename still needs the edit right: only Alice renames her chat.
    rename = _put_header(bob, session_id, body={"name": "bob's"})
    assert rename.status_code == 403, rename.text


def test_a_pre_create_on_a_hidden_chat_answers_not_found(sharing_cast):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    session_id = new_session_id()
    created = _put_header(
        alice, session_id, body={"name": "mine"}, visibility="private"
    )
    assert created.status_code == 200, created.text

    hidden = _put_header(bob, session_id, body={}, visibility="project")
    assert hidden.status_code == 404, hidden.text
    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("private", alice.user_id)
