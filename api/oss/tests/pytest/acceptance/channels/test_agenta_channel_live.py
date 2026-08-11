"""Acceptance: the whole path with no platform credentials of any kind --
create a connection, post a message with the caller's own API key, let it
invoke, and read the answer back.

Needs a deployed stack (`ag_env`) and the connections write path
(`POST /channels/connections/`) from the sibling package this one lands
beside. Not runnable in isolation before that merge -- written against the
contract both packages agree on.
"""

from uuid import uuid4

import pytest

pytestmark = pytest.mark.acceptance


@pytest.mark.usefixtures("cls_account")
class TestAgentaChannelLive:
    def test_post_invoke_and_read_the_answer_back(self, authed_api):
        bot_slug = f"agenta-acceptance-{uuid4().hex[:8]}"

        created = authed_api(
            "POST",
            "/channels/connections/",
            json={
                "connection": {
                    "channel": "agenta",
                    "slug": bot_slug,
                    "data": {"bot": bot_slug},
                }
            },
        )
        assert created.status_code == 200, created.text

        message_id = f"msg-{uuid4().hex[:8]}"
        posted = authed_api(
            "POST",
            "/channels/agenta/events/",
            json={
                "project": created.json()["connection"]["data"]["connection_locator"][
                    "project"
                ],
                "bot": bot_slug,
                "user": f"user-{uuid4().hex[:8]}",
                "id": message_id,
                "text": "hello from the acceptance check",
            },
        )
        assert posted.status_code == 202, posted.text

        space_id = _poll_for_space(authed_api, connection_slug=bot_slug)
        answer = _poll_for_answer(authed_api, space_id=space_id)

        assert answer is not None, "no outbound reply was posted within the timeout"


def _poll_for_space(authed_api, *, connection_slug, attempts=20, delay=0.5):
    import time

    for _ in range(attempts):
        connections = authed_api(
            "POST",
            "/channels/connections/query",
            json={"connection": {"slug": connection_slug}},
        ).json()
        connection = next(iter(connections.get("connections", [])), None)
        if connection is not None:
            spaces = authed_api(
                "POST",
                "/channels/spaces/query",
                json={"space": {"connection_id": connection["id"]}},
            ).json()
            if spaces.get("spaces"):
                return spaces["spaces"][0]["id"]
        time.sleep(delay)

    raise AssertionError("no space resolved for the connection within the timeout")


def _poll_for_answer(authed_api, *, space_id, attempts=40, delay=0.5):
    import time

    for _ in range(attempts):
        response = authed_api("GET", f"/channels/agenta/conversations/{space_id}")
        if response.status_code == 200:
            items = response.json().get("items", [])
            outbound = [item for item in items if item["direction"] == "outbound"]
            if outbound:
                return outbound[-1]
        time.sleep(delay)

    return None
