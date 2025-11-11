from sqlalchemy import (
    PrimaryKeyConstraint,
    Index,
)

from oss.src.dbs.postgres.shared.base import Base
from oss.src.dbs.postgres.tracing.dbas import SpanDBA
from oss.src.dbs.postgres.shared.dbas import ProjectScopeDBA, LifecycleDBA


class SpanDBE(
    Base,
    ProjectScopeDBA,
    LifecycleDBA,
    SpanDBA,
    # FullTextSearchDBA,
):
    __tablename__ = "spans"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "trace_id",
            "span_id",
        ),  # for uniqueness
        Index(
            "ix_project_id",
            "project_id",
        ),  # for filtering
        Index(
            "ix_project_id_trace_id",
            "project_id",
            "trace_id",
        ),  # for focus = trace
        Index(
            "ix_project_id_span_id",
            "project_id",
            "span_id",
        ),  # for focus = span
        Index(
            "ix_project_id_start_time",
            "project_id",
            "start_time",
        ),  # for sorting and scrolling
        Index(
            "ix_spans_project_id_trace_type",
            "project_id",
            "trace_type",
        ),  # for filtering
        Index(
            "ix_spans_project_id_span_type",
            "project_id",
            "span_type",
        ),  # for filtering
        Index(
            "ix_attributes_gin",
            "attributes",
            postgresql_using="gin",
        ),  # for filtering
        Index(
            "ix_references_gin",
            "references",
            postgresql_using="gin",
            postgresql_ops={"references": "jsonb_path_ops"},
        ),  # for filtering
        Index(
            "ix_links_gin",
            "links",
            postgresql_using="gin",
            postgresql_ops={"links": "jsonb_path_ops"},
        ),  # for filtering
        Index(
            "ix_hashes_gin",
            "hashes",
            postgresql_using="gin",
            postgresql_ops={"hashes": "jsonb_path_ops"},
        ),  # for filtering
        Index(
            "ix_events_gin",
            "events",
            postgresql_using="gin",
        ),  # for filtering
    )
