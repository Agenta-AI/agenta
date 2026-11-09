"""TeamsAdapter's outbound calls against the fake Bot Framework connector:
the access token cache, the reply host allowlist, the tenant on every
activity, thread and chat replies, typing, the approval card and its
dismissal, and how each Teams error maps to the shared outbox rules."""

import asyncio
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.teams import adapter as adapter_module
from oss.src.core.channels.types import (
    ChannelCredentialRevoked,
    ChannelDeliveryUncertain,
)
from oss.src.core.channels.utils import delivery_outcome_unknown, delivery_refused

from . import fake_teams as f
from . import payloads as p

INTERACTION_ID = "0193a3f0-6d3c-7b3e-9c1f-2a7e5d4b8c10"

CHAT = {
    "tenant_id": p.TENANT_ID,
    "conversation_id": p.PERSONAL_CONVERSATION,
    "thread_id": "",
    "service_url": p.SERVICE_URL,
    "message_id": "1700000000100",
}
CHANNEL_THREAD = {
    "tenant_id": p.TENANT_ID,
    "conversation_id": p.CHANNEL_CONVERSATION,
    "thread_id": "111",
    "service_url": p.SERVICE_URL,
    "message_id": "222",
}
APPROVAL = [
    {
        "type": "card",
        "title": "Approval needed: Cancel order",
        "text": "Approve allows this tool call once. Deny prevents it.",
        "arguments": {"order": "4411"},
    },
    {
        "type": "button",
        "id": "0",
        "label": "Approve",
        "value": f"{INTERACTION_ID}:approve",
    },
    {"type": "button", "id": "1", "label": "Deny", "value": f"{INTERACTION_ID}:deny"},
]


@pytest.fixture
def fake():
    return f.FakeMicrosoft()


@pytest.fixture
def adapter(fake):
    return f.adapter_for(fake)


@pytest.fixture
def connection():
    return p.connection()


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(adapter_module, "monotonic", lambda: now[0])
    return now


async def _post(adapter, connection, text="Hello", locator=CHAT):
    return await adapter.post_message(
        connection=connection,
        locator=locator,
        content=[{"type": "text", "text": text}],
        idempotency_key=uuid4(),
    )


# --- access token cache -------------------------------------------------- #


async def test_two_sends_ten_minutes_apart_share_one_token(
    adapter, fake, connection, clock
):
    await _post(adapter, connection)
    clock[0] += 600
    await _post(adapter, connection)

    assert len(fake.token_requests) == 1
    assert [c["token"] for c in fake.calls] == ["fake-access-token"] * 2


async def test_a_token_near_expiry_is_replaced_before_the_send(
    adapter, fake, connection, clock
):
    await _post(adapter, connection)
    clock[0] += 3599 - 299  # less than 5 minutes left

    await _post(adapter, connection)

    assert len(fake.token_requests) == 2
    assert fake.calls[-1]["token"] == "fake-access-token-2"


async def test_each_connection_gets_its_own_token(adapter, fake, clock):
    one = p.connection()
    two = p.connection(client_secret="second-test-secret")

    await asyncio.gather(_post(adapter, one), _post(adapter, two))

    assert sorted(r["client_secret"] for r in fake.token_requests) == sorted(
        [p.CLIENT_SECRET, "second-test-secret"]
    )
    assert len({c["token"] for c in fake.calls}) == 2


async def test_concurrent_sends_on_one_connection_request_one_token(
    adapter, fake, connection
):
    await asyncio.gather(*(_post(adapter, connection) for _ in range(5)))

    assert len(fake.token_requests) == 1
    assert len(fake.calls) == 5


async def test_the_token_request_uses_the_connections_values(adapter, fake, connection):
    await _post(adapter, connection)

    (request,) = fake.token_requests
    assert request["host"] == "login.microsoftonline.com"
    assert request["tenant_id"] == p.TENANT_ID
    assert request["client_id"] == p.APP_ID
    assert request["client_secret"] == p.CLIENT_SECRET
    assert request["scope"] == "https://api.botframework.com/.default"


# --- reply host allowlist ------------------------------------------------ #


@pytest.mark.parametrize(
    "service_url",
    [
        "https://smba.trafficmanager.net/amer/",
        "https://smba.infra.gcc.teams.microsoft.com/teams",
        "https://smba.infra.gov.teams.microsoft.us/teams",
        "https://smba.infra.dod.teams.microsoft.us/teams",
    ],
)
async def test_microsofts_reply_hosts_are_allowed(
    adapter, fake, connection, service_url
):
    await _post(adapter, connection, locator={**CHAT, "service_url": service_url})

    (call,) = fake.calls
    assert call["host"] == service_url.split("/")[2]


@pytest.mark.parametrize(
    "service_url",
    [
        "https://other.trafficmanager.net/amer/",
        "https://smba.trafficmanager.net.example.com/amer/",
        "http://smba.trafficmanager.net/amer/",
        "https://smba.trafficmanager.net:8443/amer/",
        "not a url",
    ],
)
async def test_any_other_host_is_refused_before_any_request(
    adapter, fake, connection, service_url
):
    with pytest.raises(Exception) as caught:
        await _post(adapter, connection, locator={**CHAT, "service_url": service_url})

    assert fake.calls == []
    assert fake.token_requests == []
    assert delivery_refused(caught.value)
    assert not delivery_outcome_unknown(caught.value)


