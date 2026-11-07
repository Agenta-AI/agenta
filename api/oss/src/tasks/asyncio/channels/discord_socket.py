"""Discord socket loop — the inbound transport of the Discord channel.

Discord delivers messages and button clicks only over the Discord Gateway, a
WebSocket the bot keeps open. `worker-queues` runs this loop next to its
`channels-inbox` consumer. One Redis lock makes one process the holder of every
Discord socket; another replica waits for the lock.

The loop does no routing. Each dispatch goes through the adapter's
`parse_event` and `ChannelsService.record_and_enqueue_inbox_event`, the same
step the HTTP ingress runs, and the inbox worker takes it from there.
`discord.py` runs the socket only (connect, heartbeat, resume, reconnect).

After a socket starts with a fresh IDENTIFY instead of a resume, Discord does
not replay what it sent while the socket was down. The loop then reads channel
history after a snapshot of the last stored message per channel and passes each
message through the same step; the inbox unique constraint drops anything that
already arrived.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Set, Tuple
from uuid import UUID

import discord

import oss.src.utils.locking as locking
from oss.src.core.channels.dtos import (
    ChannelConnection,
    ChannelEventKind,
    ChannelEventOrigin,
    ChannelInboxEventQuery,
)
from oss.src.core.channels.types import ChannelInboxEnqueueFailed, ChannelNotSupported
from oss.src.core.shared.dtos import Windowing
from oss.src.utils.logging import get_module_logger

if TYPE_CHECKING:
    from oss.src.core.channels.service import ChannelsService

log = get_module_logger(__name__)

CHANNEL = "discord"

LOCK_NAMESPACE = "channels"
LOCK_KEY = "discord:sockets"
# Short, so the sockets pause briefly when the holder dies.
LOCK_TTL_SECONDS = 15
# The holder renews the lock and reloads the connections on every tick, so
# a setup change takes effect within a tick.
TICK_SECONDS = 5

# Both retries back off from RETRY_FIRST_SECONDS, doubling up to their cap.
RETRY_FIRST_SECONDS = 1
ENQUEUE_RETRY_MAX_SECONDS = 30
SOCKET_RETRY_MAX_SECONDS = 300

# Recovery reads history only for channels with a stored message this recent,
# from at most this many of the connection's newest rows.
RECOVERY_WINDOW = timedelta(hours=24)
RECOVERY_SCAN_LIMIT = 1000

# GUILDS, GUILD_MESSAGES, DIRECT_MESSAGES and the privileged MESSAGE_CONTENT.
_INTENTS = discord.Intents.none()
_INTENTS.guilds = True
_INTENTS.guild_messages = True
_INTENTS.dm_messages = True
_INTENTS.message_content = True

_ROUTED_EVENTS = ("MESSAGE_CREATE", "INTERACTION_CREATE")

# channel id -> (highest stored message id, guild id). The guild id is put back
# on each history message, which Discord sends without one.
Snapshot = Dict[str, Tuple[str, str]]


class _GatewayClient(discord.Client):
    """One bot's socket. Hands every raw gateway frame to its `DiscordSocket`.
    No discord.py cache is needed: events are read from the raw frames."""

    def __init__(self, socket: "DiscordSocket") -> None:
        super().__init__(
            intents=_INTENTS,
            enable_debug_events=True,
            max_messages=None,
            member_cache_flags=discord.MemberCacheFlags.none(),
            chunk_guilds_at_startup=False,
        )
        self._socket = socket

    async def on_socket_raw_receive(self, raw: str) -> None:
        self._socket.receive(raw)

    async def on_disconnect(self) -> None:
        self._socket.disconnected()


def _gateway_client(socket: "DiscordSocket") -> Any:
    return _GatewayClient(socket)


async def _wait(shutdown: asyncio.Event, seconds: float) -> bool:
    """Sleep, or return early with True when shutdown is set."""

    try:
        await asyncio.wait_for(shutdown.wait(), timeout=seconds)
        return True
    except asyncio.TimeoutError:
        return False


def _bot_token(connection: ChannelConnection) -> str:
    return str((connection.data or {}).get("bot_token") or "")


class DiscordSocket:
    """The socket of one Discord connection, with its own retry and recovery.
    One failing socket never touches the others."""

    def __init__(
        self,
        *,
        project_id: UUID,
        connection: ChannelConnection,
        adapter: Any,
        channels_service: "ChannelsService",
        client_factory: Callable[["DiscordSocket"], Any] = _gateway_client,
    ) -> None:
        self.project_id = project_id
        self.connection = connection
        self.token = _bot_token(connection)
        self.adapter = adapter
        self.channels_service = channels_service
        self.client_factory = client_factory
        self.client: Optional[Any] = None
        # The snapshot for the next recovery, taken when the socket closes. It
        # is kept until a recovery with it finishes, so a socket that fails
        # again before it identifies reuses it.
        self.snapshot: Optional[asyncio.Task] = None
        self.recovery: Optional[asyncio.Task] = None
        self.tasks: Set[asyncio.Task] = set()
        self.task: Optional[asyncio.Task] = None

    def open(self) -> None:
        self.task = asyncio.create_task(self._run())

    async def close(self) -> None:
        for task in [self.task, self.recovery, self.snapshot, *self.tasks]:
            if task is not None and not task.done():
                task.cancel()
        if self.client is not None:
            try:
                await self.client.close()
            except Exception:  # noqa: BLE001 - closing is best-effort
                log.warning("[DISCORD] socket close failed", exc_info=True)
        for task in [self.task, self.recovery, self.snapshot, *self.tasks]:
            if task is not None:
                try:
                    await task
                except BaseException:  # noqa: BLE001 - cancelled or already logged
                    pass

    async def _run(self) -> None:
        connection_id = str(self.connection.id)
        delay = RETRY_FIRST_SECONDS
        while True:
            # Messages posted while no socket was open are recovered after
            # the first IDENTIFY, as after any other gap.
            if self.snapshot is None:
                self.snapshot = asyncio.create_task(self._take_snapshot())
            self.client = self.client_factory(self)
            try:
                await self.client.start(self.token)
                return
            except discord.PrivilegedIntentsRequired:
                log.error(
                    "[DISCORD] Message Content intent is off; Discord closed the socket with 4014",
                    connection_id=connection_id,
                )
            except discord.LoginFailure:
                log.error("[DISCORD] bot token rejected", connection_id=connection_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning(
                    "[DISCORD] socket failed",
                    connection_id=connection_id,
                    exc_info=True,
                )
            finally:
                try:
                    await self.client.close()
                except Exception:  # noqa: BLE001 - closing is best-effort
                    pass
            await asyncio.sleep(delay)
            delay = min(delay * 2, SOCKET_RETRY_MAX_SECONDS)

    # --- events -------------------------------------------------------------- #

    def receive(self, raw: str) -> None:
        try:
            frame = json.loads(raw)
        except (TypeError, ValueError):
            return
        if not isinstance(frame, dict) or frame.get("op") != 0:
            return

        event = frame.get("t")
        if event == "READY":
            # A fresh IDENTIFY: Discord replays nothing from the gap.
            if self.snapshot is not None and (
                self.recovery is None or self.recovery.done()
            ):
                self.recovery = asyncio.create_task(self._recover(self.snapshot))
        elif event == "RESUMED":
            # Discord replays the missed events itself.
            if self.recovery is None or self.recovery.done():
                self._drop_snapshot()
        elif event in _ROUTED_EVENTS:
            body = json.dumps({"t": event, "d": frame.get("d")}).encode("utf-8")
            self._spawn(self.dispatch(body))

    def disconnected(self) -> None:
        if self.snapshot is None:
            self.snapshot = asyncio.create_task(self._take_snapshot())

    def _drop_snapshot(self) -> None:
        if self.snapshot is not None and not self.snapshot.done():
            self.snapshot.cancel()
        self.snapshot = None

    def _spawn(self, coroutine) -> None:
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def dispatch(self, body: bytes) -> None:
        """One gateway event through the adapter and the shared step."""

        try:
            inbound = await self.adapter.parse_event(
                body=body, connection=self.connection
            )
        except Exception:
            log.error(
                "[DISCORD] event could not be parsed",
                connection_id=str(self.connection.id),
                exc_info=True,
            )
            return
        if inbound is None:
            return
        for event in inbound if isinstance(inbound, list) else [inbound]:
            await self._store(event)

    async def _store(self, inbound) -> None:
        """Retry a failed enqueue with the same event until it lands. The
        socket keeps reading meanwhile: each event runs in its own task."""

        delay = RETRY_FIRST_SECONDS
        while True:
            try:
                await self.channels_service.record_and_enqueue_inbox_event(
                    project_id=self.project_id,
                    connection_id=self.connection.id,
                    channel=CHANNEL,
                    inbound=inbound,
                )
                return
            except ChannelInboxEnqueueFailed:
                log.warning(
                    "[DISCORD] enqueue failed; retrying",
                    connection_id=str(self.connection.id),
                    external_id=inbound.external_id,
                    retry_in=delay,
                )
            except Exception:
                log.error(
                    "[DISCORD] event could not be stored",
                    connection_id=str(self.connection.id),
                    external_id=inbound.external_id,
                    exc_info=True,
                )
                return
            await asyncio.sleep(delay)
            delay = min(delay * 2, ENQUEUE_RETRY_MAX_SECONDS)

    # --- recovery ------------------------------------------------------------ #

    async def _take_snapshot(self) -> Snapshot:
        """The highest stored message id per channel Discord delivered in,
        from the connection's pushed messages of the recovery window."""

        rows = await self.channels_service.query_inbox_events(
            project_id=self.project_id,
            event=ChannelInboxEventQuery(
                connection_id=self.connection.id,
                kind=ChannelEventKind.MESSAGE,
                origin=ChannelEventOrigin.PUSHED,
            ),
            windowing=Windowing(
                oldest=datetime.now(timezone.utc) - RECOVERY_WINDOW,
                limit=RECOVERY_SCAN_LIMIT,
            ),
        )
        snapshot: Snapshot = {}
        for row in rows:
            locator = row.data.external_locator if row.data else {}
            channel_id = str(locator.get("source_channel_id") or "")
            if not channel_id or not str(row.external_id).isdigit():
                continue
            # Snowflakes compare as integers, not as strings.
            current = snapshot.get(channel_id)
            if current is None or int(row.external_id) > int(current[0]):
                snapshot[channel_id] = (
                    str(row.external_id),
                    str(locator.get("guild_id") or ""),
                )
        return snapshot

    async def _recover(self, snapshot_task: asyncio.Task) -> None:
        connection_id = str(self.connection.id)
        try:
            snapshot = await snapshot_task
        except Exception:
            log.error(
                "[DISCORD] recovery snapshot failed",
                connection_id=connection_id,
                exc_info=True,
            )
            snapshot = {}
        for channel_id, (after, guild_id) in snapshot.items():
            try:
                await self._recover_channel(channel_id, after, guild_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning(
                    "[DISCORD] recovery skipped a channel",
                    connection_id=connection_id,
                    channel_id=channel_id,
                    exc_info=True,
                )
        if self.snapshot is snapshot_task:
            self.snapshot = None

    async def _recover_channel(
        self, channel_id: str, after: str, guild_id: str
    ) -> None:
        cursor = after
        while True:
            messages: List[Dict[str, Any]] = await self.adapter.fetch_messages_after(
                connection=self.connection, channel_id=channel_id, after=cursor
            )
            if not messages:
                return
            messages = sorted(messages, key=lambda message: int(message["id"]))
            for message in messages:
                data = dict(message)
                if guild_id:
                    data["guild_id"] = guild_id
                await self.dispatch(
                    json.dumps({"t": "MESSAGE_CREATE", "d": data}).encode("utf-8")
                )
            cursor = str(messages[-1]["id"])


class DiscordSocketLoop:
    """Holds the lock, and keeps one `DiscordSocket` per active connection
    while it does."""

    def __init__(
        self,
        *,
        channels_service: "ChannelsService",
        client_factory: Callable[[DiscordSocket], Any] = _gateway_client,
    ) -> None:
        self.channels_service = channels_service
        self.client_factory = client_factory
        self.sockets: Dict[UUID, DiscordSocket] = {}
        # connection id -> `updated_at` when its socket was opened. A token
        # rotation edits the row, so an unchanged row needs no credential read.
        self.versions: Dict[UUID, Optional[datetime]] = {}

    async def run(self, shutdown: asyncio.Event) -> None:
        while not shutdown.is_set():
            owner = await locking.acquire_lock(
                namespace=LOCK_NAMESPACE, key=LOCK_KEY, ttl=LOCK_TTL_SECONDS
            )
            if owner is None:
                await _wait(shutdown, TICK_SECONDS)
                continue

            log.info("[DISCORD] socket lock acquired")
            try:
                await self._hold(owner, shutdown)
            except Exception:
                log.error("[DISCORD] socket loop failed", exc_info=True)
            finally:
                await self.close_all()
                await locking.release_lock(
                    namespace=LOCK_NAMESPACE, key=LOCK_KEY, owner=owner
                )
            if not shutdown.is_set():
                await _wait(shutdown, TICK_SECONDS)

    async def _hold(self, owner: str, shutdown: asyncio.Event) -> None:
        while not shutdown.is_set():
            try:
                await self.reload()
            except Exception:
                log.error("[DISCORD] connection reload failed", exc_info=True)
            if await _wait(shutdown, TICK_SECONDS):
                return
            if not await locking.renew_lock(
                namespace=LOCK_NAMESPACE,
                key=LOCK_KEY,
                ttl=LOCK_TTL_SECONDS,
                owner=owner,
            ):
                # Another replica may take the lock now; close before it opens.
                log.warning("[DISCORD] socket lock lost; closing sockets")
                return

    async def reload(self) -> None:
        """Open, restart or close sockets to match the active connections."""

        try:
            adapter = self.channels_service.adapter_registry.get(CHANNEL)
        except ChannelNotSupported:
            await self.close_all()
            return

        active = await self.channels_service.query_active_connections(channel=CHANNEL)
        wanted = {
            connection.id: (project_id, connection) for project_id, connection in active
        }

        for connection_id in list(self.sockets):
            if connection_id not in wanted:
                await self._close(connection_id)

        for connection_id, (project_id, row) in wanted.items():
            if (
                connection_id in self.sockets
                and self.versions.get(connection_id) == row.updated_at
            ):
                continue
            connection = await self.channels_service.fetch_connection(
                project_id=project_id, connection_id=connection_id
            )
            if connection is None or not _bot_token(connection):
                await self._close(connection_id)
                continue
            current = self.sockets.get(connection_id)
            if current is not None and current.token == _bot_token(connection):
                self.versions[connection_id] = row.updated_at
                continue
            if current is not None:
                await self._close(connection_id)
            socket = DiscordSocket(
                project_id=project_id,
                connection=connection,
                adapter=adapter,
                channels_service=self.channels_service,
                client_factory=self.client_factory,
            )
            socket.open()
            self.sockets[connection_id] = socket
            self.versions[connection_id] = row.updated_at
            log.info("[DISCORD] socket opened", connection_id=str(connection_id))

    async def _close(self, connection_id: UUID) -> None:
        socket = self.sockets.pop(connection_id, None)
        self.versions.pop(connection_id, None)
        if socket is not None:
            await socket.close()
            log.info("[DISCORD] socket closed", connection_id=str(connection_id))

    async def close_all(self) -> None:
        for connection_id in list(self.sockets):
            await self._close(connection_id)
