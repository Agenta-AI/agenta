from sqlalchemy import ForeignKeyConstraint, PrimaryKeyConstraint, UniqueConstraint

from oss.src.dbs.postgres.channels.identity_dbas import ChannelIdentityLinkDBA
from oss.src.dbs.postgres.shared.base import Base


class ChannelIdentityLinkDBE(Base, ChannelIdentityLinkDBA):
    __tablename__ = "channel_identity_links"

    __table_args__ = (
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        PrimaryKeyConstraint("project_id", "id"),
        # one platform identity maps to at most one link per connection
        UniqueConstraint(
            "project_id",
            "connection_id",
            "external_user_key",
            name="uq_channel_identity_links_connection_external_user_key",
        ),
    )
