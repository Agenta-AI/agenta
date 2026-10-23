from sqlalchemy.dialects.postgresql import JSONB, ARRAY
from sqlalchemy import Column, UUID, VARCHAR, TIMESTAMP, INTEGER

from oss.src.dbs.postgres.shared.dbas import (
    VersionDBA,
    IdentifierDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    HeaderDBA,
    DataDBA,
)


class EvaluationRunDBA(
    VersionDBA,
    IdentifierDBA,
    LifecycleDBA,
    HeaderDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
    DataDBA,  # steps, mappings
):
    __abstract__ = True

    status = Column(
        VARCHAR,
        nullable=False,
    )

    references = Column(
        JSONB(none_as_null=True),
        nullable=True,
    )

    # The principal the run executes as (M2): set at create, start and rerun.
    principal_kind = Column(VARCHAR, nullable=True)
    principal_id = Column(UUID(as_uuid=True), nullable=True)
    # The acting user of the request that set the principal (for an installation, the
    # linked user whose role the run uses). Written with the principal.
    principal_user_id = Column(UUID(as_uuid=True), nullable=True)


class EvaluationScenarioDBA(
    VersionDBA,
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

    interval = Column(
        INTEGER,
        nullable=True,
    )
    timestamp = Column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    run_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class EvaluationResultDBA(
    VersionDBA,
    IdentifierDBA,
    LifecycleDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

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

    status = Column(
        VARCHAR,
        nullable=False,
    )

    interval = Column(
        INTEGER,
        nullable=True,
    )
    timestamp = Column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    repeat_idx = Column(
        INTEGER,
        nullable=True,
    )
    step_key = Column(
        VARCHAR,
        nullable=False,
    )
    scenario_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    run_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class EvaluationMetricsDBA(
    VersionDBA,
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

    interval = Column(
        INTEGER,
        nullable=True,
    )
    timestamp = Column(
        TIMESTAMP(timezone=True),
        nullable=True,
    )
    scenario_id = Column(
        UUID(as_uuid=True),
        nullable=True,
    )
    run_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )


class EvaluationQueueDBA(
    VersionDBA,
    IdentifierDBA,
    LifecycleDBA,
    HeaderDBA,
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

    run_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    user_ids = Column(
        ARRAY(UUID(as_uuid=True)),
        nullable=True,
    )
