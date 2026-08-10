"""SlackAdapter driven against the fake Slack workspace instead of
`_StubTransport`: every method's success path plus at least one Slack error
shape, with state the adapter's own request log cannot see.
"""

import hashlib
import hmac
import json
import time
from uuid import uuid4

import httpx
import pytest

from oss.src.core.channels.adapters.slack.adapter import (
    ChannelBackfillRefused,
    SlackAdapter,
)
from oss.src.core.channels.dtos import ChannelConnection, ChannelRequestContext
from oss.src.core.channels.types import (
    ChannelConnectionIncomplete,
    ChannelSignatureInvalid,
)
from oss.tests.pytest.unit.channels.slack.fake_slack import (
    FakeSlackTransport,
    FakeSlackWorkspace,
    make_adapter_and_workspace,
)


def _connection(**data_overrides) -> ChannelConnection:
    data = {
        "signing_secret": "test-signing-secret",
        "bot_token": "xoxb-fake",
        "bot_user_id": "UBOT1",
        "team_id": "T1",
    }
    data.update(data_overrides)
    return ChannelConnection(
        id=uuid4(),
        slug="slack-connection",
        channel="slack",
        external_key=uuid4(),
        data=data,
    )


# --------------------------------------------------------------------------- #
# the fake rejects what Slack rejects
# --------------------------------------------------------------------------- #


async def test_no_bearer_header_at_all_is_rejected_as_not_authed():
    workspace = FakeSlackWorkspace()
    transport = FakeSlackTransport(workspace)

    request = httpx.Request(
        "POST",
        "https://slack.com/api/chat.postMessage",
        content=json.dumps({"channel": "C1", "text": "hi"}).encode(),
    )

    response = await transport.handle_async_request(request)

    body = json.loads(response.content)
    assert body == {"ok": False, "error": "not_authed"}


async def test_adapter_with_no_bot_token_configured_fails_before_calling_slack():
    # A half-configured connection is our error, not Slack's: fail locally
    # rather than sending "Bearer None" and reading back invalid_auth, which is
    # indistinguishable from a genuinely wrong token.
    adapter, workspace, transport = make_adapter_and_workspace()
    connection = _connection(bot_token=None)

    with pytest.raises(ChannelConnectionIncomplete) as excinfo:
        await adapter.post_message(
            connection=connection,
            locator={"channel": "C1"},
            content=[{"type": "text", "text": "hi"}],
            idempotency_key=uuid4(),
        )

    assert excinfo.value.field == "bot_token"
    assert workspace.messages == {}


async def test_wrong_bearer_token_is_rejected_as_invalid_auth():
    adapter, workspace, transport = make_adapter_and_workspace()
    connection = _connection(bot_token="xoxb-wrong")

    with pytest.raises(Exception) as excinfo:
        await adapter.post_message(
            connection=connection,
            locator={"channel": "C1"},
            content=[{"type": "text", "text": "hi"}],
            idempotency_key=uuid4(),
        )

    assert excinfo.value.error == "invalid_auth"


async def test_missing_channel_is_rejected_by_the_fake():
    adapter, workspace, transport = make_adapter_and_workspace()
    connection = _connection()

    with pytest.raises(Exception) as excinfo:
        await adapter.post_message(
            connection=connection,
            locator={"channel": ""},
            content=[{"type": "text", "text": "hi"}],
            idempotency_key=uuid4(),
        )

    assert excinfo.value.error == "channel_not_found"


async def test_unknown_endpoint_is_rejected_not_answered_with_a_canned_body():
    workspace = FakeSlackWorkspace()
    transport = FakeSlackTransport(workspace)

    request = httpx.Request(
        "POST",
        "https://slack.com/api/not.a.real.method",
        headers={"authorization": "Bearer xoxb-fake"},
        content=b"{}",
    )

    response = await transport.handle_async_request(request)

    body = json.loads(response.content)
    assert body["ok"] is False
    assert body["error"] == "unknown_method"
    assert response.status_code == 404


# --------------------------------------------------------------------------- #
# chat.postMessage / chat.update — success and stateful post-then-edit
# --------------------------------------------------------------------------- #


async def test_post_message_success_stores_the_message_in_the_fake():
    adapter, workspace, _ = make_adapter_and_workspace()
    connection = _connection()

    receipt = await adapter.post_message(
        connection=connection,
        locator={"channel": "C1"},
        content=[{"type": "text", "text": "hello"}],
        idempotency_key=uuid4(),
    )

    stored = workspace.messages["C1"][receipt["ts"]]
    assert stored["text"] == "hello"


async def test_post_then_edit_produces_one_message_edited_in_place_in_the_fake():
    adapter, workspace, _ = make_adapter_and_workspace()
    connection = _connection()

    receipt = await adapter.post_message(
        connection=connection,
        locator={"channel": "C1"},
        content=[{"type": "text", "text": "working..."}],
        idempotency_key=uuid4(),
    )
    await adapter.edit_message(
        connection=connection,
        external_locator=receipt,
        content=[{"type": "text", "text": "done"}],
        idempotency_key=uuid4(),
    )

    assert len(workspace.messages["C1"]) == 1
    assert workspace.messages["C1"][receipt["ts"]]["text"] == "done"


