"""Typed agent-domain failures (contracts.md "Domain failures")."""

from ..exceptions import DomainError


class AgentNotFound(DomainError):
    code = "agent_not_found"


class RevisionNotFound(DomainError):
    code = "revision_not_found"


class ImmutableRevision(DomainError):
    """No mutation path exists for revisions; commit a new revision instead."""

    code = "revision_immutable"


class AgentInUse(DomainError):
    """Deletion blocked because revisions/sessions still reference the agent."""

    code = "agent_in_use"