async def test_typing_to_another_host_is_refused_too(adapter, fake, connection):
    with pytest.raises(Exception):
        await adapter.signal_activity(
            connection=connection,
            locator={**CHAT, "service_url": "https://attacker.example.com/"},
        )

    assert fake.calls == []


# --- replies ------------------------------------------------------------- #


async def test_a_chat_reply_goes_to_the_conversation_as_it_is(
    adapter, fake, connection
):
    receipt = await _post(adapter, connection, text="It left **yesterday**.")

    (call,) = fake.calls
    assert call["method"] == "POST"
    assert call["prefix"] == "/amer"
    assert call["conversation"] == p.PERSONAL_CONVERSATION
    assert call["body"]["type"] == "message"
    assert call["body"]["text"] == "It left **yesterday**."
    assert call["body"]["textFormat"] == "markdown"
    assert receipt == {
        "tenant_id": p.TENANT_ID,
        "conversation_id": p.PERSONAL_CONVERSATION,
        "thread_id": "",
        "service_url": p.SERVICE_URL,
        "message_id": "1700000000001",
    }


async def test_a_channel_reply_goes_into_the_thread(adapter, fake, connection):
    receipt = await _post(adapter, connection, locator=CHANNEL_THREAD)

    (call,) = fake.calls
    assert call["conversation"] == f"{p.CHANNEL_CONVERSATION};messageid=111"
    assert receipt["thread_id"] == "111"
    assert receipt["message_id"] == "1700000000001"


async def test_every_activity_carries_the_tenant(adapter, fake, connection):
    receipt = await adapter.post_message(
        connection=connection,
        locator=CHAT,
        content=APPROVAL,
        idempotency_key=uuid4(),
    )
    await _post(adapter, connection)
    await adapter.signal_activity(connection=connection, locator=CHAT)
    await adapter.dismiss_choices(
        connection=connection, external_locator=receipt, content=APPROVAL
    )

    assert len(fake.calls) == 4
    assert all(
        c["body"]["channelData"] == {"tenant": {"id": p.TENANT_ID}} for c in fake.calls
    )


async def test_an_empty_answer_sends_nothing(adapter, fake, connection):
    receipt = await adapter.post_message(
        connection=connection, locator=CHAT, content=[], idempotency_key=uuid4()
    )

    assert receipt == {}
    assert fake.calls == []


async def test_oversize_text_is_split_as_a_safety_net(adapter, fake, connection):
    await _post(adapter, connection, text="a" * 45000)

    assert [len(t) for t in fake.texts()] == [20000, 20000, 5000]


async def test_a_later_part_failing_makes_the_outcome_uncertain(
    adapter, fake, connection
):
    await _post(adapter, connection, text="warm up")  # the token is cached
    fake.calls.clear()
    fake._failures.extend([(200, None), (500, {"error": {"code": "ServiceError"}})])

    with pytest.raises(ChannelDeliveryUncertain):
        await _post(adapter, connection, text="a" * 25000)

    assert len(fake.texts()) == 1


# --- typing -------------------------------------------------------------- #


async def test_typing_posts_a_typing_activity_to_the_reply_conversation(
    adapter, fake, connection
):
    await adapter.signal_activity(
        connection=connection,
        locator={**CHANNEL_THREAD, "inbound_message_id": "333"},
    )

    (call,) = fake.calls
    assert call["body"] == {
        "type": "typing",
        "channelData": {"tenant": {"id": p.TENANT_ID}},
    }
    assert call["conversation"] == f"{p.CHANNEL_CONVERSATION};messageid=111"


async def test_edits_stay_unsupported(adapter, connection):
    with pytest.raises(NotImplementedError):
        await adapter.edit_message(
            connection=connection,
            external_locator=CHAT,
            content=[{"type": "text", "text": "x"}],
            idempotency_key=uuid4(),
        )


# --- approval card ------------------------------------------------------- #


async def test_an_approval_is_a_card_with_submit_buttons(adapter, fake, connection):
    receipt = await adapter.post_message(
        connection=connection,
        locator=CHANNEL_THREAD,
        content=APPROVAL,
        idempotency_key=uuid4(),
    )

    (call,) = fake.calls
    (attachment,) = call["body"]["attachments"]
    assert "text" not in call["body"]
    assert attachment["contentType"] == "application/vnd.microsoft.card.adaptive"
    card = attachment["content"]
    assert card["type"] == "AdaptiveCard"
    assert card["version"] == "1.4"
    texts = [block["text"] for block in card["body"]]
    assert texts[0] == "Approval needed: Cancel order"
    assert "4411" in texts[-1]
    assert card["actions"] == [
        {
            "type": "Action.Submit",
            "title": "Approve",
            "data": {"choice_token": f"{INTERACTION_ID}:approve", "thread_id": "111"},
        },
        {
            "type": "Action.Submit",
            "title": "Deny",
            "data": {"choice_token": f"{INTERACTION_ID}:deny", "thread_id": "111"},
        },
    ]
    assert receipt["message_id"] == "1700000000001"


