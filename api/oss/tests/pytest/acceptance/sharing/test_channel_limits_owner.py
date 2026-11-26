"""Channel limits of a private agent, against a running API: only its owner
changes its people list and its rules, whether its binding is on or off."""

from uuid import uuid4

import pytest

from oss.tests.pytest.acceptance.sharing.support import NOT_FOUND_BODY, new_agent

pytestmark = [
    pytest.mark.acceptance,
    pytest.mark.integration,
    pytest.mark.xdist_group("sharing_channel_limits"),
]


def _bind(caller, cast, references):
    response = caller(
        "POST",
        "/channels/agents/",
        json={
            "agent": {
                "connection_id": cast.installation.connection["id"],
                "slug": f"m10-binding-{uuid4().hex[:8]}",
                "data": {"references": references},
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["agent"]["id"]


def _edit(caller, binding_id, data=None, flags=None):
    agent = {"id": binding_id}
    if data is not None:
        agent["data"] = data
    if flags is not None:
        agent["flags"] = flags
    return caller("PUT", f"/channels/agents/{binding_id}", json={"agent": agent})


def _grant(caller, binding_id):
    return caller(
        "POST",
        "/channels/grants/",
        json={
            "grant": {
                "agent_id": binding_id,
                "effect": "allow",
                "kind": "private",
                "data": {},
            }
        },
    )


def test_only_the_owner_changes_a_private_agents_limits(sharing_cast):
    alice = sharing_cast["alice"]
    bob = sharing_cast["bob"]
    private = new_agent(alice, visibility="private")
    binding_id = _bind(
        alice, sharing_cast, {"workflow_revision": {"id": private["revision_id"]}}
    )
    audience = {"audience": {"senders": ["U-BOB"], "labels": {}}}

    for flags in ({"is_active": True}, {"is_active": False}):
        assert _edit(alice, binding_id, flags=flags).status_code == 200

        refused = _edit(bob, binding_id, data=audience)
        assert (refused.status_code, refused.json()) == (404, NOT_FOUND_BODY)
        refused = _grant(bob, binding_id)
        assert (refused.status_code, refused.json()) == (404, NOT_FOUND_BODY)

    allowed = _edit(alice, binding_id, data=audience)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["agent"]["data"]["audience"]["senders"] == ["U-BOB"]
    granted = _grant(alice, binding_id)
    assert granted.status_code == 200, granted.text


def test_a_binding_cannot_be_moved_away_edited_and_moved_back(sharing_cast):
    alice = sharing_cast["alice"]
    bob = sharing_cast["bob"]
    private = new_agent(alice, visibility="private")
    private_refs = {"workflow_revision": {"id": private["revision_id"]}}
    binding_id = _bind(alice, sharing_cast, private_refs)
    owned = _edit(
        alice,
        binding_id,
        data={"audience": {"senders": ["U-ALICE"], "labels": {}}},
        flags={"is_active": False},
    )
    assert owned.status_code == 200, owned.text

    mine = new_agent(bob, visibility="project")
    moved = _edit(
        bob,
        binding_id,
        data={"references": {"workflow_revision": {"id": mine["revision_id"]}}},
    )
    assert moved.status_code == 200, moved.text
    opened = _edit(bob, binding_id, data={"audience": {"senders": [], "labels": {}}})
    assert opened.status_code == 200, opened.text

    back = _edit(bob, binding_id, data={"references": private_refs})
    assert (back.status_code, back.json()) == (404, NOT_FOUND_BODY)


def test_only_the_owner_creates_a_binding_with_a_people_list(sharing_cast):
    """Creating a binding that is off but already has a people list is a limits
    write too: someone else is refused, the owner is not."""

    alice = sharing_cast["alice"]
    bob = sharing_cast["bob"]
    private = new_agent(alice, visibility="private")

    def _create(caller):
        return caller(
            "POST",
            "/channels/agents/",
            json={
                "agent": {
                    "connection_id": sharing_cast.installation.connection["id"],
                    "slug": f"m10-off-{uuid4().hex[:8]}",
                    "data": {
                        "references": {
                            "workflow_revision": {"id": private["revision_id"]}
                        },
                        "audience": {"senders": ["U-BOB"], "labels": {}},
                    },
                    "flags": {"is_active": False},
                }
            },
        )

    refused = _create(bob)
    assert (refused.status_code, refused.json()) == (404, NOT_FOUND_BODY)
    created = _create(alice)
    assert created.status_code == 200, created.text
    assert created.json()["agent"]["data"]["audience"]["senders"] == ["U-BOB"]
