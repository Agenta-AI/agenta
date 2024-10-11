from sqlalchemy import PrimaryKeyConstraint, Index

from agenta_backend.dbs.postgres.shared.base import Base


from agenta_backend.dbs.postgres.observability.dbas import SpanDBA


class InvocationSpanDBE(Base, SpanDBA):
    __tablename__ = "invocation_span"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "node_id",
        ),
        Index(
            "index_project_id_tree_id",
            "project_id",
            "tree_id",
        ),
        Index(
            "index_project_id_root_id",
            "project_id",
            "root_id",
        ),
        Index(
            "index_project_id_node_id",
            "project_id",
            "created_at",
        ),
    )
