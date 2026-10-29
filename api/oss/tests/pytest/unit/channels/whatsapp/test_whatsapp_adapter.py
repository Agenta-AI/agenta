"""WhatsAppAdapter against the fake Graph API: setup, signed ingress, sending,
the typing indicator, the re-open template and media download."""

from uuid import uuid4

import httpx
import pytest
from oss.src.core.channels.adapters.whatsapp.adapter import WhatsAppAdapter
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionCreate,
    ChannelRequestContext,
)
from oss.src.core.channels.types import (
    ChannelConnectionVerificationFailed,
    ChannelCredentialRevoked,
    ChannelDeliveryHeld,
    ChannelSignatureInvalid,
)

from . import payloads as p
from .fake_graph import FakeGraph

GRAPH = "https://graph.facebook.com/v24.0"


@pytest.fixture
def graph():
    fake = FakeGraph()
    fake.add_number(phone_number_id=p.PHONE_NUMBER_ID, token=p.ACCESS_TOKEN)
    return fake


@pytest.fixture
def adapter(graph):
    client = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=graph.app), base_url=GRAPH
    )
    return WhatsAppAdapter(http_client=client, pair_limit_retry_seconds=0)


def _connection(**data):
    return ChannelConnection(
        id=uuid4(),
        slug="whatsapp-bella",
        channel="whatsapp",
        external_key=uuid4(),
        data={
            "connection_locator": {"phone_number_id": p.PHONE_NUMBER_ID},
            "access_token": p.ACCESS_TOKEN,
            "app_secret": p.APP_SECRET,
            **data,
        },
    )


# --- setup --------------------------------------------------------------- #


async def test_verify_connection_reads_the_number_and_mints_a_verify_token(adapter):
    discovered = await adapter.verify_connection(
        connection=ChannelConnectionCreate(
            channel="whatsapp", data={"phone_number_id": p.PHONE_NUMBER_ID}
        ),
        credentials={"access_token": p.ACCESS_TOKEN, "app_secret": p.APP_SECRET},
    )

    assert discovered["verified_name"] == "Bella Shoes"
    assert discovered["display_phone_number"] == "+1 555-010-0000"
    assert discovered["webhook_verify_token"].startswith(p.PHONE_NUMBER_ID + ".")
    assert discovered["webhook_url"].endswith("/channels/whatsapp/events/")


async def test_verify_connection_refuses_a_token_that_cannot_read_the_number(adapter):
    with pytest.raises(ChannelConnectionVerificationFailed):
        await adapter.verify_connection(
            connection=ChannelConnectionCreate(
                channel="whatsapp", data={"phone_number_id": p.PHONE_NUMBER_ID}
            ),
            credentials={"access_token": "wrong", "app_secret": p.APP_SECRET},
        )


async def test_a_token_that_can_read_but_not_send_is_refused_with_the_fix(
    adapter, graph
):
    """The Railway case: the token reads the number, but its system user has
    no WhatsApp account assigned, so every send is refused."""

    graph.add_number(
        phone_number_id=p.PHONE_NUMBER_ID, token=p.ACCESS_TOKEN, can_send=False
    )
    with pytest.raises(ChannelConnectionVerificationFailed) as caught:
        await adapter.verify_connection(
            connection=ChannelConnectionCreate(
                channel="whatsapp", data={"phone_number_id": p.PHONE_NUMBER_ID}
            ),
            credentials={"access_token": p.ACCESS_TOKEN, "app_secret": p.APP_SECRET},
        )
    message = caught.value.message
    assert message.startswith("This token can't send messages from this number.")
    assert "System users" in message and "Full control" in message
    assert p.ACCESS_TOKEN not in message
    assert graph.sent == []  # the probe delivered nothing


@pytest.mark.parametrize("code", [2, 131000])  # Meta down; an unknown refusal
async def test_an_unexpected_send_probe_answer_blocks_the_connect(adapter, graph, code):
    """Only a refusal of the recipient proves the token may send."""

    graph.fail_next(code)
    with pytest.raises(ChannelConnectionVerificationFailed) as caught:
        await adapter.verify_connection(
            connection=ChannelConnectionCreate(
                channel="whatsapp", data={"phone_number_id": p.PHONE_NUMBER_ID}
            ),
            credentials={"access_token": p.ACCESS_TOKEN, "app_secret": p.APP_SECRET},
        )
    assert "Try again" in caught.value.message


async def test_a_network_error_on_the_send_probe_blocks_with_a_retry_hint(graph):
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "POST":
            raise httpx.ConnectError("connection refused")
        return await httpx.ASGITransport(app=graph.app).handle_async_request(request)

    adapter = WhatsAppAdapter(
        http_client=httpx.AsyncClient(
            transport=httpx.MockTransport(handler), base_url=GRAPH
        )
    )
    with pytest.raises(ChannelConnectionVerificationFailed) as caught:
        await adapter.verify_connection(
            connection=ChannelConnectionCreate(
                channel="whatsapp", data={"phone_number_id": p.PHONE_NUMBER_ID}
            ),
            credentials={"access_token": p.ACCESS_TOKEN, "app_secret": p.APP_SECRET},
        )
    assert "Try again" in caught.value.message


