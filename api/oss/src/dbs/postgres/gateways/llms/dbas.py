"""LLM endpoint DBA mixins."""

from sqlalchemy import UUID, Column
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import String

from oss.src.core.gateways.llms.dtos import LLMDeploymentKind
from oss.src.dbs.postgres.shared.dbas import (
    DataDBA,
    FlagsDBA,
    HeaderDBA,
    IdentifierDBA,
    LifecycleDBA,
    MetaDBA,
    ProjectScopeDBA,
    SlugDBA,
    StatusDBA,
    TagsDBA,
)


class LLMEndpointDBA(
    ProjectScopeDBA,
    IdentifierDBA,
    SlugDBA,
    LifecycleDBA,
    HeaderDBA,
    DataDBA,
    StatusDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    """One custom LLM endpoint."""

    __abstract__ = True

    # Optional provider-family label for custom endpoints.
    provider_key = Column(String, nullable=True)
    deployment_kind = Column(
        SQLEnum(LLMDeploymentKind, name="llmdeploymentkind_enum"), nullable=False
    )
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # data: route, models, and settings.
