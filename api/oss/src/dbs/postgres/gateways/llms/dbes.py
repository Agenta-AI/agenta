"""LLM plane DBE (entities.md §3)."""

from sqlalchemy import (
    ForeignKeyConstraint,
    Index,
    PrimaryKeyConstraint,
    UniqueConstraint,
)

from oss.src.dbs.postgres.gateways.llms.dbas import LlmEndpointDBA
from oss.src.dbs.postgres.shared.base import Base


class LlmEndpointDBE(Base, LlmEndpointDBA):
    __tablename__ = "llm_gateway_endpoints"

    __table_args__ = (
        PrimaryKeyConstraint("project_id", "id"),
        ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        ForeignKeyConstraint(["secret_id"], ["secrets.id"], ondelete="SET NULL"),
        UniqueConstraint(
            "project_id",
            "slug",
            name="uq_llm_gateway_endpoints_project_slug",
        ),
        Index(
            "ix_llm_gateway_endpoints_project_provider",
            "project_id",
            "provider_key",
        ),
        Index(
            "ix_llm_gateway_endpoints_flags",
            "flags",
            postgresql_using="gin",
        ),
    )
