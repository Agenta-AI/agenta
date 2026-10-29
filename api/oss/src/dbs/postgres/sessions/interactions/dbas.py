from sqlalchemy import Column, String, VARCHAR
from sqlalchemy.dialects.postgresql import JSONB

from oss.src.dbs.postgres.shared.dbas import (
    DataDBA,
    FlagsDBA,
    IdentifierDBA,
    LifecycleDBA,
    MetaDBA,
    ProjectScopeDBA,
    TagsDBA,
)


class SessionInteractionDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    DataDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    __abstract__ = True

    session_id = Column(String, nullable=False)
    turn_id = Column(String, nullable=True)
    token = Column(String, nullable=False)
    kind = Column(String, nullable=False)
    status = Column(VARCHAR, nullable=True)
    # The asking run's envelope (M2); the resume continues under it.
    run_envelope = Column(JSONB(none_as_null=True), nullable=True)
