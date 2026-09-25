from sqlalchemy import ForeignKeyConstraint, PrimaryKeyConstraint, UniqueConstraint

from oss.src.dbs.postgres.channels.telegram_bind_dbas import (
    TelegramBindTokenDBA,
    TelegramChatBindingDBA,
)
from oss.src.dbs.postgres.shared.base import Base


class TelegramBindTokenDBE(Base, TelegramBindTokenDBA):
    __tablename__ = "channel_telegram_bind_tokens"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("id"),
        UniqueConstraint("token", name="uq_channel_telegram_bind_tokens_token"),
    )


class TelegramChatBindingDBE(Base, TelegramChatBindingDBA):
    __tablename__ = "channel_telegram_chat_bindings"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("id"),
        # one chat binds to exactly one destination on a given bot
        UniqueConstraint(
            "bot_id",
            "chat_id",
            name="uq_channel_telegram_chat_bindings_bot_chat",
        ),
    )