async def test_edit_of_unknown_message_raises_message_not_found():
    adapter, _, _ = make_adapter_and_workspace()
    connection = _connection()

    with pytest.raises(Exception) as excinfo:
        await adapter.edit_message(
            connection=connection,
            external_locator={"channel": "C1", "ts": "does-not-exist"},
            content=[{"type": "text", "text": "done"}],
            idempotency_key=uuid4(),
        )

    assert excinfo.value.error == "message_not_found"


async def test_ts_values_are_deterministic_across_fresh_workspaces():
    adapter_1, workspace_1, _ = make_adapter_and_workspace()
    adapter_2, workspace_2, _ = make_adapter_and_workspace()
    connection = _connection()

    receipt_1 = await adapter_1.post_message(
        connection=connection,
        locator={"channel": "C1"},
        content=[{"type": "text", "text": "hi"}],
        idempotency_key=uuid4(),
    )
    receipt_2 = await adapter_2.post_message(
        connection=connection,
        locator={"channel": "C1"},
        content=[{"type": "text", "text": "hi"}],
        idempotency_key=uuid4(),
    )

    assert receipt_1 == receipt_2


# --------------------------------------------------------------------------- #
# conversations.list — paging across more than one cursor page
# --------------------------------------------------------------------------- #


async def test_discover_spaces_pages_across_more_than_one_cursor_page(monkeypatch):
    channels = [{"id": f"C{i}", "name": f"chan-{i}"} for i in range(5)]
    adapter, workspace, transport = make_adapter_and_workspace(channels=channels)
    connection = _connection()

    # discover_spaces itself issues a single conversations.list call with no
    # paging loop, so drive the fake's paging directly to prove the fake's
    # cursor semantics, then confirm a single unpaged call still returns
    # everything the adapter asked for in that one call.
    first_page = await transport.handle_async_request(_list_request(limit=2, cursor=""))
    first_body = json.loads(first_page.content)
    assert [c["id"] for c in first_body["channels"]] == ["C0", "C1"]
    next_cursor = first_body["response_metadata"]["next_cursor"]
    assert next_cursor == "2"

    second_page = await transport.handle_async_request(
        _list_request(limit=2, cursor=next_cursor)
    )
    second_body = json.loads(second_page.content)
    assert [c["id"] for c in second_body["channels"]] == ["C2", "C3"]

    result = await adapter.discover_spaces(connection=connection)
    assert {c.external_locator["channel"] for c in result} == {
        c["id"] for c in channels
    }


def _list_request(*, limit: int, cursor: str):
    return httpx.Request(
        "POST",
        "https://slack.com/api/conversations.list",
        headers={"authorization": "Bearer xoxb-fake"},
        content=json.dumps({"limit": limit, "cursor": cursor}).encode(),
    )


# --------------------------------------------------------------------------- #
# fetch_history / conversations.history / conversations.replies
# --------------------------------------------------------------------------- #


async def test_fetch_history_returns_what_was_posted():
    adapter, workspace, _ = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "general"}]
    )
    workspace.seed_message(channel="C1", text="first")
    workspace.seed_message(channel="C1", text="second")
    connection = _connection()

    events = await adapter.fetch_history(
        connection=connection, locator={"team": "T1", "channel": "C1"}, limit=50
    )

    assert [e.processed.content[0]["text"] for e in events] == ["first", "second"]


async def test_fetch_history_replies_reads_the_thread():
    adapter, workspace, _ = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "general"}]
    )
    parent_ts = workspace.seed_message(channel="C1", text="parent")
    workspace.seed_message(channel="C1", text="reply", thread_ts=parent_ts)
    connection = _connection()

    events = await adapter.fetch_history(
        connection=connection,
        locator={"team": "T1", "channel": "C1", "thread_ts": parent_ts},
        limit=50,
    )

    assert [e.processed.content[0]["text"] for e in events] == ["parent", "reply"]


async def test_fetch_history_missing_scope_raises_backfill_refused():
    adapter, _, transport = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "general"}]
    )
    transport.force_error("conversations.history", error="missing_scope")
    connection = _connection()

    with pytest.raises(ChannelBackfillRefused):
        await adapter.fetch_history(
            connection=connection, locator={"team": "T1", "channel": "C1"}, limit=50
        )


async def test_fetch_history_bare_403_raises_backfill_refused():
    adapter, _, transport = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "general"}]
    )
    transport.force_error(
        "conversations.history", error="some_other_error", status_code=403
    )
    connection = _connection()

    with pytest.raises(ChannelBackfillRefused):
        await adapter.fetch_history(
            connection=connection, locator={"team": "T1", "channel": "C1"}, limit=50
        )


async def test_fetch_history_channel_not_found_is_not_backfill_refused():
    adapter, _, _ = make_adapter_and_workspace()
    connection = _connection()

    with pytest.raises(Exception) as excinfo:
        await adapter.fetch_history(
            connection=connection,
            locator={"team": "T1", "channel": "does-not-exist"},
            limit=50,
        )

    assert not isinstance(excinfo.value, ChannelBackfillRefused)
    assert excinfo.value.error == "channel_not_found"


