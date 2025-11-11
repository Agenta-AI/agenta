from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import Column, UUID, VARCHAR, TIMESTAMP

from oss.src.dbs.postgres.shared.dbas import (
    IdentifierDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    HeaderDBA,
    DataDBA,
)


class EvaluationRunDBA(
    IdentifierDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    HeaderDBA,
    DataDBA,  # steps, mappings
):
    __abstract__ = True

    status = Column(
        VARCHAR,
        nullable=False,
    )


class EvaluationScenarioDBA(
    IdentifierDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    status = Column(
        VARCHAR,
        nullable=False,
    )

    run_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class EvaluationStepDBA(
    IdentifierDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    status = Column(
        VARCHAR,
        nullable=False,
    )
    timestamp = Column(
        TIMESTAMP(timezone=True),
        nullable=False,
    )

    key = Column(
        VARCHAR,
        nullable=False,
    )
    repeat_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    retry_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )

    hash_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
    trace_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
    testcase_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
    error = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )

    scenario_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    run_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class EvaluationMetricDBA(
    IdentifierDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    DataDBA,
):
    __abstract__ = True

    status = Column(
        VARCHAR,
        nullable=False,
    )

    scenario_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )

    run_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
