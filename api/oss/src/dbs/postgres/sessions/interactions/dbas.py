from sqlalchemy import Column, String, VARCHAR

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