async def test_the_send_probe_delivers_nothing(adapter, graph):
    await adapter.verify_connection(
        connection=ChannelConnectionCreate(
            channel="whatsapp", data={"phone_number_id": p.PHONE_NUMBER_ID}
        ),
        credentials={"access_token": p.ACCESS_TOKEN, "app_secret": p.APP_SECRET},
    )
    assert graph.sent == []


async def test_rotating_to_a_token_that_cannot_send_is_refused(adapter, graph):
    graph.add_number(
        phone_number_id=p.PHONE_NUMBER_ID, token=p.ACCESS_TOKEN, can_send=False
    )
    with pytest.raises(ChannelConnectionVerificationFailed):
        await adapter.verify_connection(
            connection=ChannelConnectionCreate(
                channel="whatsapp",
                data={"connection_locator": {"phone_number_id": p.PHONE_NUMBER_ID}},
            ),
            credentials={"access_token": p.ACCESS_TOKEN},
        )


async def test_rotating_the_token_verifies_against_the_stored_number(adapter):
    """Rotation re-verifies with the stored data, where the number sits under
    connection_locator, and with only the credential being replaced."""

    discovered = await adapter.verify_connection(
        connection=ChannelConnectionCreate(
            channel="whatsapp",
            data={"connection_locator": {"phone_number_id": p.PHONE_NUMBER_ID}},
        ),
        credentials={"access_token": p.ACCESS_TOKEN},
    )
    assert discovered["phone_number_id"] == p.PHONE_NUMBER_ID


async def test_revoke_tells_the_operator_to_remove_the_meta_webhook(adapter):
    notice = await adapter.revoke_installation(connection=_connection())
    assert "Meta" in notice


# --- ingress ------------------------------------------------------------- #


def _request(raw: bytes, signature: str = None) -> ChannelRequestContext:
    headers = {"content-type": "application/json"}
    if signature is not None:
        headers["X-Hub-Signature-256"] = signature
    return ChannelRequestContext(
        headers=headers, path="/api/channels/whatsapp/events/", body=raw
    )


def test_connection_locator_is_the_first_phone_number_in_the_body(adapter):
    raw = p.encode(p.text_body())
    assert adapter.connection_locator(request=_request(raw)) == {
        "phone_number_id": p.PHONE_NUMBER_ID
    }
    assert adapter.connection_locator(request=_request(b"{}")) is None


async def test_verify_signature_returns_the_connections_phone_number(adapter):
    raw = p.encode(p.text_body())
    speaker = await adapter.verify_signature(
        request=_request(raw, p.sign(raw)), connection=_connection()
    )
    assert speaker == p.PHONE_NUMBER_ID


async def test_verify_signature_refuses_a_forged_body(adapter):
    raw = p.encode(p.text_body())
    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(
            request=_request(raw, p.sign(raw, "attacker-secret")),
            connection=_connection(),
        )


async def test_parse_event_returns_every_message_for_this_number(adapter):
    raw = p.encode(
        p.body(
            p.value(
                messages=[
                    p.text_message("one", message_id="wamid.1"),
                    p.text_message("two", message_id="wamid.2"),
                ]
            )
        )
    )
    events = await adapter.parse_event(body=raw, connection=_connection())
    assert [e.external_id for e in events] == ["wamid.1", "wamid.2"]


# --- egress -------------------------------------------------------------- #


async def test_post_message_sends_text_and_returns_the_receipt(adapter, graph):
    receipt = await adapter.post_message(
        connection=_connection(),
        locator={"wa_id": p.CUSTOMER},
        content=[{"type": "text", "text": "Yes, it left **yesterday**."}],
        idempotency_key=uuid4(),
    )

    assert graph.texts_to(p.CUSTOMER) == ["Yes, it left *yesterday*."]
    assert receipt == {"wa_id": p.CUSTOMER, "message_id": "wamid.out.1"}


async def test_window_closed_error_holds_the_reply(adapter, graph):
    graph.fail_next(131047)
    with pytest.raises(ChannelDeliveryHeld):
        await adapter.post_message(
            connection=_connection(),
            locator={"wa_id": p.CUSTOMER},
            content=[{"type": "text", "text": "late answer"}],
            idempotency_key=uuid4(),
        )
    assert graph.sent == []


async def test_pair_rate_limit_is_retried_without_resending(adapter, graph):
    graph.fail_next(131056)
    await adapter.post_message(
        connection=_connection(),
        locator={"wa_id": p.CUSTOMER},
        content=[{"type": "text", "text": "part one"}],
        idempotency_key=uuid4(),
    )
    assert graph.texts_to(p.CUSTOMER) == ["part one"]


