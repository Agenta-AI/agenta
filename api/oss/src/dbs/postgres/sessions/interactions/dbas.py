from sqlalchemy import Column, String

from oss.src.dbs.postgres.shared.dbas import (
    DataDBA,
    FlagsDBA,
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
    StatusDBA,
)


class SessionInteractionDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    StatusDBA,
    DataDBA,
    FlagsDBA,
):
    __abstract__ = True

    session_id = Column(String, nullable=False)
    run_id = Column(String, nullable=True)
    token = Column(String, nullable=False)
    kind = Column(String, nullable=False)
