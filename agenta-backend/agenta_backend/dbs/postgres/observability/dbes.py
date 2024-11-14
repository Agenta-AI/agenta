from sqlalchemy import PrimaryKeyConstraint, Index


from agenta_backend.dbs.postgres.shared.base import Base
from agenta_backend.dbs.postgres.observability.dbas import SpanDBA


class NodesDBE(Base, SpanDBA):
    __tablename__ = "nodes"

    __table_args__ = (
        PrimaryKeyConstraint(
            "project_id",
            "node_id",
        ),  # focus = node
        Index(
            "index_project_id_tree_id",
            "project_id",
            "tree_id",
        ),  # focus = tree
        Index(
            "index_project_id_root_id",
            "project_id",
            "root_id",
        ),  # focus = root
        Index(
            "index_project_id_node_id",
            "project_id",
            "created_at",
        ),  # sorting and pagination
    )
