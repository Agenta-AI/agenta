"""Fakes for the Discord socket loop tests: the gateway client, the adapter,
the channels service and the lock store. The loop is written against the
adapter interface plus `fetch_messages_after`, so the fake adapter maps a
`{"t", "d"}` body to an event the way the real one does for these fields."""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from uuid import UUID, uuid4

import oss.src.utils.locking as locking
from oss.src.core.channels.adapters.discord.capabilities import (
    fetch_discord_capabilities,
)
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelConnectionFlags,
    ChannelEventKind,
    ChannelInboundEvent,
    ChannelInboxEvent,
    ChannelInboxEventData,
    ChannelInboxEventProcessed,
    ChannelSpaceKind,
)
from oss.src.core.channels.types import ChannelInboxEnqueueFailed, ChannelNotSupported
from oss.src.tasks.asyncio.channels import discord_socket


def frame(event: str, data: Optional[Dict[str, Any]] = None) -> str:
    return json.dumps({"op": 0, "t": event, "s": 1, "d": data or {}})


def message(
    message_id: str, channel_id: str = "C1", guild_id: str = "G1", content: str = "hi"
):
    data = {"id": message_id, "channel_id": channel_id, "content": content}
    if guild_id:
        data["guild_id"] = guild_id
    return data


def connection(token: str = "token-1", updated_at=None) -> ChannelConnection:
    return ChannelConnection(
        id=uuid4(),
        slug="discord-bot",
        channel="discord",
        external_key=uuid4(),
        updated_at=updated_at or datetime(2026, 11, 7, tzinfo=timezone.utc),
        flags=ChannelConnectionFlags(is_active=True, is_verified=True),
        data={"bot_token": token},
    )


class FakeClient:
    """Stands in for `discord.Client`: `start` blocks until `close`, or raises
    the next queued failure."""

    instances: List["FakeClient"] = []
    failures: List[BaseException] = []

    def __init__(self, socket) -> None:
        self.socket = socket
        self.tokens: List[str] = []
        self.closed = asyncio.Event()
        FakeClient.instances.append(self)

    async def start(self, token: str) -> None:
        self.tokens.append(token)
        if FakeClient.failures:
            raise FakeClient.failures.pop(0)
        await self.closed.wait()

    async def close(self) -> None:
        self.closed.set()

    @classmethod
    def reset(cls) -> None:
        cls.instances = []
        cls.failures = []


class FakeAdapter:
    channel = "discord"

    def __init__(self) -> None:
        # channel id -> the channel's messages, any order
        self.history: Dict[str, List[Dict[str, Any]]] = {}
        self.history_reads: List[tuple] = []
        self.page_size = 100

    async def fetch_capabilities(self, *, connection=None):
        return fetch_discord_capabilities()

    async def parse_event(self, *, body: bytes, connection=None, request=None):
        payload = json.loads(body)
        data = payload.get("d") or {}
        if payload.get("t") != "MESSAGE_CREATE" or connection is None:
            return None
        guild_id = str(data.get("guild_id") or "")
        return ChannelInboundEvent(
            external_id=str(data["id"]),
            kind=ChannelEventKind.MESSAGE,
            space_kind=ChannelSpaceKind.TOPIC if guild_id else ChannelSpaceKind.PRIVATE,
            external_locator={
                "guild_id": guild_id,
                "channel_id": data["channel_id"],
                "thread_id": "",
                "source_channel_id": data["channel_id"],
                "message_id": str(data["id"]),
            },
            processed=ChannelInboxEventProcessed(
                content=[{"type": "text", "text": data.get("content", "")}],
                sender={"id": "U1"},
                message_ref=str(data["id"]),
            ),
            addressed=True,
        )

    async def fetch_messages_after(self, *, connection, channel_id: str, after: str):
        self.history_reads.append((channel_id, after))
        newer = [
            m for m in self.history.get(channel_id, []) if int(m["id"]) > int(after)
        ]
        # Oldest first, as the real adapter returns a page.
        newer.sort(key=lambda m: int(m["id"]))
        return newer[: self.page_size]


class FakeRegistry:
    def __init__(self, adapter: Optional[FakeAdapter]) -> None:
        self.adapter = adapter

    def get(self, channel: str):
        if self.adapter is None:
            raise ChannelNotSupported(channel=channel)
        return self.adapter


