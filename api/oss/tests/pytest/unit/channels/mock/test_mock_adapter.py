"""Core adapter behaviour not covered by the contract suite or the capability
and recorder test files: determinism, script replay/exhaustion, custom
signature schemes, and discovery.
"""

from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.adapters.mock.script import ScriptedEvents
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEventProcessed,
    ChannelRequestContext,
    ChannelSpaceCandidate,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import ChannelSignatureInvalid


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="mock-connection",
        channel="mock",
        external_key=uuid4(),
    )


def _event(external_id: str) -> ChannelInboundEvent:
    return ChannelInboundEvent(
        external_id=external_id,
        kind=ChannelEventKind.MESSAGE,
        space_kind=ChannelSpaceKind.TOPIC,
        external_locator={"team": "T1", "channel": "C1"},
        processed=ChannelInboxEventProcessed(
            content=[{"type": "text", "text": external_id}], sender={"id": "U1"}
        ),
    )


# --------------------------------------------------------------------------- #
# determinism
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_receipts_are_deterministic_across_fresh_instances():
    """Same constructor arguments, same call sequence -> the same receipts.
    No clock, no uuid4, no randomness inside the adapter."""

    connection = _connection()
    key = uuid4()

    adapter_1 = MockAdapter()
    receipt_1 = await adapter_1.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "hi"}],
        idempotency_key=key,
    )

    adapter_2 = MockAdapter()
    receipt_2 = await adapter_2.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "hi"}],
        idempotency_key=key,
    )

    assert receipt_1 == receipt_2


@pytest.mark.asyncio
async def test_installation_id_is_a_constructor_parameter():
    adapter = MockAdapter(installation_id="fixed-install-id")

    result = await adapter.verify_signature(
        request=ChannelRequestContext(
            headers={"x-fake-signature": "valid"}, path="/", body=b"anything"
        ),
        connection=_connection(),
    )

    assert result == "fixed-install-id"


# --------------------------------------------------------------------------- #
# signature scheme is a constructor parameter
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_custom_signature_scheme_accepts_its_own_header():
    adapter = MockAdapter(signature_header="x-mock-secret", signature_value="s3cr3t")

    result = await adapter.verify_signature(
        request=ChannelRequestContext(
            headers={"x-mock-secret": "s3cr3t"}, path="/", body=b"anything"
        ),
        connection=_connection(),
    )

    assert result == adapter._installation_id


@pytest.mark.asyncio
async def test_custom_signature_scheme_rejects_the_default_header():
    adapter = MockAdapter(signature_header="x-mock-secret", signature_value="s3cr3t")

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(
            request=ChannelRequestContext(
                headers={"x-fake-signature": "valid"}, path="/", body=b"anything"
            ),
            connection=_connection(),
        )


# --------------------------------------------------------------------------- #
# script replay and exhaustion
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_parse_event_replays_the_script_in_order():
    script = ScriptedEvents([_event("e1"), _event("e2")])
    adapter = MockAdapter(script=script)

    first = await adapter.parse_event(body=b"anything")
    second = await adapter.parse_event(body=b"anything")

    assert first.external_id == "e1"
    assert second.external_id == "e2"


@pytest.mark.asyncio
async def test_parse_event_returns_none_when_script_exhausted():
    adapter = MockAdapter(script=ScriptedEvents([_event("e1")]))

    await adapter.parse_event(body=b"anything")
    exhausted = await adapter.parse_event(body=b"anything")

    assert exhausted is None


@pytest.mark.asyncio
async def test_parse_event_with_no_script_returns_none():
    adapter = MockAdapter()

    assert await adapter.parse_event(body=b"anything") is None


# --------------------------------------------------------------------------- #
# connection_locator
# --------------------------------------------------------------------------- #


def test_connection_locator_returns_the_fixed_installation_id():
    adapter = MockAdapter(installation_id="fixed-install-id")
    request = ChannelRequestContext(headers={}, path="/mock/events/", body=b"{}")

    assert adapter.connection_locator(request=request) == {
        "installation_id": "fixed-install-id"
    }


class _HeaderLocatorMockAdapter(MockAdapter):
    """Telegram carries no identity in the body at all -- only a header.
    Telegram does not exist yet, so this stands in to prove the header
    channel resolves, without touching the shape MockAdapter ships with."""

    def connection_locator(self, *, request):
        secret = request.headers.get("x-mock-bot-secret")
        return {"bot_secret": secret} if secret else None


def test_connection_locator_can_resolve_from_a_header_with_no_body_identity():
    adapter = _HeaderLocatorMockAdapter()
    request = ChannelRequestContext(
        headers={"x-mock-bot-secret": "s3cr3t"}, path="/mock/events/", body=b""
    )

    assert adapter.connection_locator(request=request) == {"bot_secret": "s3cr3t"}


class _PathLocatorMockAdapter(MockAdapter):
    """A per-bot URL is Telegram's other mechanism, and the two compose.
    Stands in the same way as the header case above."""

    def connection_locator(self, *, request):
        segments = [s for s in request.path.split("/") if s]
        bot_id = segments[-2] if len(segments) >= 2 else None
        return {"bot_id": bot_id} if bot_id else None


def test_connection_locator_can_resolve_from_the_path_only():
    adapter = _PathLocatorMockAdapter()
    request = ChannelRequestContext(headers={}, path="/mock/bot-42/events/", body=b"")

    assert adapter.connection_locator(request=request) == {"bot_id": "bot-42"}


# --------------------------------------------------------------------------- #
# discovery
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_discover_spaces_returns_the_configured_list():
    candidates = [
        ChannelSpaceCandidate(
            kind=ChannelSpaceKind.TOPIC,
            external_locator={"team": "T1", "channel": "C1"},
            display_name="#general",
        )
    ]
    adapter = MockAdapter(discoverable_spaces=candidates)

    result = await adapter.discover_spaces(connection=_connection())

    assert result == candidates


@pytest.mark.asyncio
async def test_discover_spaces_defaults_to_empty():
    adapter = MockAdapter()

    result = await adapter.discover_spaces(connection=_connection())

    assert result == []
