"""LLM plane DBE (entities.md §3)."""

from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
)

from oss.src.dbs.postgres.gateways.llms.dbas import LLMEndpointDBA
from oss.src.dbs.postgres.shared.base import Base


class LLMEndpointDBE(Base, LLMEndpointDBA):
    __tablename__ = "llms_endpoints"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint(
            "project_id",
            "slug",
            name="uq_llms_endpoints_project_slug",
        ),
        Index(
            "ix_llms_endpoints_project_provider",
            "project_id",
            "provider_key",
        ),
        Index(
            "ix_llms_endpoints_flags",
            "flags",
            postgresql_using="gin",
        ),
    )
