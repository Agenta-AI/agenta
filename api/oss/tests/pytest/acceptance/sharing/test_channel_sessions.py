"""Channel sessions and channel bindings, against a running API.

A channel turn runs as the installation. A project agent's channel session has no owner
and every member reads it, even when the sender is a linked member. A private agent may
answer a channel (owner ruling 2026-10-26): only its owner binds it, whichever reference
family names it, and a make-private keeps its bindings on. The channel is the mock
`agenta` channel; its turns are real turns on the mock harness.
"""

from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.agenta.capabilities import (
    fetch_agenta_capabilities,
)
from oss.src.core.channels.identity import compose_external_user_key
from oss.tests.pytest.acceptance.sharing.support import (
    NOT_FOUND_BODY,
    core_rows,
    fetch_sharing,
    listed_sessions,
    new_agent,
    poll,
    stream_is_readable,
    stream_row,
    turn_rows,
)

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_channel_sessions"),
]


def _link(cast, *, platform_user_id, user_id):
    """Link a platform user of the connection to a member (what the channel's link
    flow writes)."""

    key = compose_external_user_key(
        fetch_agenta_capabilities(), platform_user_id, scope_id=platform_user_id
    )
    core_rows(
        "INSERT INTO channel_identity_links"
        " (id, project_id, connection_id, user_id, external_user_key, created_by_id)"
        " VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $4::uuid)",
        str(uuid4()),
        str(cast.project_id),
        str(cast.installation.connection["id"]),
        str(user_id),
        key,
    )


def _channel_session(cast, *, platform_user_id):
    connection = cast.installation.connection
    posted = cast.alice_key(
        "POST",
        "/channels/agenta/events/",
        json={
            "project": connection["data"]["connection_locator"]["project"],
            "bot": connection["data"]["connection_locator"]["bot"],
            "user": platform_user_id,
            "id": f"msg-{uuid4().hex[:8]}",
            "text": "hello from the channel",
        },
    )
    assert posted.status_code == 202, posted.text

    def thread_session():
        # The only channel message of this cast: the thread of the binding.
        rows = core_rows(
            "SELECT session_id FROM channel_threads"
            " WHERE project_id = $1::uuid AND agent_id = $2::uuid",
            str(cast.project_id),
            str(cast.installation.id),
        )
        return rows[0]["session_id"] if rows else None

    session_id = poll(thread_session, timeout=40)
    assert session_id, "the channel message opened no session"
    turns = poll(lambda: turn_rows(cast.project_id, session_id), timeout=40)
    assert turns, "the channel turn did not run"
    return session_id, turns


def test_linked_sender_session_ownerless_readable(sharing_cast):
    alice = sharing_cast.people["alice"]
    platform_user_id = f"alice-{uuid4().hex[:8]}"
    _link(sharing_cast, platform_user_id=platform_user_id, user_id=alice.user_id)

    session_id, turns = _channel_session(
        sharing_cast, platform_user_id=platform_user_id
    )

    # The turn ran as the installation, with Alice as the linked sender.
    assert [
        (row["principal_kind"], row["principal_id"], row["sender_user_id"])
        for row in turns
    ] == [("installation", sharing_cast.installation.id, alice.user_id)]
    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], row["owner_user_id"]) == ("project", None)
    for label in ("bob", "carol", "alice"):
        caller = sharing_cast[label]
        assert stream_is_readable(caller, session_id), label
        assert session_id in listed_sessions(caller), label

    # A channel session is not shareable: nobody owns it.
    sharing = fetch_sharing(sharing_cast["alice"], session_id)
    assert sharing.status_code == 200, sharing.text
    assert sharing.json()["sharing"]["shareable"] is False
    assert sharing.json()["sharing"]["not_shareable_reason"] == "channel"


def _bind(caller, cast, references):
    return caller(
        "POST",
        "/channels/agents/",
        json={
            "agent": {
                "connection_id": cast.installation.connection["id"],
                "slug": f"m3-binding-{uuid4().hex[:8]}",
                "data": {"references": references},
            }
        },
    )


def test_only_the_owner_binds_a_private_agent(sharing_cast):
    alice = sharing_cast["alice"]
    bob = sharing_cast["bob"]
    private = new_agent(alice, visibility="private")
    references = {"workflow_revision": {"id": private["revision_id"]}}

    # Bob cannot see Alice's private agent, so he cannot put it in a channel.
    refused = _bind(bob, sharing_cast, references)
    assert (refused.status_code, refused.json()) == (404, NOT_FOUND_BODY)
    bound = _bind(alice, sharing_cast, references)
    assert bound.status_code == 200, bound.text
    assert bound.json()["agent"]["flags"]["is_active"] is True

    # Made private after it was bound: the binding stays on.
    shared = new_agent(alice, visibility="project")
    bound = _bind(
        alice, sharing_cast, {"workflow_revision": {"id": shared["revision_id"]}}
    )
    assert bound.status_code == 200, bound.text
    binding_id = bound.json()["agent"]["id"]
    response = alice(
        "POST",
        f"/workflows/{shared['id']}/sharing/visibility",
        json={"visibility": "private"},
    )
    assert response.status_code == 200, response.text
    binding = alice("GET", f"/channels/agents/{binding_id}")
    assert binding.status_code == 200, binding.text
    assert binding.json()["agent"]["flags"]["is_active"] is True


def _set_active(caller, binding_id, is_active):
    return caller(
        "PUT",
        f"/channels/agents/{binding_id}",
        json={"agent": {"id": binding_id, "flags": {"is_active": is_active}}},
    )


