"""The run person, and the "user" items of an agent revision (the API side of the item
reader; the SDK's `read_user_items` is the one reader)."""

from typing import List, Optional
from uuid import UUID

from agenta.sdk.agents.accounts import UserItem, read_user_items

from oss.src.core.access.dtos import PrincipalKind, RunEnvelope, RunOrigin
from oss.src.core.workflows.dtos import WorkflowRevisionData


def run_person_id(envelope: Optional[RunEnvelope]) -> Optional[UUID]:
    """The person a run is for, or None.

    None when there is no envelope, and for a child run: a child keeps its parent's
    authority, so the authority alone cannot tell it apart. Otherwise the principal's id
    when the principal is a human; an API key and a channel installation have no run
    person. Every boundary uses this one function. A route that is not a run builds its
    envelope with `request_run_envelope(request)`."""
    if envelope is None or envelope.context.origin == RunOrigin.CHILD:
        return None
    principal = envelope.authority.principal
    if principal.kind != PrincipalKind.HUMAN:
        return None
    return principal.id


def user_items_of_revision(
    revision_data: Optional[WorkflowRevisionData],
) -> List[UserItem]:
    """`read_user_items` on a revision's parameters."""
    if revision_data is None:
        return []
    parameters = revision_data.parameters
    return read_user_items(parameters if isinstance(parameters, dict) else None)
