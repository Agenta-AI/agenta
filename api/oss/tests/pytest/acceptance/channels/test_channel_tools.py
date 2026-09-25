"""Acceptance: the channel agent tool routes over HTTP, with real minted keys.

Each project is seeded over the wire with a `mock` connection (no platform
credentials, posts recorded in process), a bot binding that names an
application id, and one group space. The tool routes are then called the way
the runner calls them: the run's own key, and the workflow artifact, session
and tool call bound into the body.

Covers the success paths, every refusal (posting off, reading off, another
project's destination, no connected bot), send idempotency, and the closed
request bodies. Search over stored inbox text is covered against Postgres in
integration/channels/test_channels_dao_message_search.py; here it runs over a
project with no stored messages.
"""

from uuid import uuid4

import pytest
import requests

from oss.tests.pytest.utils.accounts import create_account
from utils.constants import BASE_TIMEOUT

pytestmark = pytest.mark.acceptance


def _client(account):
    def _request(method, endpoint, **kwargs):
        return requests.request(
            method=method,
            url=f"{account['api_url']}{endpoint}",
            headers={"Authorization": account["credentials"]},
            timeout=BASE_TIMEOUT,
            **kwargs,
        )

    return _request


def _ok(resp, status=200):
    assert resp.status_code == status, f"{resp.status_code} {resp.text}"
    return resp.json() if resp.content else None


def _seed(api):
    """A connected mock bot bound to a fresh artifact id, with one group."""

    artifact_id = str(uuid4())
    connection = _ok(
        api(
            "POST",
            "/channels/connections/",
            json={
                "connection": {
                    "channel": "mock",
                    "slug": f"tools-{uuid4().hex[:8]}",
                    "data": {"installation_id": f"mock-{uuid4().hex}"},
                }
            },
        )
    )["connection"]
    agent = _ok(
        api(
            "POST",
            "/channels/agents/",
            json={
                "agent": {
                    "connection_id": connection["id"],
                    "slug": f"bot-{uuid4().hex[:8]}",
                    "data": {"references": {"application": {"id": artifact_id}}},
                }
            },
        )
    )["agent"]
    space = _ok(
        api(
            "POST",
            "/channels/spaces/",
            json={
                "space": {
                    "connection_id": connection["id"],
                    "kind": "group",
                    "external_key": str(uuid4()),
                    "name": "qa-group",
                    "data": {"external_locator": {"team": "T1", "channel": "C1"}},
                }
            },
        )
    )["space"]
    return {
        "artifact_id": artifact_id,
        "connection": connection,
        "agent": agent,
        "space": space,
    }


def _set_tools(api, world, tools):
    _ok(
        api(
            "PUT",
            f"/channels/agents/{world['agent']['id']}",
            json={"agent": {"id": world["agent"]["id"], "data": {"tools": tools}}},
        )
    )


@pytest.fixture(scope="module")
def owner(ag_env):
    return _client(create_account(ag_env))


@pytest.fixture(scope="module")
def stranger(ag_env):
    return _client(create_account(ag_env))


@pytest.fixture(scope="module")
def world(owner):
    return _seed(owner)


@pytest.fixture(scope="module")
def foreign(stranger):
    return _seed(stranger)


@pytest.fixture(autouse=True)
def _default_settings(owner, world):
    _set_tools(
        owner,
        world,
        {"can_post_outside_conversation": True, "readable_space_keys": None},
    )
    yield


def _list(api, artifact_id, **body):
    return api(
        "POST",
        "/channels/tools/destinations/query",
        json={"artifact_id": artifact_id, **body},
    )


def _send(api, world, destination_id, *, call=None, **body):
    return api(
        "POST",
        "/channels/tools/messages/send",
        json={
            "artifact_id": world["artifact_id"],
            "session_id": "acceptance-session",
            "tool_call_id": call or f"toolu_{uuid4().hex[:8]}",
            "destination_id": destination_id,
            "text": "acceptance hello",
            **body,
        },
    )


def _destination(api, world):
    page = _ok(_list(api, world["artifact_id"]))
    [destination] = page["destinations"]
    return destination


