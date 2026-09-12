"""Account-bind for the hosted (Agenta-owned) Telegram bot.

The hosted bot is ONE bot shared by every project, so an inbound update carries
only the chat and the user, never the project. This module owns the bind that
maps a chat to a project: it mints a one-time deep-link token at setup time,
consumes that token when the user runs `/start <token>` in Telegram, and then
resolves `(bot_id, chat_id) -> (project, connection)` for the shared ingress.

The custom-bot path does not use any of this; it keys on `bot_id` and resolves
the connection from the per-bot webhook path.

Persistence is injected as `TelegramBindingStore`. The consume step writes the
chat binding and the account link in ONE transaction in the store, so a
duplicate `/start` keeps the completed binding and a failure writes nothing.
"""

import secrets as token_secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional, Protocol
from uuid import UUID

from oss.src.core.channels.dtos import ChannelCapabilities
from oss.src.core.channels.identity import compose_external_user_key

# Telegram caps the deep-link `start` parameter at 64 characters, so a signed
# state payload does not fit. token_urlsafe(32) is 43 url-safe characters.
_TOKEN_NBYTES = 32
_DEFAULT_TTL = timedelta(minutes=30)


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class BindToken:
    """A one-time bind token, stored server-side. The token itself is the only
    thing that travels in the deep link; everything else is looked up by it."""

    token: str
    project_id: UUID
    user_id: UUID
    connection_id: UUID
    expires_at: datetime
    consumed_at: Optional[datetime] = None

    def is_expired(self, *, at: Optional[datetime] = None) -> bool:
        return (at or _now()) >= self.expires_at

    def is_consumed(self) -> bool:
        return self.consumed_at is not None


@dataclass(frozen=True)
class ChatBinding:
    """The durable `(bot_id, chat_id) -> project, connection` routing fact."""

    bot_id: str
    chat_id: str
    project_id: UUID
    connection_id: UUID


class BindTokenError(Exception):
    """Base for a bind that cannot complete. The caller maps it to a user-
    facing `/start` reply, never to a 500."""


class BindTokenInvalid(BindTokenError):
    """No such token."""


class BindTokenExpired(BindTokenError):
    """The token exists but its window has passed."""


class BindTokenAlreadyUsed(BindTokenError):
    """The token was already consumed. A replayed `/start` lands here."""


class ChatBoundElsewhere(BindTokenError):
    """This chat is already bound to a different project. v1 refuses to move a
    binding silently; the user disconnects the old one first."""


class ChatAlreadyConnected(BindTokenError):
    """This chat is already connected to THIS project, and a fresh link was
    opened in it. v1 refuses to re-bind silently (which would leave the old
    account attribution in place while consuming a new token); the user
    disconnects first to change it."""


class TelegramBindingStore(Protocol):
    """Persistence for the hosted bind. The real implementation is a Postgres
    DAO; tests pass an in-memory fake. `consume_token_and_bind` MUST be atomic:
    it marks the token consumed, writes the chat binding, and writes the
    account identity link in one transaction, or changes nothing."""

    async def save_token(self, token: BindToken) -> None: ...

    async def get_token(self, token: str) -> Optional[BindToken]: ...

    async def get_binding(
        self, *, bot_id: str, chat_id: str
    ) -> Optional[ChatBinding]: ...

    async def consume_token_and_bind(
        self,
        *,
        token: BindToken,
        bot_id: str,
        chat_id: str,
        external_user_key: str,
    ) -> ChatBinding: ...

    async def delete_bindings_for_connection(self, *, connection_id: UUID) -> int: ...


class TelegramBindingService:
    """Issue, consume, and resolve hosted Telegram binds."""

    def __init__(
        self,
        *,
        store: TelegramBindingStore,
        bot_username: str,
        capabilities: ChannelCapabilities,
        ttl: timedelta = _DEFAULT_TTL,
    ) -> None:
        self._store = store
        # The @username of the hosted bot; the deep link is t.me/<username>.
        self._bot_username = bot_username.lstrip("@")
        # The hosted capability declaration, the one source for the account key
        # shape. The bind writes the account link with the SAME key the inbox
        # worker later composes for an incoming message (the chat id as the
        # scope, the sender as the user), so the worker finds the link instead
        # of falling back to the agent creator.
        self._capabilities = capabilities
        self._ttl = ttl

    @property
    def ttl_seconds(self) -> int:
        return int(self._ttl.total_seconds())

    async def issue_bind_link(
        self,
        *,
        project_id: UUID,
        user_id: UUID,
        connection_id: UUID,
    ) -> str:
        """Mint a one-time token for this project and return the deep link the
        connect UI shows. The connection and its default agent are prepared by
        the caller before this runs, so `/start` only completes the binding."""

        token = token_secrets.token_urlsafe(_TOKEN_NBYTES)
        record = BindToken(
            token=token,
            project_id=project_id,
            user_id=user_id,
            connection_id=connection_id,
            expires_at=_now() + self._ttl,
        )
        await self._store.save_token(record)
        return f"https://t.me/{self._bot_username}?start={token}"

    async def consume_bind_token(
        self,
        *,
        token: str,
        bot_id: str,
        chat_id: str,
        sender_id: str,
    ) -> ChatBinding:
        """Run on `/start <token>`. Validate the token, then bind this chat to
        its project and link the sender's account, atomically. Idempotent for a
        replay: a second `/start` with the same chat and the same project
        returns the existing binding instead of failing."""

        record = await self._store.get_token(token)
        if record is None:
            raise BindTokenInvalid()

        # A chat already bound decides the outcome before the token state does.
        existing = await self._store.get_binding(bot_id=bot_id, chat_id=chat_id)
        if existing is not None:
            if existing.project_id != record.project_id:
                # aimed at a different project than the chat already holds
                raise ChatBoundElsewhere()
            if record.is_consumed():
                # the completing token, re-delivered by Telegram: idempotent
                # success on the binding it already made.
                return existing
            # a fresh token for an already-connected chat: refuse rather than
            # silently re-bind (which would consume the token but leave the old
            # account attribution). The user disconnects first to change it.
            raise ChatAlreadyConnected()

        if record.is_consumed():
            raise BindTokenAlreadyUsed()
        if record.is_expired():
            raise BindTokenExpired()

        # The account key the inbox worker will compose for a message from this
        # sender in this chat: the chat id is the scope, the sender is the user.
        external_user_key = compose_external_user_key(
            self._capabilities,
            str(sender_id),
            scope_id=str(chat_id),
        )

        return await self._store.consume_token_and_bind(
            token=record,
            bot_id=bot_id,
            chat_id=chat_id,
            external_user_key=external_user_key,
        )

    async def resolve_bound_connection(
        self, *, bot_id: str, chat_id: str
    ) -> Optional[ChatBinding]:
        """The ingress seam: which project and connection owns this chat on the
        shared bot. `None` means the chat is not bound yet."""

        return await self._store.get_binding(bot_id=bot_id, chat_id=chat_id)

    async def release_connection_bindings(self, *, connection_id: UUID) -> int:
        """Free every chat bound to this connection, so they can reconnect.
        Called when a hosted connection is disconnected. Safe to call for any
        connection: one with no bindings removes nothing."""

        return await self._store.delete_bindings_for_connection(
            connection_id=connection_id
        )