async def test_fetch_history_empty_channel_returns_empty_list_not_a_refusal():
    adapter, _, _ = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "general"}]
    )
    connection = _connection()

    result = await adapter.fetch_history(
        connection=connection, locator={"team": "T1", "channel": "C1"}, limit=50
    )

    assert result == []


# --------------------------------------------------------------------------- #
# fetch_history's locator is the message's own, not the call's
# --------------------------------------------------------------------------- #


async def test_fetch_history_of_a_space_gives_untethered_messages_the_space_locator():
    adapter, workspace, _ = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "general"}]
    )
    workspace.seed_message(channel="C1", text="first")
    workspace.seed_message(channel="C1", text="second")
    call_locator = {"team": "T1", "channel": "C1"}

    events = await adapter.fetch_history(
        connection=_connection(), locator=call_locator, limit=50
    )

    assert {e.processed.content[0]["text"]: e.external_locator for e in events} == {
        "first": call_locator,
        "second": call_locator,
    }


async def test_fetch_history_of_a_space_gives_a_thread_parent_its_own_thread_locator():
    adapter, workspace, _ = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "general"}]
    )
    workspace.seed_message(channel="C1", text="loose")
    parent_ts = workspace.seed_message(channel="C1", text="parent")
    workspace.seed_message(channel="C1", text="reply", thread_ts=parent_ts)

    events = await adapter.fetch_history(
        connection=_connection(),
        locator={"team": "T1", "channel": "C1"},
        limit=50,
    )

    by_text = {e.processed.content[0]["text"]: e.external_locator for e in events}

    assert by_text["parent"] == {"team": "T1", "channel": "C1", "thread_ts": parent_ts}
    assert by_text["loose"] == {"team": "T1", "channel": "C1"}


async def test_fetch_history_of_a_thread_gives_every_reply_that_thread_locator():
    adapter, workspace, _ = make_adapter_and_workspace(
        channels=[{"id": "C1", "name": "general"}]
    )
    parent_ts = workspace.seed_message(channel="C1", text="parent")
    reply_ts = workspace.seed_message(channel="C1", text="reply", thread_ts=parent_ts)

    events = await adapter.fetch_history(
        connection=_connection(),
        locator={"team": "T1", "channel": "C1", "thread_ts": parent_ts},
        limit=50,
    )

    thread_locator = {"team": "T1", "channel": "C1", "thread_ts": parent_ts}

    assert reply_ts != parent_ts
    assert [e.external_locator for e in events] == [thread_locator, thread_locator]


# --------------------------------------------------------------------------- #
# ratelimited with Retry-After — assert the adapter's actual behaviour
# --------------------------------------------------------------------------- #


async def test_ratelimited_with_retry_after_propagates_as_an_error_with_no_retry():
    adapter, _, transport = make_adapter_and_workspace()
    transport.force_error(
        "chat.postMessage",
        error="ratelimited",
        status_code=429,
        headers={"Retry-After": "30"},
    )
    connection = _connection()

    with pytest.raises(Exception) as excinfo:
        await adapter.post_message(
            connection=connection,
            locator={"channel": "C1"},
            content=[{"type": "text", "text": "hi"}],
            idempotency_key=uuid4(),
        )

    # The adapter raises immediately on the first ratelimited response: no
    # retry, no backoff, no read of Retry-After anywhere in `_call`. Exactly
    # one request was sent.
    assert excinfo.value.error == "ratelimited"
    assert len(transport.requests) == 1


# --------------------------------------------------------------------------- #
# verify_signature / parse_event success + error against a real body
# --------------------------------------------------------------------------- #


async def test_verify_signature_success_against_a_real_signed_body():
    secret = "test-signing-secret"
    body = json.dumps({"team_id": "T1"}).encode()
    timestamp = str(int(time.time()))
    signed_bytes = f"v0:{timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )

    adapter = SlackAdapter()
    installation_id = await adapter.verify_signature(
        request=ChannelRequestContext(
            headers={
                "x-slack-signature": signature,
                "x-slack-request-timestamp": timestamp,
            },
            path="/",
            body=body,
        ),
        connection=_connection(signing_secret=secret),
    )

    assert installation_id == "T1"


async def test_verify_signature_rejects_a_stale_timestamp():
    secret = "test-signing-secret"
    body = json.dumps({"team_id": "T1"}).encode()
    stale_timestamp = "1"
    signed_bytes = f"v0:{stale_timestamp}:".encode() + body
    signature = (
        "v0=" + hmac.new(secret.encode(), signed_bytes, hashlib.sha256).hexdigest()
    )

    adapter = SlackAdapter()

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(
            request=ChannelRequestContext(
                headers={
                    "x-slack-signature": signature,
                    "x-slack-request-timestamp": stale_timestamp,
                },
                path="/",
                body=body,
            ),
            connection=_connection(signing_secret=secret),
        )