class TestAvailabilityAndList:
    def test_availability_follows_the_binding(self, owner, world):
        yes = _ok(
            owner(
                "POST",
                "/channels/tools/availability",
                json={"artifact_id": world["artifact_id"]},
            )
        )
        no = _ok(
            owner(
                "POST",
                "/channels/tools/availability",
                json={"artifact_id": str(uuid4())},
            )
        )

        assert yes["available"] is True
        assert yes["tools"] == [
            "list_channel_destinations",
            "send_channel_message",
            "read_channel_messages",
            "search_channel_messages",
        ]
        assert no == {"available": False, "tools": []}

    def test_lists_the_bots_group_with_opaque_ids(self, owner, world):
        destination = _destination(owner, world)

        assert destination["destination_id"].startswith("dst_")
        assert destination["name"] == "qa-group"
        assert destination["can_post"] and destination["can_read"]
        assert world["connection"]["id"] not in str(destination)

    def test_no_connected_bot_lists_nothing(self, owner, world):
        page = _ok(_list(owner, str(uuid4())))

        assert page["destinations"] == []

    def test_unknown_fields_are_refused(self, owner, world):
        resp = _list(owner, world["artifact_id"], connection_id=str(uuid4()))

        assert resp.status_code == 422


class TestSend:
    def test_send_posts_and_records_the_delivery(self, owner, world):
        destination = _destination(owner, world)

        result = _ok(_send(owner, world, destination["destination_id"]))

        assert result["state"] == "sent"
        assert result["delivery_id"]

    def test_a_retried_call_returns_the_first_delivery(self, owner, world):
        destination = _destination(owner, world)
        call = f"toolu_{uuid4().hex[:8]}"

        first = _ok(_send(owner, world, destination["destination_id"], call=call))
        again = _ok(_send(owner, world, destination["destination_id"], call=call))
        other = _ok(_send(owner, world, destination["destination_id"]))

        assert again == first
        assert other["delivery_id"] != first["delivery_id"]

    def test_posting_off_refuses_the_send(self, owner, world):
        destination = _destination(owner, world)
        _set_tools(owner, world, {"can_post_outside_conversation": False})

        resp = _send(owner, world, destination["destination_id"])
        listed = _destination(owner, world)

        assert resp.status_code == 409
        assert "turned off" in resp.json()["detail"]
        assert listed["can_post"] is False

    def test_another_projects_destination_is_not_found(
        self, owner, world, stranger, foreign
    ):
        theirs = _destination(stranger, foreign)

        resp = _send(owner, world, theirs["destination_id"])

        assert resp.status_code == 404
        assert "qa-group" not in resp.text

    def test_no_connected_bot_refuses_the_send(self, owner, world):
        destination = _destination(owner, world)

        resp = _send(
            owner,
            {**world, "artifact_id": str(uuid4())},
            destination["destination_id"],
        )

        assert resp.status_code == 409
        assert "No bot is connected" in resp.json()["detail"]

    def test_identity_fields_are_refused(self, owner, world):
        destination = _destination(owner, world)

        resp = _send(owner, world, destination["destination_id"], username="ceo")

        assert resp.status_code == 422


class TestReadAndSearch:
    def test_read_returns_the_bots_own_posts(self, owner, world):
        destination = _destination(owner, world)
        _ok(_send(owner, world, destination["destination_id"], text="read me back"))

        page = _ok(
            owner(
                "POST",
                "/channels/tools/messages/read",
                json={
                    "artifact_id": world["artifact_id"],
                    "destination_id": destination["destination_id"],
                },
            )
        )

        mine = [m for m in page["messages"] if m["text"] == "read me back"]
        assert mine and mine[0]["from_bot"] is True

    def test_reading_off_refuses_read_and_search(self, owner, world):
        destination = _destination(owner, world)
        _set_tools(owner, world, {"readable_space_keys": []})

        read = owner(
            "POST",
            "/channels/tools/messages/read",
            json={
                "artifact_id": world["artifact_id"],
                "destination_id": destination["destination_id"],
            },
        )
        search = owner(
            "POST",
            "/channels/tools/messages/search",
            json={"artifact_id": world["artifact_id"], "query": "hello"},
        )

        assert read.status_code == 409
        assert search.status_code == 409

    def test_search_states_what_it_searched(self, owner, world):
        result = _ok(
            owner(
                "POST",
                "/channels/tools/messages/search",
                json={"artifact_id": world["artifact_id"], "query": "hello"},
            )
        )

        assert result["results"] == []
        [searched] = result["searched"]
        assert searched["name"] == "qa-group"
        assert searched["coverage"]

    def test_another_projects_destination_reads_as_not_found(
        self, owner, world, stranger, foreign
    ):
        theirs = _destination(stranger, foreign)

        read = owner(
            "POST",
            "/channels/tools/messages/read",
            json={
                "artifact_id": world["artifact_id"],
                "destination_id": theirs["destination_id"],
            },
        )
        search = _ok(
            owner(
                "POST",
                "/channels/tools/messages/search",
                json={
                    "artifact_id": world["artifact_id"],
                    "query": "hello",
                    "destination_ids": [theirs["destination_id"]],
                },
            )
        )

        assert read.status_code == 404
        assert search == {"results": [], "cursor": None, "searched": []}