async def test_a_card_in_a_chat_carries_an_empty_thread_id(adapter, fake, connection):
    await adapter.post_message(
        connection=connection, locator=CHAT, content=APPROVAL, idempotency_key=uuid4()
    )

    card = fake.calls[0]["body"]["attachments"][0]["content"]
    assert {a["data"]["thread_id"] for a in card["actions"]} == {""}


async def test_dismiss_puts_the_same_card_without_buttons(adapter, fake, connection):
    receipt = await adapter.post_message(
        connection=connection,
        locator=CHANNEL_THREAD,
        content=APPROVAL,
        idempotency_key=uuid4(),
    )

    await adapter.dismiss_choices(
        connection=connection, external_locator=receipt, content=APPROVAL
    )

    posted = fake.calls[0]["body"]["attachments"][0]["content"]
    (update,) = fake.updates()
    assert update["conversation"] == f"{p.CHANNEL_CONVERSATION};messageid=111"
    assert update["activity_id"] == receipt["message_id"]
    assert update["body"]["id"] == receipt["message_id"]
    card = update["body"]["attachments"][0]["content"]
    assert "actions" not in card
    assert card["body"] == posted["body"]


async def test_dismiss_without_a_receipt_or_buttons_does_nothing(
    adapter, fake, connection
):
    await adapter.dismiss_choices(
        connection=connection,
        external_locator={**CHAT, "message_id": ""},
        content=APPROVAL,
    )
    await adapter.dismiss_choices(
        connection=connection,
        external_locator=CHAT,
        content=[{"type": "text", "text": "no buttons"}],
    )

    assert fake.calls == []


async def test_more_choices_than_the_maximum_go_out_as_numbered_text(
    adapter, fake, connection
):
    content = [
        {"type": "button", "id": str(i), "label": f"Option {i}", "value": f"x:{i}"}
        for i in range(6)
    ]

    await adapter.post_message(
        connection=connection, locator=CHAT, content=content, idempotency_key=uuid4()
    )

    (text,) = fake.texts()
    assert text.splitlines()[0] == "1. Option 0"
    assert "attachments" not in fake.calls[0]["body"]


# --- errors -------------------------------------------------------------- #


async def test_a_401_gets_a_new_token_and_delivers_once(adapter, fake, connection):
    await _post(adapter, connection, text="first")
    fake.fail_next(401, code="Unauthorized")

    await _post(adapter, connection, text="second")

    assert len(fake.token_requests) == 2
    assert fake.texts() == ["first", "second"]
    assert fake.calls[-1]["token"] == "fake-access-token-2"


async def test_a_second_401_revokes_the_credential(adapter, fake, connection):
    fake.fail_next(401, code="Unauthorized", times=2)

    with pytest.raises(ChannelCredentialRevoked):
        await _post(adapter, connection)

    assert len(fake.token_requests) == 2
    assert fake.texts() == []


@pytest.mark.parametrize("code", [7000215, 7000222])
async def test_a_refused_secret_revokes_the_credential(adapter, fake, connection, code):
    fake.refuse_token(status=401, error="invalid_client", code=code)

    with pytest.raises(ChannelCredentialRevoked) as caught:
        await _post(adapter, connection)

    assert fake.calls == []
    assert p.CLIENT_SECRET not in str(caught.value)


async def test_a_busy_token_service_is_retried_not_revoked(adapter, fake, connection):
    fake.refuse_token(status=503, error="temporarily_unavailable", code=50001)

    with pytest.raises(Exception) as caught:
        await _post(adapter, connection)

    assert not isinstance(caught.value, ChannelCredentialRevoked)
    assert not delivery_refused(caught.value)
    assert not delivery_outcome_unknown(caught.value)


async def test_a_removed_app_refuses_the_send_without_revoking(
    adapter, fake, connection
):
    fake.fail_next(403, code="Forbidden", sub_code="MessageWritesBlocked")

    with pytest.raises(Exception) as caught:
        await _post(adapter, connection)

    assert not isinstance(caught.value, ChannelCredentialRevoked)
    assert caught.value.status_code == 403
    assert delivery_refused(caught.value)
    assert len(fake.token_requests) == 1


async def test_a_rate_limit_is_retryable(adapter, fake, connection):
    fake.fail_next(429, code="TooManyRequests")

    with pytest.raises(Exception) as caught:
        await _post(adapter, connection)

    assert caught.value.status_code == 429
    assert not delivery_refused(caught.value)
    assert not delivery_outcome_unknown(caught.value)


async def test_a_server_error_on_a_post_may_have_landed(adapter, fake, connection):
    fake.fail_next(502, code="BadGateway")

    with pytest.raises(Exception) as caught:
        await _post(adapter, connection)

    assert caught.value.status_code == 502
    assert delivery_outcome_unknown(caught.value)
