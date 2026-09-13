from sqlalchemy import Column, Integer, String, TIMESTAMP

from oss.src.dbs.postgres.shared.dbas import (
    DataDBA,
    FlagsDBA,
    IdentifierDBA,
    LifecycleDBA,
    MetaDBA,
    ProjectScopeDBA,
    TagsDBA,
)


class SessionCommandDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    DataDBA,
    FlagsDBA,
    TagsDBA,
    MetaDBA,
):
    """One durable request to change an execution.

    The delivery columns (`state`, `claimed_by`, `claim_expires_at`, `claim_count`) are flat
    rather than nested in `data` because a claim query filters and orders on them and a JSON
    blob cannot be indexed for that. Their names carry the grouping.

    `state` and `outcome` are never merged. `state` says where the COMMAND is; `outcome` says
    what happened to the EXECUTION.
    """

    __abstract__ = True

    # Bare correlator, not a foreign key — the same rule every other sessions table follows.
    session_id = Column(String, nullable=False)
    kind = Column(String, nullable=False)

    # The execution the API resolved ONCE at admission and pinned. A turn that starts later has
    # a different id, so a pinned command can never reach it. Null when nothing was running.
    target_turn_id = Column(String, nullable=True)
    # What the caller asserted, stored as sent, so a 409 stays explainable after the fact.
    expected_turn_id = Column(String, nullable=True)

    state = Column(String, nullable=False)
    claimed_by = Column(String, nullable=True)
    claim_expires_at = Column(TIMESTAMP(timezone=True), nullable=True)
    claim_count = Column(Integer, nullable=False, default=0, server_default="0")

    outcome = Column(String, nullable=True)
    idempotency_key = Column(String, nullable=True)
    settled_at = Column(TIMESTAMP(timezone=True), nullable=True)
