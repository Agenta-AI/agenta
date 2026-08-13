"""LLM plane DBA mixins (entities.md §2)."""

from sqlalchemy import UUID, Column
from sqlalchemy import Enum as SQLEnum
from sqlalchemy import String

from oss.src.core.gateways.llms.dtos import LlmDeploymentKind
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


class LlmEndpointDBA(
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
    """One custom LLM endpoint: a provider deployment we reach (entities.md §2)."""

    __abstract__ = True

    provider_key = Column(String, nullable=False)
    deployment = Column(
        SQLEnum(LlmDeploymentKind, name="llmdeploymentkind_enum"), nullable=False
    )
    secret_id = Column(UUID(as_uuid=True), nullable=True)
    # data: { route, model_slugs, config, extras } — LlmEndpointData (entities.md §2.4)
