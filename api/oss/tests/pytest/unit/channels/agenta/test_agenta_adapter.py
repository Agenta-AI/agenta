"""Unit tests for AgentaAdapter -- no DB, no network. `resolve_project` and
`channels_dao` are both injected fakes, mirroring how SlackAdapter's tests
inject a fake httpx transport."""

import json
from typing import List, Optional
from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.agenta.adapter import AgentaAdapter
from oss.src.core.channels.adapters.slack.adapter import ChannelBackfillRefused
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelRequestContext,
    ChannelSpace,
    ChannelSpaceData,
    ChannelSpaceKind,
    ChannelSpaceQuery,
)
from oss.src.core.channels.types import ChannelSignatureInvalid

GOOD_KEY = "prefix.goodrawkey"
PROJECT_ID = str(uuid4())


class FakeChannelsDAO:
    """Only `query_spaces` is exercised by this adapter; every other method
    would raise NotImplementedError if a test reached it by mistake."""

    def __init__(self, spaces: Optional[List[ChannelSpace]] = None):
        self._spaces = spaces or []
        self.last_query: Optional[ChannelSpaceQuery] = None

    async def query_spaces(self, *, project_id, space=None, windowing=None):
        self.last_query = space
        return list(self._spaces)

    def __getattr__(self, name):
        raise NotImplementedError(f"FakeChannelsDAO.{name} is not stubbed")


async def _resolve_project(raw_key: str) -> Optional[str]:
    return PROJECT_ID if raw_key == GOOD_KEY else None


def _adapter(dao: Optional[FakeChannelsDAO] = None) -> AgentaAdapter:
    return AgentaAdapter(
        channels_dao=dao or FakeChannelsDAO(),
        resolve_project=_resolve_project,
    )


def _connection(*, project=PROJECT_ID, bot="support") -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="agenta-connection",
        channel="agenta",
        external_key=uuid4(),
        data={"connection_locator": {"project": project, "bot": bot}},
    )


# --------------------------------------------------------------------------- #
# connection_locator: unverified claim, read from the body only.
# --------------------------------------------------------------------------- #


def test_connection_locator_reads_project_and_bot_from_the_body():
    adapter = _adapter()
    request = ChannelRequestContext(
        headers={},
        path="/",
        body=json.dumps({"project": "P1", "bot": "support"}).encode(),
    )

    assert adapter.connection_locator(request=request) == {
        "project": "P1",
        "bot": "support",
    }


@pytest.mark.parametrize(
    "body",
    [b"{}", b'{"project": "P1"}', b'{"bot": "support"}', b"not json"],
)
def test_connection_locator_is_none_when_a_claim_is_missing(body):
    adapter = _adapter()
    request = ChannelRequestContext(headers={}, path="/", body=body)

    assert adapter.connection_locator(request=request) is None


# --------------------------------------------------------------------------- #
# verify_signature: an API key, not an HMAC. Returns the caller's verified
# project -- an id the connection's own recorded locator can be checked
# against, never the composed external_key.
# --------------------------------------------------------------------------- #


async def test_verify_signature_returns_the_verified_project_id():
    adapter = _adapter()
    request = ChannelRequestContext(
        headers={"Authorization": f"ApiKey {GOOD_KEY}"}, path="/", body=b"{}"
    )

    identity = await adapter.verify_signature(request=request, connection=_connection())

    assert identity == PROJECT_ID
    assert isinstance(identity, str)


async def test_verify_signature_accepts_the_legacy_bare_header():
    adapter = _adapter()
    request = ChannelRequestContext(
        headers={"authorization": GOOD_KEY}, path="/", body=b"{}"
    )

    identity = await adapter.verify_signature(request=request, connection=_connection())
    assert identity == PROJECT_ID


async def test_verify_signature_rejects_a_bad_key():
    adapter = _adapter()
    request = ChannelRequestContext(
        headers={"Authorization": "ApiKey wrong.key"}, path="/", body=b"{}"
    )

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(request=request, connection=_connection())


async def test_verify_signature_rejects_a_missing_key():
    adapter = _adapter()
    request = ChannelRequestContext(headers={}, path="/", body=b"{}")

    with pytest.raises(ChannelSignatureInvalid):
        await adapter.verify_signature(request=request, connection=_connection())


async def test_bad_missing_and_wrong_project_keys_all_refuse_identically():
    """The three refusal causes the spec calls out. `verify_signature` alone
    cannot distinguish "wrong project" from "right project, wrong
    connection" -- that cross-check is the ingress's `_connection_owns_identity`,
    exercised in test_agenta_ingress.py. Here: same exception, same shape,
    for a bad key and for a missing one."""

    adapter = _adapter()
    connection = _connection()

    bad = ChannelRequestContext(
        headers={"Authorization": "ApiKey nope.nope"}, path="/", body=b"{}"
    )
    missing = ChannelRequestContext(headers={}, path="/", body=b"{}")

    with pytest.raises(ChannelSignatureInvalid) as bad_exc:
        await adapter.verify_signature(request=bad, connection=connection)
    with pytest.raises(ChannelSignatureInvalid) as missing_exc:
        await adapter.verify_signature(request=missing, connection=connection)

    assert bad_exc.value.channel == missing_exc.value.channel == "agenta"


# --------------------------------------------------------------------------- #
# parse_event
# --------------------------------------------------------------------------- #


