"""The recorder's own contract: posts are ordered, edits target the row they
say they target, and a redelivered idempotency key does not produce a second
post.
"""

from uuid import uuid4

import pytest

from oss.src.core.channels.adapters.mock.adapter import MockAdapter
from oss.src.core.channels.dtos import ChannelConnection


def _connection() -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="mock-connection",
        channel="mock",
        external_key=uuid4(),
    )


@pytest.mark.asyncio
async def test_posts_are_recorded_in_order():
    adapter = MockAdapter()
    connection = _connection()

    receipt_a = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "first"}],
        idempotency_key=uuid4(),
    )
    receipt_b = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "second"}],
        idempotency_key=uuid4(),
    )

    posted_texts = [row["content"][0]["text"] for row in adapter._recorder.posts]
    assert posted_texts == ["first", "second"]
    assert receipt_a != receipt_b


@pytest.mark.asyncio
async def test_edit_targets_the_stated_row_only():
    adapter = MockAdapter()
    connection = _connection()

    receipt_a = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "first"}],
        idempotency_key=uuid4(),
    )
    receipt_b = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "second"}],
        idempotency_key=uuid4(),
    )

    edited = await adapter.edit_message(
        connection=connection,
        external_locator=receipt_a,
        content=[{"type": "text", "text": "first-edited"}],
        idempotency_key=uuid4(),
    )

    assert edited == receipt_a
    assert adapter.inspect_posted(receipt_a) == [
        {"type": "text", "text": "first-edited"}
    ]
    assert adapter.inspect_posted(receipt_b) == [{"type": "text", "text": "second"}]


@pytest.mark.asyncio
async def test_redelivered_idempotency_key_produces_no_second_post():
    adapter = MockAdapter()
    connection = _connection()
    key = uuid4()

    first = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "hello"}],
        idempotency_key=key,
    )
    second = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "hello, again"}],
        idempotency_key=key,
    )

    assert first == second
    assert len(adapter._recorder.posts) == 1
    assert adapter.inspect_posted(first) == [{"type": "text", "text": "hello"}]


@pytest.mark.asyncio
async def test_redelivered_idempotency_key_on_edit_does_not_reapply():
    adapter = MockAdapter()
    connection = _connection()
    receipt = await adapter.post_message(
        connection=connection,
        locator={"team": "T1", "channel": "C1"},
        content=[{"type": "text", "text": "first"}],
        idempotency_key=uuid4(),
    )

    edit_key = uuid4()
    first_edit = await adapter.edit_message(
        connection=connection,
        external_locator=receipt,
        content=[{"type": "text", "text": "edited-once"}],
        idempotency_key=edit_key,
    )
    second_edit = await adapter.edit_message(
        connection=connection,
        external_locator=receipt,
        content=[{"type": "text", "text": "edited-twice"}],
        idempotency_key=edit_key,
    )

    assert first_edit == second_edit
    assert adapter.inspect_posted(receipt) == [{"type": "text", "text": "edited-once"}]
