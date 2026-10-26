"""Session files follow the session's access (M3), against a running API.

The mount credential of a session's working directory is signed only for a caller
who may run the session: a participant of a private session, not a member it is
hidden from, and not a member who left the project.
"""

import pytest

from oss.tests.pytest.acceptance.sharing.support import (
    NOT_FOUND_BODY,
    grant,
    invoke,
    new_agent,
    new_session_id,
    readd_member,
    remove_member,
    revoke,
)
from oss.tests.pytest.utils.mounts import skip_if_mount_storage_unavailable

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.xdist_group("sharing_session_files_follow_session"),
]


def _sign(caller, session_id):
    return caller(
        "POST",
        "/sessions/mounts/sign",
        params={"session_id": session_id, "name": "cwd"},
    )


def test_removed_member_credential_request_denied(sharing_cast):
    alice, bob = sharing_cast["alice"], sharing_cast["bob"]
    agent = new_agent(alice, visibility="project")
    session_id = new_session_id()
    turn = invoke(alice, session_id=session_id, agent=agent)
    assert turn.status_code == 200, turn.text

    owner_sign = _sign(alice, session_id)
    skip_if_mount_storage_unavailable(owner_sign)
    assert owner_sign.status_code == 200, owner_sign.text

    # Hidden from Bob: the canonical not-found answer.
    hidden = _sign(bob, session_id)
    assert (hidden.status_code, hidden.json()) == (404, NOT_FOUND_BODY)

    grant(alice, session_id, user_id=bob.user_id, role="viewer")
    viewer = _sign(bob, session_id)
    assert viewer.status_code == 403, viewer.text
    assert viewer.json()["detail"]["details"]["reason"] == "resource_denied"

    grant(alice, session_id, user_id=bob.user_id, role="participant")
    participant = _sign(bob, session_id)
    assert participant.status_code == 200, participant.text

    remove_member(sharing_cast, "bob")
    try:
        removed = _sign(bob, session_id)
        # Not a member of the project any more: refused before any session check.
        assert removed.status_code in (401, 403), removed.text
        assert "credentials" not in removed.text
    finally:
        readd_member(sharing_cast, "bob")

    revoke(alice, session_id, user_id=bob.user_id)
    revoked = _sign(bob, session_id)
    assert (revoked.status_code, revoked.json()) == (404, NOT_FOUND_BODY)