def test_flags_only_reactivation_of_a_private_agent(sharing_cast):
    alice = sharing_cast["alice"]
    bob = sharing_cast["bob"]

    # A project agent's binding: a flags-only edit turns it off and on again.
    shared = new_agent(alice, visibility="project")
    bound = _bind(
        alice, sharing_cast, {"workflow_revision": {"id": shared["revision_id"]}}
    )
    assert bound.status_code == 200, bound.text
    binding_id = bound.json()["agent"]["id"]
    for is_active in (False, True):
        response = _set_active(alice, binding_id, is_active)
        assert response.status_code == 200, response.text
        assert response.json()["agent"]["flags"]["is_active"] is is_active

    # Made private and turned off: the owner turns it on with a flags-only edit;
    # another member cannot.
    response = alice(
        "POST",
        f"/workflows/{shared['id']}/sharing/visibility",
        json={"visibility": "private"},
    )
    assert response.status_code == 200, response.text
    assert _set_active(alice, binding_id, False).status_code == 200
    refused = _set_active(bob, binding_id, True)
    assert (refused.status_code, refused.json()) == (404, NOT_FOUND_BODY)
    binding = alice("GET", f"/channels/agents/{binding_id}")
    assert binding.status_code == 200, binding.text
    assert binding.json()["agent"]["flags"]["is_active"] is False
    turned_on = _set_active(alice, binding_id, True)
    assert turned_on.status_code == 200, turned_on.text
    assert turned_on.json()["agent"]["flags"]["is_active"] is True


def test_application_family_reference_is_resolved(sharing_cast):
    alice = sharing_cast["alice"]
    private = new_agent(alice, visibility="private")
    shared = new_agent(alice, visibility="project")

    for key, field in (
        ("application_revision", "revision_id"),
        ("application_variant", "variant_id"),
        ("application", "id"),
    ):
        # Each family resolves to the agent: refused for another member, bound for
        # its owner.
        refused = _bind(
            sharing_cast["bob"], sharing_cast, {key: {"id": private[field]}}
        )
        assert (refused.status_code, refused.json()) == (404, NOT_FOUND_BODY), key
        bound = _bind(alice, sharing_cast, {key: {"id": private[field]}})
        assert bound.status_code == 200, (key, bound.text)

    bound = _bind(
        alice, sharing_cast, {"application_revision": {"id": shared["revision_id"]}}
    )
    assert bound.status_code == 200, bound.text


def test_a_private_agent_s_channel_chat_belongs_to_its_owner(sharing_cast):
    """Alice binds her private agent to a channel (her API key and a channel run's
    credential cannot). Someone in the
    channel writes to it: the turn runs as the binding, and the new chat is private to
    Alice. She reads it; Bob neither reads nor lists it."""

    alice = sharing_cast["alice"]
    bob = sharing_cast["bob"]
    owner_id = str(sharing_cast.people["alice"].user_id)
    private = new_agent(alice, visibility="private", name="m3 private channel agent")
    slug = f"m3-private-{uuid4().hex[:8]}"
    created = alice(
        "POST",
        "/channels/connections/",
        json={"connection": {"channel": "agenta", "slug": slug, "data": {"bot": slug}}},
    )
    assert created.status_code == 200, created.text
    connection = created.json()["connection"]
    binding = {
        "agent": {
            "connection_id": connection["id"],
            "slug": f"m3-binding-{uuid4().hex[:8]}",
            "data": {
                "references": {"workflow_revision": {"id": private["revision_id"]}}
            },
        }
    }

    # An API key acts for Alice, but only Alice as a person binds her private agent.
    refused = sharing_cast.alice_key("POST", "/channels/agents/", json=binding)
    assert (refused.status_code, refused.json()) == (404, NOT_FOUND_BODY)
    # Neither does a channel run's credential (an installation acting for Alice).
    refused = sharing_cast.installation.caller(
        "POST", "/channels/agents/", json=binding
    )
    assert (refused.status_code, refused.json()) == (404, NOT_FOUND_BODY)
    bound = alice("POST", "/channels/agents/", json=binding)
    assert bound.status_code == 200, bound.text
    binding_id = bound.json()["agent"]["id"]
    marked = alice("POST", f"/channels/agents/{binding_id}/default")
    assert marked.status_code == 200, marked.text

    posted = sharing_cast.alice_key(
        "POST",
        "/channels/agenta/events/",
        json={
            "project": connection["data"]["connection_locator"]["project"],
            "bot": connection["data"]["connection_locator"]["bot"],
            "user": f"someone-{uuid4().hex[:8]}",
            "id": f"msg-{uuid4().hex[:8]}",
            "text": "hello, private agent",
        },
    )
    assert posted.status_code == 202, posted.text

    def thread_session():
        rows = core_rows(
            "SELECT session_id FROM channel_threads"
            " WHERE project_id = $1::uuid AND agent_id = $2::uuid",
            str(sharing_cast.project_id),
            binding_id,
        )
        return rows[0]["session_id"] if rows else None

    session_id = poll(thread_session, timeout=40)
    assert session_id, "the channel message opened no session"
    turns = poll(lambda: turn_rows(sharing_cast.project_id, session_id), timeout=40)
    assert turns, "the private agent's channel turn did not run"
    assert [(row["principal_kind"], str(row["principal_id"])) for row in turns] == [
        ("installation", binding_id)
    ]

    row = stream_row(sharing_cast.project_id, session_id)
    assert (row["visibility"], str(row["owner_user_id"])) == ("private", owner_id)
    assert stream_is_readable(alice, session_id)
    assert session_id in listed_sessions(alice)
    assert not stream_is_readable(bob, session_id)
    assert session_id not in listed_sessions(bob)
