"""Postgres store for the hosted Telegram bind.

Implements the `TelegramBindingStore` Protocol the binding service depends on.
`consume_token_and_bind` is the one place the three writes that must not drift
apart happen together: the token is marked consumed, the chat binding is
written, and the account identity link is written, all in one transaction. A
concurrent `/start` cannot double-write: the token consume is guarded on
`consumed_at IS NULL`, and both inserts use ON CONFLICT DO NOTHING, after which
the stored binding is read back and returned.
"""

from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from oss.src.core.channels.telegram_binding import (
    BindToken,
    BindTokenAlreadyUsed,
    ChatBinding,
)
from oss.src.dbs.postgres.channels.identity_dbes import ChannelIdentityLinkDBE
from oss.src.dbs.postgres.channels.telegram_bind_dbes import (
    TelegramBindTokenDBE,
    TelegramChatBindingDBE,
)
from oss.src.dbs.postgres.shared.engine import (
    TransactionsEngine,
    get_transactions_engine,
)


def _to_bind_token(dbe: TelegramBindTokenDBE) -> BindToken:
    return BindToken(
        token=dbe.token,
        project_id=dbe.project_id,
        user_id=dbe.user_id,
        connection_id=dbe.connection_id,
        expires_at=dbe.expires_at,
        consumed_at=dbe.consumed_at,
    )


def _to_chat_binding(dbe: TelegramChatBindingDBE) -> ChatBinding:
    return ChatBinding(
        bot_id=dbe.bot_id,
        chat_id=dbe.chat_id,
        project_id=dbe.project_id,
        connection_id=dbe.connection_id,
    )


class TelegramBindingDAO:
    def __init__(self, engine: TransactionsEngine = None):
        if engine is None:
            engine = get_transactions_engine()
        self.engine = engine

    async def save_token(self, token: BindToken) -> None:
        async with self.engine.session() as session:
            session.add(
                TelegramBindTokenDBE(
                    token=token.token,
                    project_id=token.project_id,
                    user_id=token.user_id,
                    connection_id=token.connection_id,
                    expires_at=token.expires_at,
                    consumed_at=token.consumed_at,
                )
            )
            await session.commit()

    async def get_token(self, token: str) -> Optional[BindToken]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(TelegramBindTokenDBE).where(TelegramBindTokenDBE.token == token)
            )
            dbe = result.scalar_one_or_none()
            return _to_bind_token(dbe) if dbe is not None else None

    async def get_binding(self, *, bot_id: str, chat_id: str) -> Optional[ChatBinding]:
        async with self.engine.session() as session:
            result = await session.execute(
                select(TelegramChatBindingDBE).where(
                    TelegramChatBindingDBE.bot_id == bot_id,
                    TelegramChatBindingDBE.chat_id == chat_id,
                )
            )
            dbe = result.scalar_one_or_none()
            return _to_chat_binding(dbe) if dbe is not None else None

    async def consume_token_and_bind(
        self,
        *,
        token: BindToken,
        bot_id: str,
        chat_id: str,
        external_user_key: str,
    ) -> ChatBinding:
        async with self.engine.session() as session:
            # 1. Consume the token, guarded so a concurrent /start cannot
            # consume it twice: only the transaction that flips NULL -> now
            # wins; a loser sees zero rows and is rejected.
            consumed = await session.execute(
                update(TelegramBindTokenDBE)
                .where(
                    TelegramBindTokenDBE.token == token.token,
                    TelegramBindTokenDBE.consumed_at.is_(None),
                )
                .values(consumed_at=datetime.now(timezone.utc))
                .returning(TelegramBindTokenDBE.id)
            )
            if consumed.scalar_one_or_none() is None:
                raise BindTokenAlreadyUsed()

            # 2. Write the chat binding. ON CONFLICT DO NOTHING so a raced
            # insert for the same chat does not error; the read-back below
            # returns whichever binding actually persisted.
            await session.execute(
                pg_insert(TelegramChatBindingDBE)
                .values(
                    bot_id=bot_id,
                    chat_id=chat_id,
                    project_id=token.project_id,
                    connection_id=token.connection_id,
                )
                .on_conflict_do_nothing(
                    constraint="uq_channel_telegram_chat_bindings_bot_chat"
                )
            )

            # 3. Write the account link with the caller's composed key, ignoring
            # a link that already exists for this connection and key.
            await session.execute(
                pg_insert(ChannelIdentityLinkDBE)
                .values(
                    project_id=token.project_id,
                    connection_id=token.connection_id,
                    user_id=token.user_id,
                    external_user_key=external_user_key,
                )
                .on_conflict_do_nothing(
                    constraint="uq_channel_identity_links_connection_external_user_key"
                )
            )

            await session.commit()

            stored = await session.execute(
                select(TelegramChatBindingDBE).where(
                    TelegramChatBindingDBE.bot_id == bot_id,
                    TelegramChatBindingDBE.chat_id == chat_id,
                )
            )
            return _to_chat_binding(stored.scalar_one())
