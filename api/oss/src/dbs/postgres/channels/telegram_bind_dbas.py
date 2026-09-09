from sqlalchemy import TIMESTAMP, Column, String
from sqlalchemy.dialects.postgresql import UUID

from oss.src.dbs.postgres.shared.dbas import IdentifierDBA, LifecycleDBA


class TelegramBindTokenDBA(LifecycleDBA, IdentifierDBA):
    __abstract__ = True

    # The opaque one-time code carried in the deep link. Looked up on its own
    # (a /start carries only the code), so it is unique and not project-scoped.
    token = Column(String, nullable=False)
    project_id = Column(UUID(as_uuid=True), nullable=False)
    # The Agenta user who generated the link; becomes the invoking user for the
    # bound chat.
    user_id = Column(UUID(as_uuid=True), nullable=False)
    connection_id = Column(UUID(as_uuid=True), nullable=False)
    expires_at = Column(TIMESTAMP(timezone=True), nullable=False)
    consumed_at = Column(TIMESTAMP(timezone=True), nullable=True)


class TelegramChatBindingDBA(LifecycleDBA, IdentifierDBA):
    __abstract__ = True

    # The routing fact for the shared hosted bot: (bot_id, chat_id) resolves a
    # project and its hosted connection. Looked up WITHOUT a project, so these
    # are a global unique key, not a project-scoped one.
    bot_id = Column(String, nullable=False)
    chat_id = Column(String, nullable=False)
    project_id = Column(UUID(as_uuid=True), nullable=False)
    connection_id = Column(UUID(as_uuid=True), nullable=False)