class FakeChannelsService:
    def __init__(self, adapter: Optional[FakeAdapter] = None) -> None:
        self.adapter_registry = FakeRegistry(adapter or FakeAdapter())
        self.project_id = uuid4()
        # connection id -> the connection, hydrated
        self.connections: Dict[UUID, ChannelConnection] = {}
        self.fetches: List[UUID] = []
        # (connection id, external id) -> the stored row
        self.rows: Dict[tuple, ChannelInboxEvent] = {}
        self.enqueued: List[str] = []
        self.attempts: List[str] = []
        self.fail_enqueues = 0
        # Inserts that fail before the row is stored, as in a database outage.
        self.fail_stores = 0
        # External ids whose insert fails for good.
        self.refuse: set = set()
        self.start_queries = 0
        # Set to block every reload in query_active_connections.
        self.reload_gate: Optional[asyncio.Event] = None

    def add(self, conn: ChannelConnection) -> ChannelConnection:
        self.connections[conn.id] = conn
        return conn

    def store_row(self, conn: ChannelConnection, inbound: ChannelInboundEvent):
        key = (conn.id, inbound.external_id)
        if key in self.rows:
            return None
        row = ChannelInboxEvent(
            id=uuid4(),
            created_at=datetime.now(timezone.utc),
            connection_id=conn.id,
            external_id=inbound.external_id,
            kind=inbound.kind,
            origin=inbound.origin,
            data=ChannelInboxEventData(
                external_locator=inbound.external_locator,
                processed=inbound.processed,
                space_kind=inbound.space_kind,
                addressed=inbound.addressed,
            ),
        )
        self.rows[key] = row
        return row

    async def query_active_connections(self, *, channel: str):
        if self.reload_gate is not None:
            await self.reload_gate.wait()
        return [(self.project_id, conn) for conn in self.connections.values()]

    async def fetch_connection(self, *, project_id, connection_id):
        self.fetches.append(connection_id)
        return self.connections.get(connection_id)

    async def record_and_enqueue_inbox_event(
        self, *, project_id, connection_id, channel, inbound
    ):
        self.attempts.append(inbound.external_id)
        if self.fail_stores > 0:
            self.fail_stores -= 1
            raise ConnectionError("database down")
        if inbound.external_id in self.refuse:
            raise ValueError("a row no retry can store")
        self.store_row(self.connections[connection_id], inbound)
        if self.fail_enqueues > 0:
            self.fail_enqueues -= 1
            raise ChannelInboxEnqueueFailed(
                channel=channel, external_id=inbound.external_id
            )
        self.enqueued.append(inbound.external_id)

    async def query_inbox_events(self, *, project_id, event=None, windowing=None):
        if event.external_id is not None:
            row = self.rows.get((event.connection_id, event.external_id))
            return [row] if row is not None else []
        self.start_queries += 1
        return [
            row
            for row in self.rows.values()
            if row.connection_id == event.connection_id
            and row.kind == event.kind
            and row.origin == event.origin
            and windowing.oldest <= row.created_at <= windowing.newest
        ]

    def route(self, conn: ChannelConnection, external_id: str) -> None:
        """What the dispatcher's routing does: attach the row to its space."""

        key = (conn.id, external_id)
        self.rows[key] = self.rows[key].model_copy(update={"space_id": uuid4()})


class FakeLocks:
    """An in-memory lock store with the `locking` helpers' semantics."""

    def __init__(self) -> None:
        self.owners: Dict[str, str] = {}
        self.renew_ok = True
        self.released: List[str] = []
        # Set to make every renewal hang, as on a Redis that stopped answering.
        self.renew_gate: Optional[asyncio.Event] = None

    def expire(self) -> None:
        """The lease runs out, as when no renewal reached Redis in time."""

        self.owners.clear()

    def install(self, monkeypatch) -> "FakeLocks":
        monkeypatch.setattr(locking, "acquire_lock", self.acquire)
        monkeypatch.setattr(locking, "renew_lock", self.renew)
        monkeypatch.setattr(locking, "release_lock", self.release)
        return self

    async def acquire(self, namespace, key=None, ttl=None, **_):
        name = f"{namespace}:{key}"
        if name in self.owners:
            return None
        owner = uuid4().hex
        self.owners[name] = owner
        return owner

    async def renew(self, namespace, key=None, ttl=None, owner=None, **_):
        if self.renew_gate is not None:
            await self.renew_gate.wait()
        name = f"{namespace}:{key}"
        return self.renew_ok and self.owners.get(name) == owner

    async def release(self, namespace, key=None, owner=None, **_):
        name = f"{namespace}:{key}"
        if self.owners.get(name) == owner:
            del self.owners[name]
            self.released.append(owner)
            return True
        return False


def fast(monkeypatch, tick: float = 0.01) -> None:
    monkeypatch.setattr(discord_socket, "TICK_SECONDS", tick)
    monkeypatch.setattr(discord_socket, "RETRY_FIRST_SECONDS", tick)
    monkeypatch.setattr(
        discord_socket, "RECOVERY_CLOCK_MARGIN", timedelta(milliseconds=5)
    )


async def until(condition, timeout: float = 2.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not condition():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.005)
