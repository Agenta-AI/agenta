from sqlalchemy import Boolean, Column, String, UUID

from oss.src.dbs.postgres.shared.dbas import (
    HeaderDBA,
    IdentifierDBA,
    LifecycleDBA,
    ProjectScopeDBA,
    SlugDBA,
)


class SkillSourceDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
    SlugDBA,
    HeaderDBA,
):
    __abstract__ = True

    repo_url = Column(
        String,
        nullable=False,
    )
    ref = Column(
        String,
        nullable=True,
    )
    last_seen_commit_sha = Column(
        String,
        nullable=True,
    )
    sync_enabled = Column(
        Boolean,
        nullable=False,
        default=False,
    )


class SkillSourceLinkDBA(
    ProjectScopeDBA,
    LifecycleDBA,
    IdentifierDBA,
):
    __abstract__ = True

    source_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    # The imported skill's workflow artifact — a bare column, not an FK, so a
    # workflow archive/delete never cascades into provenance history.
    workflow_id = Column(
        UUID(as_uuid=True),
        nullable=False,
    )
    # Identity in the source is the PATH, not the name (ux-plan: renames in
    # frontmatter are artifact renames; moved directories read as delete+new).
    path_in_repo = Column(
        String,
        nullable=False,
    )
    imported_commit_sha = Column(
        String,
        nullable=True,
    )
    content_hash = Column(
        String,
        nullable=True,
    )
    # Local edit breaks sync: queryable state lives HERE, not in commit meta
    # (meta is JSON, not JSONB — writable but not containment-queryable).
    detached = Column(
        Boolean,
        nullable=False,
        default=False,
    )
    missing_in_source = Column(
        Boolean,
        nullable=False,
        default=False,
    )