async def test_a_revoked_token_marks_the_credential_revoked(adapter, graph):
    graph.fail_next(190)
    with pytest.raises(ChannelCredentialRevoked):
        await adapter.post_message(
            connection=_connection(),
            locator={"wa_id": p.CUSTOMER},
            content=[{"type": "text", "text": "hello"}],
            idempotency_key=uuid4(),
        )


async def test_other_rejections_raise_with_the_status_code(adapter, graph):
    graph.fail_next(131026)
    with pytest.raises(Exception) as caught:
        await adapter.post_message(
            connection=_connection(),
            locator={"wa_id": p.CUSTOMER},
            content=[{"type": "text", "text": "hello"}],
            idempotency_key=uuid4(),
        )
    assert getattr(caught.value, "status_code", None) == 400


async def test_metas_full_error_is_kept_without_the_token(adapter, graph):
    graph.fail_next(
        100,
        message=f"Authorization Error for {p.ACCESS_TOKEN}",
        subcode=2494010,
        details="The phone number is not registered on the Cloud API",
    )
    with pytest.raises(Exception) as caught:
        await adapter.post_message(
            connection=_connection(),
            locator={"wa_id": p.CUSTOMER},
            content=[{"type": "text", "text": "hello"}],
            idempotency_key=uuid4(),
        )
    text = str(caught.value)
    assert "100" in text and "2494010" in text and "OAuthException" in text
    assert "not registered on the Cloud API" in text
    assert "AbCdEfFakeTrace" in text
    assert p.ACCESS_TOKEN not in text


async def test_metas_throttling_is_reported_as_a_rate_limit(adapter, graph):
    for _ in range(3):  # outlasts the adapter's own pair-limit retries
        graph.fail_next(131056)
    with pytest.raises(Exception) as caught:
        await adapter.post_message(
            connection=_connection(),
            locator={"wa_id": p.CUSTOMER},
            content=[{"type": "text", "text": "hello"}],
            idempotency_key=uuid4(),
        )
    assert caught.value.status_code == 429


async def test_a_refused_typing_indicator_raises_for_the_caller_to_judge(
    adapter, graph
):
    graph.fail_typing()
    with pytest.raises(Exception) as caught:
        await adapter.signal_activity(
            connection=_connection(),
            locator={"wa_id": p.CUSTOMER, "inbound_message_id": "wamid.IN"},
        )
    assert caught.value.status_code == 400


async def test_signal_activity_marks_read_and_shows_typing(adapter, graph):
    await adapter.signal_activity(
        connection=_connection(),
        locator={"wa_id": p.CUSTOMER, "inbound_message_id": "wamid.IN"},
    )
    assert graph.typing == [
        {
            "phone_number_id": p.PHONE_NUMBER_ID,
            "messaging_product": "whatsapp",
            "status": "read",
            "message_id": "wamid.IN",
            "typing_indicator": {"type": "text"},
        }
    ]


async def test_signal_activity_without_an_inbound_message_does_nothing(adapter, graph):
    await adapter.signal_activity(
        connection=_connection(), locator={"wa_id": p.CUSTOMER}
    )
    assert graph.typing == []


async def test_reopen_sends_the_configured_template(adapter, graph):
    sent = await adapter.reopen_conversation(
        connection=_connection(
            reopen_template="order_update", reopen_template_language="de"
        ),
        locator={"wa_id": p.CUSTOMER},
    )
    assert sent is True
    [message] = graph.sent
    assert message["type"] == "template"
    assert message["template"] == {"name": "order_update", "language": {"code": "de"}}


async def test_reopen_without_a_template_sends_nothing(adapter, graph):
    sent = await adapter.reopen_conversation(
        connection=_connection(), locator={"wa_id": p.CUSTOMER}
    )
    assert sent is False
    assert graph.sent == []


async def test_fetch_media_downloads_with_the_connection_token(adapter, graph):
    graph.add_media(
        media_id="DOC1",
        data=b"%PDF-1.4 fake",
        mime_type="application/pdf",
        token=p.ACCESS_TOKEN,
    )
    data, mime_type = await adapter.fetch_media(
        connection=_connection(), media={"media_id": "DOC1"}
    )
    assert data == b"%PDF-1.4 fake"
    assert mime_type == "application/pdf"


async def test_capabilities_declare_the_whatsapp_rules(adapter):
    capabilities = await adapter.fetch_capabilities()
    assert capabilities.channel == "whatsapp"
    assert capabilities.spaces.private and not capabilities.spaces.group
    assert capabilities.rendering.controls.update is False
    assert capabilities.rendering.controls.indicator == "native"
    assert capabilities.rendering.text.max_chars == 4096
    assert capabilities.conversation.reply_window_seconds == 24 * 60 * 60
    assert capabilities.conversation.opt_out is True
    assert capabilities.fill.backfill.supported is False
    assert [f.name for f in capabilities.setup.fields if f.secret] == [
        "access_token",
        "app_secret",
    ]
