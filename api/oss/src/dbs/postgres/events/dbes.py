from sqlalchemy import PrimaryKeyConstraint, Index, desc, text

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.events.dbas import EventDBA
from oss.src.dbs.postgres.shared.dbas import ProjectScopeDBA, LifecycleDBA

# TODO: Add OrganizationScopeDBA, WorkspaceScopeDBA, and UserScopeDBA


class EventDBE(
    Base,
    ProjectScopeDBA,
    LifecycleDBA,
    EventDBA,
):
    __tablename__ = "events"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "flow_id",
            "event_id",
        ),  # for uniqueness
        Index(
            "ix_events_project_id",
            "project_id",
        ),  # for filtering
        Index(
            "ix_events_project_id_flow_id",
            "project_id",
            "flow_id",
        ),  # for focus = flow
        Index(
            "ix_events_project_id_event_id",
            "project_id",
            "event_id",
        ),  # for focus = event
        Index(
            "ix_events_project_id_timestamp",
            "project_id",
            "timestamp",
        ),  # for sorting and scrolling
        Index(
            "ix_events_project_id_flow_type",
            "project_id",
            "flow_type",
        ),  # for filtering
        Index(
            "ix_events_project_id_event_type",
            "project_id",
            "event_type",
        ),  # for filtering
        Index(
            "ix_events_project_id_flow_id_created_at",
            "project_id",
            "flow_id",
            desc("created_at"),
        ),  # for sorting and scrolling within a flow
        Index(
            "ix_events_attributes_gin",
            "attributes",
            postgresql_using="gin",
        ),  # for filtering
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        #
        Index(
            "ix_events_fts_attributes_gin",
            text("to_tsvector('simple', attributes)"),
            postgresql_using="gin",
        ),  # for full-text search on attributes
        #
        #
        #
        #
        #
    )
