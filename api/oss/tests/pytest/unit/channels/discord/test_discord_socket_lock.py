"""One lock owns every Discord socket: one holder opens them, a lost lock
closes them, and the lock is released on shutdown."""

import asyncio

from oss.src.tasks.asyncio.channels.discord_socket import DiscordSocketLoop

from .socket_fakes import FakeChannelsService, FakeClient, FakeLocks, connection
from .socket_fakes import fast, until


def _loop(service):
    return DiscordSocketLoop(channels_service=service, client_factory=FakeClient)


async def test_one_of_two_replicas_holds_the_lock_and_opens_sockets(monkeypatch):
    fast(monkeypatch)
    FakeClient.reset()
    locks = FakeLocks().install(monkeypatch)
    service = FakeChannelsService()
    service.add(connection())
    first, second = _loop(service), _loop(service)
    shutdown = asyncio.Event()

    tasks = [asyncio.create_task(loop.run(shutdown)) for loop in (first, second)]
    await until(lambda: len(first.sockets) + len(second.sockets) == 1)
    await asyncio.sleep(0.05)

    assert len(first.sockets) + len(second.sockets) == 1
    assert len(FakeClient.instances) == 1
    assert len(locks.owners) == 1

    shutdown.set()
    await asyncio.gather(*tasks)
    assert locks.owners == {}
    assert FakeClient.instances[0].closed.is_set()


async def test_lost_lock_closes_every_socket(monkeypatch):
    fast(monkeypatch)
    FakeClient.reset()
    locks = FakeLocks().install(monkeypatch)
    service = FakeChannelsService()
    service.add(connection())
    service.add(connection(token="token-2"))
    loop = _loop(service)
    shutdown = asyncio.Event()

    task = asyncio.create_task(loop.run(shutdown))
    await until(lambda: len(loop.sockets) == 2)

    # Another replica takes the lock once it expires.
    locks.renew_ok = False
    await until(lambda: all(c.closed.is_set() for c in FakeClient.instances[:2]))
    assert len(locks.released) >= 1

    shutdown.set()
    await task


async def test_holder_that_stops_lets_the_other_replica_take_over(monkeypatch):
    fast(monkeypatch)
    FakeClient.reset()
    locks = FakeLocks().install(monkeypatch)
    service = FakeChannelsService()
    service.add(connection())
    first = _loop(service)
    stop_first = asyncio.Event()
    first_task = asyncio.create_task(first.run(stop_first))
    await until(lambda: len(first.sockets) == 1)

    second = _loop(service)
    stop_second = asyncio.Event()
    second_task = asyncio.create_task(second.run(stop_second))
    await asyncio.sleep(0.05)
    assert second.sockets == {}

    # The holder stops; its lock goes (released here, expired in a crash).
    stop_first.set()
    await first_task
    await until(lambda: len(second.sockets) == 1)
    assert len(locks.owners) == 1

    stop_second.set()
    await second_task
