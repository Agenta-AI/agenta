"""One test per capability arm: each of `no_threads`, `no_buttons`,
`no_history` against its supported counterpart (`full()`), asserting the
degradation `capabilities.md` specifies.
"""

from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.adapters.mock.capabilities import (
    full,
    no_buttons,
    no_history,
    no_threads,
)
from oss.src.core.channels.dtos import (
    ChannelKeyGrain,
    ChannelPolicy,
    ChannelPolicyLevel,
    ChannelSessionScope,
)
from oss.src.core.channels.utils import compose_external_key, resolve_policy
from oss.src.core.channels.adapters.slack.adapter import ChannelBackfillRefused
from oss.src.core.gateway.connections.dtos import ConnectionProviderKind
from oss.src.core.channels.dtos import ChannelConnection


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="mock-connection",
        provider_key=ConnectionProviderKind.AGENTA,
        integration_key="mock",
    )


# --------------------------------------------------------------------------- #
# conversation.units — threads vs no threads
# --------------------------------------------------------------------------- #


def test_full_declares_thread_grain_and_composes_a_thread_key():
    capabilities = full()
    assert ChannelKeyGrain.THREAD in capabilities.conversation.units

    key = compose_external_key(
        capabilities,
        ChannelKeyGrain.THREAD,
        {"team": "T1", "channel": "C1", "thread_ts": "1.1"},
    )
    assert key is not None


def test_no_threads_degrades_units_to_space_only():
    capabilities = no_threads()
    assert capabilities.conversation.units == [ChannelKeyGrain.SPACE]
    assert capabilities.conversation.default == ChannelKeyGrain.SPACE


def test_no_threads_thread_grain_composes_to_none_not_an_error():
    capabilities = no_threads()

    key = compose_external_key(
        capabilities,
        ChannelKeyGrain.THREAD,
        {"team": "T1", "channel": "C1", "thread_ts": "1.1"},
    )
    assert key is None


def test_no_threads_resolve_policy_degrades_thread_scope_to_message():
    """c1-merge-notes.md's own worked case: `units` is the ceiling on THREAD
    only. A policy stating THREAD against a channel that cannot offer it
    degrades to MESSAGE — never rejected, never left at THREAD."""

    capabilities = no_threads()
    # channel_defaults.session_scope is ChannelSessionScope ({thread, message}),
    # a different vocabulary from conversation.default (ChannelKeyGrain,
    # {thread, space}) — never feed one field from the other.
    channel_defaults = ChannelPolicy(
        session_scope=ChannelSessionScope.THREAD,
        backfill=True,
        forwardfill=True,
    )

    result = resolve_policy(
        capabilities,
        channel_defaults,
        ChannelPolicy(session_scope=ChannelSessionScope.THREAD),
        None,
        None,
    )

    assert result.session_scope == ChannelSessionScope.MESSAGE
    assert result.decided_by["session_scope"] == ChannelPolicyLevel.CAPABILITY


def test_full_resolve_policy_honours_stated_thread_scope():
    capabilities = full()
    channel_defaults = ChannelPolicy(
        session_scope=ChannelSessionScope.THREAD,
        backfill=True,
        forwardfill=True,
    )

    result = resolve_policy(
        capabilities,
        channel_defaults,
        ChannelPolicy(session_scope=ChannelSessionScope.THREAD),
        None,
        None,
    )

    assert result.session_scope == ChannelSessionScope.THREAD


# --------------------------------------------------------------------------- #
# rendering.buttons — supported vs not
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_full_posts_buttons_up_to_declared_max_unchanged():
    adapter = MockAdapter(capabilities=full())
    connection = _connection()
    content = [{"type": "button", "id": "1", "label": "Yes"}]

    receipt = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=content,
        idempotency_key=uuid4(),
    )

    posted = adapter.inspect_posted(receipt)
    assert posted == content


@pytest.mark.asyncio
async def test_no_buttons_degrades_to_numbered_text():
    adapter = MockAdapter(capabilities=no_buttons())
    connection = _connection()
    content = [
        {"type": "button", "id": "1", "label": "Yes"},
        {"type": "button", "id": "2", "label": "No"},
    ]

    receipt = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=content,
        idempotency_key=uuid4(),
    )

    posted = adapter.inspect_posted(receipt)
    assert not any(item.get("type") == "button" for item in posted)
    numbered = next(item for item in posted if item.get("type") == "text")
    assert "1. Yes" in numbered["text"]
    assert "2. No" in numbered["text"]


# --------------------------------------------------------------------------- #
# fill.backfill — supported vs not
# --------------------------------------------------------------------------- #


@pytest.mark.asyncio
async def test_full_fetch_history_returns_configured_list():
    from oss.src.core.channels.dtos import (
        ChannelEventKind,
        ChannelInboundEvent,
        ChannelInboxEventProcessed,
        ChannelSpaceKind,
    )

    event = ChannelInboundEvent(
        external_id="e1",
        kind=ChannelEventKind.MESSAGE,
        space_kind=ChannelSpaceKind.TOPIC,
        external_locator={"team": "T1", "channel": "C1"},
        processed=ChannelInboxEventProcessed(
            content=[{"type": "text", "text": "hi"}], sender={"id": "U1"}
        ),
    )
    adapter = MockAdapter(capabilities=full(), history=[event])
    connection = _connection()

    result = await adapter.fetch_history(
        connection=connection, locator={"team": "T1", "channel": "C1"}, limit=50
    )

    assert result == [event]


@pytest.mark.asyncio
async def test_no_history_fetch_history_raises_backfill_refused():
    adapter = MockAdapter(capabilities=no_history())
    connection = _connection()

    with pytest.raises(ChannelBackfillRefused):
        await adapter.fetch_history(
            connection=connection, locator={"team": "T1", "channel": "C1"}, limit=50
        )