async def test_parse_event_builds_a_message_addressed_to_the_users_own_space():
    adapter = _adapter()
    body = json.dumps({"user": "U1", "text": "hello", "id": "msg-1"}).encode()

    event = await adapter.parse_event(body=body)

    assert event is not None
    assert event.external_id == "msg-1"
    assert event.addressed is True
    assert event.external_locator == {"user": "U1", "thread": "U1"}
    assert event.processed.content == [{"type": "text", "text": "hello"}]
    assert event.processed.sender == {"id": "U1"}


async def test_parse_event_derives_external_id_from_the_body_when_no_id_given():
    adapter = _adapter()
    body = json.dumps({"user": "U1", "text": "hello"}).encode()

    first = await adapter.parse_event(body=body)
    second = await adapter.parse_event(body=body)

    assert first.external_id == second.external_id
    assert first.external_id != ""


async def test_parse_event_returns_none_with_no_user_claim():
    adapter = _adapter()
    body = json.dumps({"text": "hello"}).encode()

    assert await adapter.parse_event(body=body) is None


async def test_parse_event_returns_none_with_no_content():
    adapter = _adapter()
    body = json.dumps({"user": "U1"}).encode()

    assert await adapter.parse_event(body=body) is None


async def test_parse_event_ignores_a_message_claiming_to_be_agent_authored():
    adapter = _adapter()
    body = json.dumps(
        {"user": "U1", "text": "hi", "sender": {"kind": "agent"}}
    ).encode()

    assert await adapter.parse_event(body=body) is None


async def test_parse_event_accepts_pre_shaped_content_parts():
    adapter = _adapter()
    parts = [{"type": "text", "text": "hi"}, {"type": "button", "id": "1"}]
    body = json.dumps({"user": "U1", "content": parts}).encode()

    event = await adapter.parse_event(body=body)

    assert event.processed.content == parts


# --------------------------------------------------------------------------- #
# egress: no outbound call, and edit echoes the receipt back unchanged.
# --------------------------------------------------------------------------- #


async def test_post_message_returns_a_receipt_keyed_on_the_idempotency_key():
    adapter = _adapter()
    key = uuid4()

    receipt = await adapter.post_message(
        connection=_connection(),
        locator={"user": "U1"},
        content=[{"type": "text", "text": "hi"}],
        idempotency_key=key,
    )

    assert receipt == {"agenta_message_id": str(key)}


async def test_edit_message_echoes_the_external_locator_unchanged():
    adapter = _adapter()
    receipt = {"agenta_message_id": "abc"}

    edited = await adapter.edit_message(
        connection=_connection(),
        external_locator=receipt,
        content=[{"type": "text", "text": "done"}],
        idempotency_key=uuid4(),
    )

    assert edited == receipt
    assert edited is not receipt  # a copy, not the same dict the caller holds


# --------------------------------------------------------------------------- #
# discover_spaces: reads our own space rows, scoped by the connection's own
# recorded project -- the only adapter with no platform to call instead.
# --------------------------------------------------------------------------- #


async def test_discover_spaces_returns_the_connections_own_space_rows():
    connection = _connection()
    space = ChannelSpace(
        id=uuid4(),
        connection_id=connection.id,
        kind=ChannelSpaceKind.PRIVATE,
        external_key=uuid4(),
        data=ChannelSpaceData(external_locator={"user": "U1"}),
    )
    dao = FakeChannelsDAO(spaces=[space])
    adapter = _adapter(dao)

    candidates = await adapter.discover_spaces(connection=connection)

    assert len(candidates) == 1
    assert candidates[0].kind == ChannelSpaceKind.PRIVATE
    assert candidates[0].external_locator == {"user": "U1"}
    assert candidates[0].display_name == "U1"
    assert candidates[0].is_configured is True
    assert dao.last_query == ChannelSpaceQuery(connection_id=connection.id)


async def test_discover_spaces_is_empty_with_no_recorded_project():
    connection = ChannelConnection(
        id=uuid4(),
        slug="unconfigured",
        channel="agenta",
        external_key=uuid4(),
        data=None,
    )
    adapter = _adapter()

    assert await adapter.discover_spaces(connection=connection) == []


# --------------------------------------------------------------------------- #
# fetch_history: declared unsupported, refuses rather than returning empty.
# --------------------------------------------------------------------------- #


async def test_fetch_history_refuses_rather_than_returning_empty():
    adapter = _adapter()

    with pytest.raises(ChannelBackfillRefused):
        await adapter.fetch_history(
            connection=_connection(), locator={"user": "U1"}, limit=10
        )


# --------------------------------------------------------------------------- #
# capabilities: declares everything, and the identity fields this package's
# whole seam-2 argument depends on.
# --------------------------------------------------------------------------- #


async def test_fetch_capabilities_declares_the_specified_identity_fields():
    from oss.src.core.channels.dtos import ChannelKeyGrain

    adapter = _adapter()
    capabilities = await adapter.fetch_capabilities()

    assert capabilities.identity.keys[ChannelKeyGrain.CONNECTION] == [
        "project",
        "bot",
    ]
    assert capabilities.identity.keys[ChannelKeyGrain.SPACE] == ["user"]
    assert capabilities.identity.keys[ChannelKeyGrain.THREAD] == ["thread"]
    assert capabilities.fill.backfill.supported is False
    assert capabilities.rendering.controls.update is True
