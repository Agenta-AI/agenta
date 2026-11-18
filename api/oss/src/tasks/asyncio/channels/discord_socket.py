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
not replay what it sent while the socket was down. So on every READY, the first
socket of a connection included, the loop reads each channel's history after the
last message stored before that READY, and passes each message through the same
step. The inbox unique constraint drops the row of a message the socket already
delivered. The step still enqueues the row again, and the dispatcher's claim on
`(thread_id, event_id)` stops a second turn. Commands run before that claim, so
recovery skips a command whose row the dispatcher already routed.

One error rule covers both paths (`_is_transient`). A transient error (network,
timeout, Discord 5xx or 429, a failed enqueue, a lost database connection) is
retried with the same event and backoff, for up to `RETRY_LIMIT_SECONDS`. Any
other error is permanent: the event is logged and dropped.
"""

import asyncio
import json
from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any, Callable, Dict, List, Optional, Set, Tuple
from uuid import UUID

import discord
import httpx
from sqlalchemy.exc import DBAPIError, InterfaceError, OperationalError
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

import oss.src.utils.locking as locking
from oss.src.core.channels.commands import parse_command
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
# The holder renews the lock on every tick, in a task of its own, and reloads
# the connections on every tick, so a setup change takes effect within a tick.
TICK_SECONDS = 5

# A renewal that takes longer counts as a lost lock. With a renewal every tick,
# the holder learns of the loss before the lease runs out.
RENEW_TIMEOUT_SECONDS = 5

# Every retry backs off from RETRY_FIRST_SECONDS, doubling up to its cap. A
# transient error that lasts longer than RETRY_LIMIT_SECONDS gives up.
RETRY_FIRST_SECONDS = 1
RETRY_MAX_SECONDS = 30
RETRY_LIMIT_SECONDS = 600
SOCKET_RETRY_MAX_SECONDS = 300

# Recovery reads history only for channels with a stored message this recent,
# from at most this many of the connection's newest rows.
RECOVERY_WINDOW = timedelta(hours=24)
RECOVERY_SCAN_LIMIT = 1000
# Rows stored this close to READY are left out of the recovery start, in case
# the database clock runs behind ours: a live row stored after READY could then
# carry an earlier time. A lower start reads again messages the unique
# constraint drops. A channel whose only rows fall inside the margin is not
# recovered, which is a documented limit.
RECOVERY_CLOCK_MARGIN = timedelta(seconds=5)

# GUILDS, GUILD_MESSAGES, DIRECT_MESSAGES and the privileged MESSAGE_CONTENT.
_INTENTS = discord.Intents.none()
_INTENTS.guilds = True
_INTENTS.guild_messages = True
_INTENTS.dm_messages = True
_INTENTS.message_content = True

_ROUTED_EVENTS = ("MESSAGE_CREATE", "INTERACTION_CREATE")

# channel id -> (highest message id stored before READY, guild id). The guild
# id is put back on each history message, which Discord sends without one.
RecoveryStart = Dict[str, Tuple[str, str]]


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


async def _wait(shutdown: asyncio.Event, seconds: float) -> bool:
    """Sleep, or return early with True when shutdown is set."""

    try:
        await asyncio.wait_for(shutdown.wait(), timeout=seconds)
        return True
    except asyncio.TimeoutError:
        return False


# Postgres SQLSTATEs a retry can outlast: connection exceptions (08),
# insufficient resources (53), operator intervention such as a shutdown or a
# failover (57), a serialization failure or deadlock, and a write that reached
# a primary demoted to read-only during a failover. asyncpg raises these as a
# plain `DBAPIError`, often with the connection still open.
_TRANSIENT_SQLSTATE_CLASSES = ("08", "53", "57")
_TRANSIENT_SQLSTATES = ("40001", "40P01", "25006")


def _is_transient(error: BaseException) -> bool:
    """True for an error a retry of the same event can heal."""

    if isinstance(
        error,
        (
            ChannelInboxEnqueueFailed,
            # TimeoutError and ConnectionError are OSError subclasses.
            OSError,
            httpx.TransportError,
            OperationalError,
            InterfaceError,
            # No connection free in the pool before the checkout timeout.
            PoolTimeoutError,
        ),
    ):
        return True
    if isinstance(error, DBAPIError):
        sqlstate = str(getattr(error.orig, "sqlstate", None) or "")
        return (
            bool(error.connection_invalidated)
            or sqlstate[:2] in _TRANSIENT_SQLSTATE_CLASSES
            or sqlstate in _TRANSIENT_SQLSTATES
        )
    # The Discord adapter's refusals carry the HTTP status.
    status_code = getattr(error, "status_code", None)
    return isinstance(status_code, int) and (status_code >= 500 or status_code == 429)


async def _retrying(attempt: Callable[[], Any], *, what: str, **context) -> Any:
    """Run `attempt` until it succeeds. A transient error is retried with
    backoff for up to RETRY_LIMIT_SECONDS; a permanent error, or the transient
    error that outlasts the limit, is raised."""

    loop = asyncio.get_running_loop()
    deadline = loop.time() + RETRY_LIMIT_SECONDS
    delay = RETRY_FIRST_SECONDS
    while True:
        try:
            return await attempt()
        except Exception as error:
            if not _is_transient(error) or loop.time() + delay > deadline:
                raise
            log.warning(
                f"[DISCORD] {what} failed; retrying",
                error_type=type(error).__name__,
                retry_in=delay,
                **context,
            )
        await asyncio.sleep(delay)
        delay = min(delay * 2, RETRY_MAX_SECONDS)


def _connection_token(connection: ChannelConnection) -> str:
    """The bot token, or "" when the connection has none. The adapter's own
    helper raises instead; the reload needs to skip such a row."""

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
        client_factory: Callable[["DiscordSocket"], Any] = _GatewayClient,
    ) -> None:
        self.project_id = project_id
        self.connection = connection
        self.token = _connection_token(connection)
        self.adapter = adapter
        self.channels_service = channels_service
        self.client_factory = client_factory
        self.client: Optional[Any] = None
        self.task: Optional[asyncio.Task] = None
        # Received events and recovery passes (one per READY). Closing the
        # socket leaves them to finish: they need no lock, and the next holder
        # would not read their messages again.
        self.tasks: Set[asyncio.Task] = set()

    def open(self) -> None:
        self.task = asyncio.create_task(self._run())

    async def close(self) -> None:
        """Close the socket. Received events keep their enqueue retry, and a
        running recovery pass finishes."""

        if self.task is not None:
            self.task.cancel()
        if self.client is not None:
            try:
                await self.client.close()
            except Exception:  # noqa: BLE001 - closing is best-effort
                log.warning("[DISCORD] socket close failed", exc_info=True)
        if self.task is not None:
            # A cancel of the caller still raises here.
            await asyncio.gather(self.task, return_exceptions=True)

    async def _run(self) -> None:
        connection_id = str(self.connection.id)
        delay = RETRY_FIRST_SECONDS
        while True:
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
            # A fresh IDENTIFY: Discord replays nothing from the gap. After a
            # resume it sends RESUMED and replays the gap itself. A pass that
            # still runs from an earlier READY keeps going; this one covers the
            # new gap.
            ready_at = datetime.now(timezone.utc)
            self._track(self._recover(ready_at))
        elif event in _ROUTED_EVENTS:
            body = json.dumps({"t": event, "d": frame.get("d")}).encode("utf-8")
            self._track(self.ingest(body))

    def _track(self, coroutine) -> None:
        task = asyncio.create_task(coroutine)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def ingest(self, body: bytes) -> None:
        """One live event through the adapter and the shared step. Runs in its
        own task, so the socket keeps reading while it retries."""

        try:
            await self._ingest_retrying(body)
        except Exception:
            log.error(
                "[DISCORD] event dropped",
                connection_id=str(self.connection.id),
                exc_info=True,
            )

    async def _ingest_retrying(self, body: bytes, *, recovered: bool = False) -> None:
        await _retrying(
            lambda: self._ingest_once(body, recovered=recovered),
            what="event",
            connection_id=str(self.connection.id),
        )

    async def _ingest_once(self, body: bytes, *, recovered: bool = False) -> None:
        inbound = await self.adapter.parse_event(body=body, connection=self.connection)
        if inbound is None:
            return
        for event in inbound if isinstance(inbound, list) else [inbound]:
            if recovered and await self._command_already_routed(event):
                continue
            await self.channels_service.record_and_enqueue_inbox_event(
                project_id=self.project_id,
                connection_id=self.connection.id,
                channel=CHANNEL,
                inbound=event,
            )

    # --- recovery ------------------------------------------------------------ #

    async def _command_already_routed(self, inbound) -> bool:
        """True for a command whose row the dispatcher already routed (routing
        attaches the row to its space). Recovery skips it, because the
        dispatcher runs a command before the `(thread_id, event_id)` turn claim,
        so `!new` would run twice. Every other message goes through the shared
        step again, and the turn claim stops a second turn. Routing commits the
        space before the command runs, so a command whose dispatch then failed
        is not retried by recovery."""

        capabilities = await self.adapter.fetch_capabilities(connection=self.connection)
        if (
            parse_command(content=inbound.processed.content, capabilities=capabilities)
            is None
        ):
            return False
        rows = await self.channels_service.query_inbox_events(
            project_id=self.project_id,
            event=ChannelInboxEventQuery(
                connection_id=self.connection.id, external_id=inbound.external_id
            ),
        )
        return bool(rows) and rows[0].space_id is not None

    async def _recovery_start(self, ready_at: datetime) -> RecoveryStart:
        """The highest message id per channel Discord delivered in, among the
        connection's pushed messages stored in the recovery window before
        READY. A live message the new socket stores is newer than READY, so it
        cannot hide an earlier missed one."""

        rows = await self.channels_service.query_inbox_events(
            project_id=self.project_id,
            event=ChannelInboxEventQuery(
                connection_id=self.connection.id,
                kind=ChannelEventKind.MESSAGE,
                origin=ChannelEventOrigin.PUSHED,
            ),
            windowing=Windowing(
                oldest=self._recovery_oldest(ready_at),
                newest=ready_at - RECOVERY_CLOCK_MARGIN,
                limit=RECOVERY_SCAN_LIMIT,
            ),
        )
        start: RecoveryStart = {}
        for row in rows:
            locator = row.data.external_locator if row.data else {}
            if not str(row.external_id).isdigit():
                continue
            channel_ids = {str(locator.get("source_channel_id") or "")}
            # A mention opens a thread whose id is the mention's own id, so the
            # thread's messages all come after it. Reading the thread too
            # recovers a follow-up posted there during the gap, when the
            # mention is the thread's only stored row.
            if row.data and row.data.addressed:
                channel_ids.add(str(locator.get("thread_id") or ""))
            for channel_id in channel_ids - {""}:
                # Snowflakes compare as integers, not as strings.
                current = start.get(channel_id)
                if current is None or int(row.external_id) > int(current[0]):
                    start[channel_id] = (
                        str(row.external_id),
                        str(locator.get("guild_id") or ""),
                    )
        return start

    def _recovery_oldest(self, ready_at: datetime) -> datetime:
        """The recovery window starts 24 hours before READY, or when the bot was
        last connected if that is later. Rows from before a disconnect then
        start no history read, so a message sent while the bot was off is not
        answered after it is connected again."""

        oldest = ready_at - RECOVERY_WINDOW
        try:
            connected_at = datetime.fromisoformat(
                str((self.connection.data or {}).get("connected_at"))
            )
        except ValueError:
            return oldest
        if connected_at.tzinfo is None:
            connected_at = connected_at.replace(tzinfo=timezone.utc)
        return max(oldest, connected_at)

    async def _recover(self, ready_at: datetime) -> None:
        connection_id = str(self.connection.id)
        try:
            start = await _retrying(
                lambda: self._recovery_start(ready_at),
                what="recovery start read",
                connection_id=connection_id,
            )
        except Exception:
            log.error(
                "[DISCORD] recovery start could not be read",
                connection_id=connection_id,
                exc_info=True,
            )
            return
        for channel_id, (after, guild_id) in start.items():
            try:
                await self._recover_channel(channel_id, after, guild_id)
            except Exception:
                # A history read that failed (permanent, or transient past the
                # retry limit), or a message whose transient error outlasted the
                # limit. The pass stops this channel rather than read past a
                # message that is not stored.
                log.error(
                    "[DISCORD] recovery stopped a channel",
                    connection_id=connection_id,
                    channel_id=channel_id,
                    exc_info=True,
                )

    async def _recover_channel(
        self, channel_id: str, after: str, guild_id: str
    ) -> None:
        connection_id = str(self.connection.id)
        cursor = after
        while True:
            # Oldest first, so the messages are stored in order.
            messages: List[Dict[str, Any]] = await _retrying(
                lambda: self.adapter.fetch_messages_after(
                    connection=self.connection, channel_id=channel_id, after=cursor
                ),
                what="history read",
                connection_id=connection_id,
                channel_id=channel_id,
            )
            if not messages:
                return
            for message in messages:
                data = dict(message)
                if guild_id:
                    data["guild_id"] = guild_id
                body = json.dumps({"t": "MESSAGE_CREATE", "d": data}).encode("utf-8")
                # A transient error is retried here, so the cursor never moves
                # past a message that is not stored; one that outlasts the
                # limit stops the channel. A permanent error skips the message.
                try:
                    await self._ingest_retrying(body, recovered=True)
                except Exception as error:
                    if _is_transient(error):
                        raise
                    log.error(
                        "[DISCORD] recovered message dropped",
                        connection_id=connection_id,
                        channel_id=channel_id,
                        message_id=str(message.get("id")),
                        exc_info=True,
                    )
            cursor = str(messages[-1]["id"])


class DiscordSocketLoop:
    """Holds the lock, and keeps one `DiscordSocket` per active connection
    while it does."""

    def __init__(
        self,
        *,
        channels_service: "ChannelsService",
        client_factory: Callable[[DiscordSocket], Any] = _GatewayClient,
    ) -> None:
        self.channels_service = channels_service
        self.client_factory = client_factory
        self.sockets: Dict[UUID, DiscordSocket] = {}

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
        """Renew and reload in two tasks, so a slow reload never delays the
        renewal. Returns on shutdown or when the lock is lost, and the caller
        closes the sockets."""

        renewal = asyncio.create_task(self._renew(owner, shutdown))
        reloads = asyncio.create_task(self._reload_until(shutdown))
        try:
            await asyncio.wait({renewal, reloads}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for task in (renewal, reloads):
                task.cancel()
            await asyncio.gather(renewal, reloads, return_exceptions=True)

    async def _renew(self, owner: str, shutdown: asyncio.Event) -> None:
        while not await _wait(shutdown, TICK_SECONDS):
            try:
                renewed = await asyncio.wait_for(
                    locking.renew_lock(
                        namespace=LOCK_NAMESPACE,
                        key=LOCK_KEY,
                        ttl=LOCK_TTL_SECONDS,
                        owner=owner,
                    ),
                    timeout=RENEW_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                renewed = False
            if not renewed:
                # Another replica may take the lock once the lease runs out;
                # close before it can open.
                log.warning("[DISCORD] socket lock lost; closing sockets")
                return

    async def _reload_until(self, shutdown: asyncio.Event) -> None:
        while True:
            try:
                await self.reload()
            except Exception:
                log.error("[DISCORD] connection reload failed", exc_info=True)
            if await _wait(shutdown, TICK_SECONDS):
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
            current = self.sockets.get(connection_id)
            # A token rotation edits the row, so an unchanged row needs no
            # credential read.
            if current is not None and current.connection.updated_at == row.updated_at:
                continue
            try:
                connection = await self.channels_service.fetch_connection(
                    project_id=project_id, connection_id=connection_id
                )
            except Exception:
                # One bad credential must not keep the other connections from
                # opening; this one is tried again on the next reload.
                log.error(
                    "[DISCORD] connection could not be read",
                    connection_id=str(connection_id),
                    exc_info=True,
                )
                continue
            if connection is None or not _connection_token(connection):
                await self._close(connection_id)
                continue
            if current is not None and current.token == _connection_token(connection):
                current.connection = connection
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
            log.info("[DISCORD] socket opened", connection_id=str(connection_id))

    async def _close(self, connection_id: UUID) -> None:
        socket = self.sockets.pop(connection_id, None)
        if socket is not None:
            await socket.close()
            log.info("[DISCORD] socket closed", connection_id=str(connection_id))

    async def close_all(self) -> None:
        for connection_id in list(self.sockets):
            await self._close(connection_id)
