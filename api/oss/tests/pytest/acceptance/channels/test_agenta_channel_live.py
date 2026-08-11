"""Acceptance: the whole path with no platform credentials of any kind --
bind an agent, create a connection, post a message with the caller's own API
key, let it invoke, and read the answer back.

Needs a deployed stack (`ag_env`). The bound agent runs on the mock harness,
so the turn is a real turn -- a real run plan, a real ACP session, real turn
records -- with a deterministic answer and no model call.
"""

from uuid import uuid4

import pytest

pytestmark = pytest.mark.acceptance

_ANSWER = "the mock harness answered"


@pytest.mark.usefixtures("cls_account")
class TestAgentaChannelLive:
    def test_post_invoke_and_read_the_answer_back(self, authed_api):
        bot_slug = f"agenta-acceptance-{uuid4().hex[:8]}"

        revision_id = _create_mock_agent_application(authed_api)

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
        connection_id = created.json()["connection"]["id"]

        _bind_default_agent(
            authed_api, connection_id=connection_id, revision_id=revision_id
        )

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
        answer = _poll_for_answer(authed_api, space_id=space_id, contains=_ANSWER)

        assert answer is not None, "no answer was posted within the timeout"


def _create_mock_agent_application(authed_api) -> str:
    """An agent bound to the mock harness: a real agent workflow, answering
    from a scripted behavior instead of a model. Returns its revision id."""

    slug = uuid4().hex[:8]
    response = authed_api(
        "POST",
        "/simple/applications/",
        json={
            "application": {
                "slug": f"application-{slug}",
                "name": f"Mock Agent {slug}",
                "data": {
                    "uri": "agenta:builtin:agent:v0",
                    "parameters": {
                        "agent": {
                            "harness": {
                                "kind": "mock",
                                "extras": {
                                    "behavior": "reply",
                                    "kwargs": {"text": _ANSWER},
                                },
                            },
                            "sandbox": "local",
                        }
                    },
                },
            }
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["application"]["revision_id"]


def _bind_default_agent(authed_api, *, connection_id, revision_id) -> str:
    """The connection-wide default. No grant is created on purpose: an agent
    with zero grants anywhere is unrestricted, so this is the smallest
    configuration that routes."""

    created = authed_api(
        "POST",
        "/channels/agents/",
        json={
            "agent": {
                "connection_id": connection_id,
                "slug": f"agent-{uuid4().hex[:8]}",
                "data": {"references": {"workflow_revision": {"id": revision_id}}},
            }
        },
    )
    assert created.status_code == 200, created.text
    agent_id = created.json()["agent"]["id"]

    marked = authed_api("POST", f"/channels/agents/{agent_id}/default")
    assert marked.status_code == 200, marked.text

    return agent_id


def _answer_text(answer) -> str:
    content = answer.get("content") or []
    return " ".join(part.get("text") or "" for part in content)


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


def _poll_for_answer(authed_api, *, space_id, contains, attempts=60, delay=0.5):
    """Waits for the answer, not merely for an outbound row. The turn posts a
    working indicator first and edits it into the result, so returning on the
    first outbound row would race the turn it is meant to observe."""

    import time

    for _ in range(attempts):
        response = authed_api("GET", f"/channels/agenta/conversations/{space_id}")
        if response.status_code == 200:
            items = response.json().get("items", [])
            for item in reversed(items):
                if item["direction"] != "outbound":
                    continue
                if contains in _answer_text(item):
                    return item
        time.sleep(delay)

    return None
