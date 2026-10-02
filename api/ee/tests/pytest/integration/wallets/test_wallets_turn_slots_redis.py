"""Running agent turns per organization, in real Redis: the count, its expiry, and
renewal."""

import asyncio
from uuid import uuid4

import pytest
from redis.asyncio import Redis

from oss.src.utils.env import env

from ee.src.dbs.redis.wallets.turns import RedisTurnSlots

pytestmark = pytest.mark.asyncio


@pytest.fixture
async def slots():
    client = Redis.from_url(env.redis.uri_volatile, decode_responses=False)
    yield RedisTurnSlots(redis_client=client)
    await client.close()


async def test_the_limit_holds_and_a_released_slot_is_free_again(slots):
    org = uuid4()
    hold = dict(organization_id=org, limit=2, ttl_seconds=60)

    assert await slots.acquire(turn_id="a", **hold)
    assert await slots.acquire(turn_id="b", **hold)
    assert await slots.acquire(turn_id="a", **hold)  # the same turn again
    assert not await slots.acquire(turn_id="c", **hold)
    assert await slots.acquire(
        turn_id="x", organization_id=uuid4(), limit=2, ttl_seconds=60
    )

    await slots.release(organization_id=org, turn_id="a")
    assert await slots.acquire(turn_id="c", **hold)


async def test_a_turn_whose_runner_stopped_beating_leaves_the_count(slots):
    org = uuid4()
    assert await slots.acquire(organization_id=org, turn_id="a", limit=1, ttl_seconds=1)
    assert not await slots.acquire(
        organization_id=org, turn_id="b", limit=1, ttl_seconds=1
    )

    await asyncio.sleep(1.2)

    assert await slots.acquire(organization_id=org, turn_id="b", limit=1, ttl_seconds=1)


async def test_a_beat_keeps_the_hold_and_takes_back_an_expired_one(slots):
    org = uuid4()
    assert await slots.acquire(organization_id=org, turn_id="a", limit=1, ttl_seconds=1)
    await asyncio.sleep(0.6)
    await slots.renew(organization_id=org, turn_id="a", ttl_seconds=1)
    await asyncio.sleep(0.6)
    # Past the first hold's expiry, still held by the beat.
    assert not await slots.acquire(
        organization_id=org, turn_id="b", limit=1, ttl_seconds=1
    )

    await asyncio.sleep(1.2)
    await slots.renew(organization_id=org, turn_id="a", ttl_seconds=60)
    # A running turn is never stopped by the count: its beat takes the slot back.
    assert not await slots.acquire(
        organization_id=org, turn_id="b", limit=1, ttl_seconds=60
    )


async def test_concurrent_admissions_never_exceed_the_limit(slots):
    org = uuid4()
    results = await asyncio.gather(
        *(
            slots.acquire(
                organization_id=org, turn_id=f"t-{i}", limit=3, ttl_seconds=60
            )
            for i in range(20)
        )
    )
    assert sum(results) == 3


async def test_a_beat_that_lands_after_the_release_does_not_hold_the_slot_again(slots):
    org = uuid4()
    assert await slots.acquire(
        organization_id=org, turn_id="a", limit=1, ttl_seconds=60
    )
    await slots.release(organization_id=org, turn_id="a")
    await slots.renew(organization_id=org, turn_id="a", ttl_seconds=60)

    assert await slots.acquire(
        organization_id=org, turn_id="b", limit=1, ttl_seconds=60
    )


async def test_the_same_turn_id_admitted_again_is_held_by_its_beats(slots):
    org = uuid4()
    assert await slots.acquire(organization_id=org, turn_id="a", limit=1, ttl_seconds=1)
    await slots.release(organization_id=org, turn_id="a")
    assert await slots.acquire(organization_id=org, turn_id="a", limit=1, ttl_seconds=1)
    await asyncio.sleep(0.6)
    await slots.renew(organization_id=org, turn_id="a", ttl_seconds=60)
    await asyncio.sleep(0.6)

    assert not await slots.acquire(
        organization_id=org, turn_id="b", limit=1, ttl_seconds=60
    )
